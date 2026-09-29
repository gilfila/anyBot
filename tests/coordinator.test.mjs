import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { Store } from "../runtime/store.mjs";
import {
  childEnvironment,
  extractEvent,
  invocation,
  redact,
} from "../runtime/adapters.mjs";

async function fixture(t, runner = async () => "Finished") {
  const directory = await mkdtemp(join(tmpdir(), "anybot-test-"));
  const c = new Coordinator({
    directory,
    runner,
    probe: async () => [],
    concurrency: 1,
  });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  await c.command("employees.create", {
    name: "Builder",
    role: "Engineer",
    harness: "codex",
    trusted: true,
  });
  await c.command("employees.create", {
    name: "Reviewer",
    role: "Reviewer",
    harness: "claude",
    trusted: true,
  });
  const employees = c.snapshot().employees;
  await c.command("conversations.create", {
    title: "Project",
    members: employees.map((e) => e.id),
    delegation: true,
  });
  const conversation = c.snapshot().conversations[0];
  return {
    c,
    directory,
    employees,
    conversation,
    send: (body) =>
      c.command("messages.send", {
        conversation: conversation.id,
        body,
        recipients: [employees[0].id],
        requestId: crypto.randomUUID(),
      }),
  };
}
async function settled(c) {
  const deadline = Date.now() + 30000;
  while (
    c
      .snapshot()
      .runs.some((r) => ["running", "queued", "cancelling"].includes(r.status))
  ) {
    if (Date.now() > deadline) throw new Error("Queue did not settle");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("real SQLite history survives restart and rejects an unauthorized recipient", async (t) => {
  const { c, directory, employees, conversation, send } = await fixture(t);
  await assert.rejects(
    c.command("messages.send", {
      conversation: conversation.id,
      body: "Hi",
      recipients: ["outsider"],
      requestId: "unauthorized",
    }),
    /Recipients/,
  );
  assert.equal(c.snapshot().messages.length, 0);
  await send("Build it");
  await settled(c);
  assert.equal(c.snapshot().runs[0].status, "succeeded");
  await c.close();
  const reopened = new Coordinator({ directory, probe: async () => [] });
  assert.equal(reopened.snapshot().employees.length, 2);
  assert.equal(reopened.snapshot().messages.at(-1).body, "Finished");
  await reopened.close();
});

test("conversation bot membership can be updated and gates recipients", async (t) => {
  const { c, employees, conversation } = await fixture(t);
  await c.command("conversations.updateMembers", {
    conversation: conversation.id,
    members: [employees[0].id],
  });
  assert.deepEqual(c.snapshot().conversations[0].members, [employees[0].id]);
  await assert.rejects(
    c.command("messages.send", {
      conversation: conversation.id,
      body: "Should fail",
      recipients: [employees[1].id],
      requestId: "removed-member",
    }),
    /Recipients/,
  );
  await c.command("conversations.updateMembers", {
    conversation: conversation.id,
    members: employees.map((e) => e.id),
  });
  assert.equal(c.snapshot().conversations[0].members.length, 2);
  await c.command("runtime.pause");
  await c.command("messages.send", {
    conversation: conversation.id, body: "Queued work", recipients: [employees[1].id], requestId: "queued-member",
  });
  await assert.rejects(c.command("conversations.updateMembers", {
    conversation: conversation.id, members: [employees[0].id],
  }), /Stop or finish/);
  await c.command("runs.cancel", { id: c.snapshot().runs.at(-1).id });
  await c.command("routines.create", {
    name: "Review", conversation: conversation.id, employee: employees[1].id, prompt: "Review", minutes: 60,
  });
  await c.command("conversations.updateMembers", { conversation: conversation.id, members: [employees[0].id] });
  assert.equal(c.snapshot().routines[0].enabled, 0);
});

test("idempotent message admission does not execute twice", async (t) => {
  let calls = 0;
  const { c, employees, conversation } = await fixture(t, async () => {
    calls++;
    return "Done";
  });
  const payload = {
    conversation: conversation.id,
    body: "Once",
    recipients: [employees[0].id],
    requestId: "same-request",
  };
  await c.command("messages.send", payload);
  await c.command("messages.send", payload);
  await settled(c);
  assert.equal(calls, 1);
  assert.equal(c.snapshot().runs.length, 1);
  await assert.rejects(
    c.command("messages.send", { ...payload, body: "Different request" }),
    /already used/,
  );
});

test("delegated result returns to parent without deadlocking one worker", async (t) => {
  let reviewer,
    calls = 0;
  const { c, employees, send } = await fixture(t, async ({ harness }) => {
    calls++;
    if (calls === 1)
      return (
        "Assigning review.\n```anybot\n" +
        JSON.stringify({
          type: "delegate",
          employeeId: reviewer,
          objective: "Review the implementation",
        }) +
        "\n```"
      );
    return harness === "claude" ? "Review complete" : "Final summary";
  });
  reviewer = employees[1].id;
  await send("Build and review");
  await settled(c);
  assert.equal(calls, 3);
  assert.equal(c.snapshot().messages.at(-1).body, "Final summary");
  assert.ok(c.snapshot().runs.every((r) => r.status === "succeeded"));
});

test("delegation cannot cross conversation membership", async (t) => {
  const { c, employees, send } = await fixture(
    t,
    async () =>
      '```anybot\n{"type":"delegate","employeeId":"outsider","objective":"Steal context"}\n```',
  );
  await send("Task");
  await settled(c);
  assert.equal(c.snapshot().runs.length, 1);
  assert.match(c.snapshot().messages.at(-1).body, /another employee/);
});

test("pause prevents dispatch and cancellation stops a running harness", async (t) => {
  const { c, send } = await fixture(
    t,
    ({ signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Cancelled")), {
          once: true,
        }),
      ),
  );
  await c.command("runtime.pause");
  await send("Wait");
  assert.equal(c.snapshot().runs[0].status, "queued");
  await c.command("runtime.resume");
  assert.equal(c.snapshot().runs[0].status, "running");
  await c.command("runs.cancel", { id: c.snapshot().runs[0].id });
  await settled(c);
  assert.equal(c.snapshot().runs[0].status, "cancelled");
});

test("queued turns include preceding results and exclude later human messages", async (t) => {
  const prompts = [],
    releases = [];
  const { c, send } = await fixture(
    t,
    ({ prompt, signal }) =>
      new Promise((resolve, reject) => {
        prompts.push(prompt);
        releases.push(resolve);
        signal.addEventListener("abort", () => reject(new Error("Cancelled")), {
          once: true,
        });
      }),
  );
  await send("First assignment");
  await send("Second assignment");
  await send("Third assignment");
  // The first run prepares its inbox before its harness starts.
  while (!prompts.length) await new Promise((r) => setTimeout(r, 5));
  assert.equal(prompts.length, 1);
  releases[0]("First completed result");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /First completed result/);
  assert.match(prompts[1], /Your current assignment:\nSecond assignment/);
  assert.doesNotMatch(prompts[1], /Third assignment/);
  releases[1]("Second completed result");
  await new Promise((r) => setTimeout(r, 20));
  releases[2]("Third completed result");
  await settled(c);
  assert.equal(c.store.one("SELECT count(*) AS n FROM run_inputs").n, 3);
});

test("paused queue persists without being automatically dispatched after restart", async (t) => {
  const { c, directory, send } = await fixture(t);
  await c.command("runtime.pause");
  await send("Saved queued assignment");
  await c.close();
  let calls = 0;
  const reopened = new Coordinator({
    directory,
    probe: async () => [],
    runner: async () => {
      calls++;
      return "Done";
    },
  });
  await reopened.initialize();
  assert.equal(reopened.snapshot().runtime.paused, true);
  assert.equal(reopened.snapshot().runs[0].status, "queued");
  assert.equal(calls, 0);
  await reopened.command("runtime.resume");
  await settled(reopened);
  assert.equal(calls, 1);
  await reopened.close();
});

test("unknown operations and implicit trust are denied", async (t) => {
  const { c } = await fixture(t);
  await assert.rejects(c.command("exec", { command: "anything" }), /Unknown/);
  await assert.rejects(
    c.command("employees.create", { name: "X", role: "Y", harness: "codex" }),
    /Acknowledge/,
  );
});

test("dismissed run state persists across coordinator restart", async (t) => {
  const { c, directory, send } = await fixture(t, async () => {
    throw new Error("Intentional failure for dismiss test");
  });
  await send("Fail this task");
  await settled(c);
  const failedRun = c.snapshot().runs[0];
  assert.equal(failedRun.status, "failed");
  assert.equal(failedRun.dismissed, false);
  await c.command("runs.dismiss", { id: failedRun.id });
  assert.equal(c.snapshot().runs[0].dismissed, true);
  await c.close();
  const reopened = new Coordinator({
    directory,
    probe: async () => [],
    runner: async () => "Done",
  });
  await reopened.initialize();
  const restoredRun = reopened.snapshot().runs[0];
  assert.equal(restoredRun.id, failedRun.id);
  assert.equal(restoredRun.status, "failed");
  assert.equal(restoredRun.dismissed, true);
  await reopened.close();
});

test("only failed, interrupted, or cancelled runs can be dismissed", async (t) => {
  const { c, send } = await fixture(t);
  await send("Complete this task");
  await settled(c);
  const successRun = c.snapshot().runs[0];
  assert.equal(successRun.status, "succeeded");
  await assert.rejects(
    c.command("runs.dismiss", { id: successRun.id }),
    /Only failed, interrupted, or cancelled/,
  );
});

test("adapter boundaries preserve structured failures and exclude supervisor secrets", () => {
  assert.deepEqual(
    extractEvent("codex", {
      type: "turn.failed",
      error: { message: "Denied" },
    }),
    { error: "Denied" },
  );
  assert.deepEqual(
    extractEvent("claude", {
      type: "result",
      is_error: true,
      result: "Login needed",
    }),
    { error: "Login needed" },
  );
  assert.deepEqual(
    childEnvironment({
      PATH: "a",
      ANYBOT_TOKEN: "secret",
      CODEX_THREAD_ID: "parent",
      HOME: "home",
    }),
    { PATH: "a", HOME: "home" },
  );
  assert.ok(!invocation("hermes").includes("--oneshot"));
  assert.ok(!invocation("codex").some((a) => a.includes("bypass")));
  assert.equal(
    redact("Authorization: Bearer abc123"),
    "Authorization: Bearer [redacted]",
  );
});

test("a workspace paused before 0.3.18 resumes once on update; a pause set after that is kept", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-pause-reset-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const open = () => new Coordinator({ directory, probe: async () => [], runner: async () => "ok" });
  let c = open();
  await c.command("runtime.pause");
  // An older app never wrote the reset marker.
  c.store.run("DELETE FROM metadata WHERE key='pauseReset'");
  await c.close();
  c = open();
  assert.equal(c.snapshot().runtime.paused, false, "the stale pause is cleared once");
  await c.command("runtime.pause");
  await c.close();
  c = open();
  assert.equal(c.snapshot().runtime.paused, true, "a pause set now survives restarts");
  await c.close();
});

test("a run cut off by quitting is recorded as interrupted, and the next start tells the chat and the delegator", async (t) => {
  let reviewer;
  const { c, directory, employees, send } = await fixture(t, async ({ harness, signal }) => {
    if (harness === "codex")
      return `Assigning review.\n\`\`\`anybot\n${JSON.stringify({ type: "delegate", employeeId: reviewer, objective: "Review the implementation" })}\n\`\`\``;
    // The reviewer is mid-work when Any Bot quits.
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("Run cancelled"))));
  });
  reviewer = employees[1].id;
  await send("Build and review");
  const deadline = Date.now() + 30000;
  while (!c.snapshot().runs.some((r) => r.employee === reviewer && r.status === "running")) {
    if (Date.now() > deadline) throw new Error("the reviewer never started");
    await new Promise((r) => setTimeout(r, 10));
  }
  await c.close();
  const prompts = [];
  const reopened = new Coordinator({
    directory,
    probe: async () => [],
    runner: async ({ prompt }) => {
      prompts.push(prompt);
      return "Re-planned the review";
    },
  });
  await reopened.initialize();
  await settled(reopened);
  const snap = reopened.snapshot();
  const cut = snap.runs.find((r) => r.employee === reviewer);
  assert.equal(cut.status, "interrupted", "a quit is not the owner pressing Stop");
  assert.match(cut.error, /Any Bot stopped during this run/);
  const notice = snap.messages.find((m) => m.kind === "notice" && /Reviewer's run was cut off/.test(m.body));
  assert.ok(notice, "the chat says the work stopped");
  assert.equal(notice.thread, cut.thread);
  // The delegator hears about it and goes on.
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Interrupted: Any Bot stopped before this work finished/);
  assert.equal(snap.runs.at(-1).employee, employees[0].id);
  assert.equal(snap.runs.at(-1).status, "succeeded");
  // Reconciling happens once.
  await reopened.close();
  const again = new Coordinator({ directory, probe: async () => [], runner: async () => "ok" });
  await again.initialize();
  assert.equal(again.snapshot().messages.filter((m) => /was cut off/.test(m.body)).length, 1);
  await again.close();
});

test("runs left running by a crash are reconciled at the next start; one the owner was stopping stays stopped", async (t) => {
  const { c, directory, conversation, employees, send } = await fixture(t);
  await c.command("runtime.pause");
  await c.command("tasks.create", { conversation: conversation.id, title: "Edit the video", assignees: [employees[0].id] });
  const taskId = c.snapshot().tasks[0].id;
  await c.command("tasks.start", { id: taskId });
  await send("Something the owner then stopped");
  await c.close();
  // What a hard kill leaves behind: rows still marked running or cancelling.
  const store = new Store(directory);
  const [taskRun, stoppedRun] = store.all("SELECT id FROM runs ORDER BY rowid").map((r) => r.id);
  store.run("UPDATE runs SET status='running' WHERE id=?", taskRun);
  store.run("UPDATE runs SET status='cancelling' WHERE id=?", stoppedRun);
  store.close();
  const diagnostics = [];
  const reopened = new Coordinator({ directory, probe: async () => [], runner: async () => "ok" });
  reopened.on("diagnostic", (entry) => diagnostics.push(entry));
  try {
    await reopened.initialize();
    const status = Object.fromEntries(reopened.snapshot().runs.map((r) => [r.id, r.status]));
    assert.deepEqual([status[taskRun], status[stoppedRun]], ["interrupted", "cancelled"]);
    const notices = reopened.snapshot().messages.filter((m) => m.kind === "notice").map((m) => m.body);
    assert.equal(notices.filter((body) => /was cut off/.test(body)).length, 1, "only the interrupted run gets a notice");
    const detail = await reopened.command("tasks.get", { id: taskId });
    assert.ok(detail.activity.some((entry) => entry.kind === "notice" && /cut off when Any Bot stopped/.test(entry.body)));
    assert.ok(detail.activity.some((entry) => /did not finish/.test(entry.body)));
    assert.deepEqual(diagnostics.map((d) => [d.code, d.message]), [["run.interrupted", "1 run was cut off when Any Bot stopped"]]);
  } finally {
    await reopened.close();
  }
});

test("if following up cut-off work fails, the runs are still marked and the runtime still starts", async (t) => {
  const { c, directory, conversation, employees } = await fixture(t);
  await c.command("runtime.pause");
  await c.command("tasks.create", { conversation: conversation.id, title: "Edit", assignees: [employees[0].id] });
  await c.command("tasks.start", { id: c.snapshot().tasks[0].id });
  await c.close();
  const store = new Store(directory);
  store.run("UPDATE runs SET status='running'");
  store.close();
  const settle = Coordinator.prototype.settleTask;
  Coordinator.prototype.settleTask = () => {
    throw new Error("settle broke");
  };
  let reopened;
  try {
    reopened = new Coordinator({ directory, probe: async () => [], runner: async () => "ok" });
  } finally {
    Coordinator.prototype.settleTask = settle;
  }
  const diagnostics = [];
  reopened.on("diagnostic", (entry) => diagnostics.push(entry));
  try {
    await reopened.initialize();
    assert.deepEqual(reopened.snapshot().runs.map((r) => r.status), ["interrupted"]);
    assert.deepEqual(diagnostics.map((d) => d.code), ["run.reconcile_failed"]);
  } finally {
    await reopened.close();
  }
});

// "Install when idle" (desktop/main.cjs): the update waits for running work,
// nothing new starts meanwhile, and queued work waits for after the restart.
test("an update waiting for the team holds new work and reports what's still running", async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { c, send } = await fixture(t, async ({ signal }) => {
    await Promise.race([gate, new Promise((resolve) => signal.addEventListener("abort", resolve))]);
    return "Finished";
  });
  await send("Long job");
  const until = async (check, what) => {
    for (let i = 0; i < 500; i++) {
      if (check(await c.command("runtime.activity"))) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  await until((a) => a.running === 1, "the run to start");
  assert.deepEqual(await c.command("runtime.activity"), { running: 1, queued: 0, holding: false, bots: ["Builder"] });
  assert.equal((await c.command("runtime.hold", { hold: true })).holding, true);
  await send("Next job");
  release();
  await until((a) => a.running === 0, "the first run to finish");
  const idle = await c.command("runtime.activity");
  assert.deepEqual([idle.queued, idle.holding], [1, true], "the next job waits");
  assert.equal(c.snapshot().runtime.paused, false, "holding isn't the owner's pause");
  await c.command("runtime.hold", { hold: false });
  await until((a) => a.queued === 0 && a.running === 0, "the held job to run");
});

// A coordinator that restarts while an update waits for the team starts
// holding (main passes --hold), not once it's ready: its first dispatch and
// autopilot tick would otherwise start queued work.
test("a coordinator started holding starts no queued work until released", async (t) => {
  const { c, directory, send } = await fixture(t);
  await c.command("runtime.hold", { hold: true });
  await send("Queued before the restart");
  await c.close();
  const ran = [];
  const reopened = new Coordinator({ directory, probe: async () => [], runner: async (options) => (ran.push(options), "ok"), holding: true });
  try {
    await reopened.initialize();
    await new Promise((r) => setTimeout(r, 700)); // past a dispatch tick
    assert.equal(ran.length, 0);
    assert.equal((await reopened.command("runtime.activity")).holding, true);
    await reopened.command("runtime.hold", { hold: false });
    for (let i = 0; i < 500 && !ran.length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(ran.length, 1, "released, the queued work runs");
  } finally {
    await reopened.close();
  }
});
