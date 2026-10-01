// The safety floor (0.3.37): backups before a schema upgrade, a heartbeat
// that survives a bad step, no work for archived bots, review loops that
// close, mentions that stay inside their work's limits, a cap on tasks that
// keep bouncing back to Backlog, indexes for per-bot counts, and labels on
// messages that arrive from outside the desktop app.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../runtime/store.mjs";
import { Coordinator } from "../runtime/coordinator.mjs";
import { createMobileGateway } from "../runtime/mobile-gateway.mjs";
import { installCrashHandlers, scrubPaths } from "../runtime/diagnostics.mjs";
import { ownerAuthority } from "../runtime/origin.mjs";
import { describeIssue } from "../src/lib/diagnostics.js";

const actions = (list, prose = "Done.") => `${prose}\n\n\`\`\`anybot-actions\n${JSON.stringify(list)}\n\`\`\``;
const delegate = (employeeId, objective) =>
  `Handing off.\n\`\`\`anybot\n${JSON.stringify({ type: "delegate", employeeId, objective })}\n\`\`\``;
const pause = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
// Counts turns, not clock time, so it also works while a test fakes Date.
async function until(check, what = "the condition", turns = 1000) {
  for (let turn = 0; !(await check()); turn++) {
    if (turn > turns) throw new Error(`Timed out waiting for ${what}`);
    await pause();
  }
}
const settled = (c) =>
  until(() => !c.snapshot().runs.some((r) => ["queued", "running", "cancelling"].includes(r.status)), "the queue to settle");

// Bots answer from `reply(name, options)`; a function in a script list runs
// when that turn comes up. Every bot has its own workspace folder.
async function team(t, reply = () => "ok", { names = ["Chief", "Lead", "Junior", "Peer"], ...options } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-safety-"));
  const calls = [];
  let byWorkspace = {};
  const c = new Coordinator({
    directory,
    concurrency: 1,
    probe: async () => [],
    runner: async (run) => {
      const name = byWorkspace[run.workspace];
      calls.push({ name, prompt: run.prompt });
      const value = await reply(name, run);
      if (value instanceof Error) throw value;
      return value;
    },
    ...options,
  });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  for (const name of names) await c.command("employees.create", { name, role: name, harness: "codex", trusted: true });
  const e = Object.fromEntries(c.snapshot().employees.map((x) => [x.name, x]));
  byWorkspace = Object.fromEntries(Object.values(e).map((x) => [x.workspace, x.name]));
  const room = async (title, members) => {
    await c.command("conversations.create", { title, members: members.map((m) => m.id) });
    return c.snapshot().conversations.at(-1);
  };
  const archive = async (bot) => {
    const { revision } = c.snapshot().employees.find((x) => x.id === bot.id);
    await c.command("employees.setArchived", { id: bot.id, revision, archived: true });
  };
  const task = (title) => c.snapshot().tasks.find((x) => x.title === title);
  const activity = async (title) => (await c.command("tasks.get", { id: task(title).id })).activity;
  const runsOf = (bot) => c.snapshot().runs.filter((r) => r.employee === bot.id);
  return { c, e, calls, directory, room, archive, task, activity, runsOf };
}
const scripted = (script) => (name) => {
  const next = script[name]?.shift();
  return typeof next === "function" ? next() : (next ?? "ok");
};

// Backups -------------------------------------------------------------------

async function v14Into(directory) {
  for (const suffix of ["", "-wal", "-shm"]) await rm(join(directory, `anybot.sqlite${suffix}`), { force: true });
  const db = new DatabaseSync(join(directory, "anybot.sqlite"));
  db.exec(await readFile(new URL("./fixtures/schema-v14.sql", import.meta.url), "utf8"));
  db.close();
}
const backups = async (directory) => (await readdir(directory)).filter((f) => /^anybot\.backup-v14-to-v18-.+\.sqlite$/.test(f));
const allBackups = async (directory) => (await readdir(directory)).filter((f) => /^anybot\.backup-v\d+-to-v\d+-.+\.sqlite$/.test(f));
const schemaOf = (file) => {
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    return copy.prepare("SELECT value FROM metadata WHERE key='schema'").get().value;
  } finally {
    copy.close();
  }
};

test("1. an older workspace is backed up before it's upgraded, and only the newest three backups are kept", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-backup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // A backup someone made by hand is never pruned.
  await writeFile(join(directory, "anybot.backup-2026-09-28-before-life-org.sqlite"), "kept");
  // Backups from three earlier upgrades.
  const earlier = [
    "anybot.backup-v11-to-v12-20010101-090000.sqlite",
    "anybot.backup-v12-to-v13-20010201-090000.sqlite",
    "anybot.backup-v13-to-v14-20010301-090000.sqlite",
  ];
  for (const name of earlier) await writeFile(join(directory, name), "old");
  await v14Into(directory);
  new Store(directory).close();
  const [first, ...others] = await backups(directory);
  assert.ok(first, "a backup was written");
  assert.deepEqual(others, [], "exactly one");
  assert.equal(schemaOf(join(directory, first)), "14", "the backup is the old workspace");
  const copy = new DatabaseSync(join(directory, first), { readOnly: true });
  assert.equal(copy.prepare("SELECT name FROM employees WHERE id='e1'").get().name, "Builder");
  copy.close();
  assert.deepEqual((await allBackups(directory)).sort(), [...earlier.slice(1), first].sort(), "the oldest earlier backup went");
  // Opening a current workspace writes nothing.
  new Store(directory).close();
  assert.equal((await backups(directory)).length, 1);
  // The same upgrade three more times (the old workspace put back each
  // time): the newest three stay, and so does the first copy made for this
  // upgrade, the one the version before it can open.
  for (let i = 0; i < 3; i++) {
    await v14Into(directory);
    new Store(directory).close();
  }
  const kept = await allBackups(directory);
  assert.equal(kept.length, 4);
  assert.ok(kept.includes(first), "the first copy for this upgrade is kept");
  assert.ok(!kept.some((f) => earlier.includes(f)), "earlier upgrades' backups gave way to newer ones");
  assert.equal(await readFile(join(directory, "anybot.backup-2026-09-28-before-life-org.sqlite"), "utf8"), "kept");
});

test("1c. an upgrade that keeps failing part-way never loses the copy of the workspace as it was", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-backup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await v14Into(directory);
  // Steps 15 and 16 go through; step 17 fails every time (a bug in it, say).
  const db = new DatabaseSync(join(directory, "anybot.sqlite"));
  db.exec(
    "CREATE TRIGGER step17 BEFORE UPDATE ON metadata WHEN NEW.key='schema' AND NEW.value='17' BEGIN SELECT RAISE(ABORT, 'step 17 failed'); END",
  );
  db.close();
  // The first start and main's three restarts, then one more after "Restart Any Bot".
  for (let start = 0; start < 5; start++) assert.throws(() => new Store(directory), /step 17 failed/);
  const live = new DatabaseSync(join(directory, "anybot.sqlite"), { readOnly: true });
  assert.equal(live.prepare("SELECT value FROM metadata WHERE key='schema'").get().value, "16", "steps 15 and 16 stayed");
  live.close();
  const kept = await allBackups(directory);
  const original = kept.filter((f) => f.startsWith("anybot.backup-v14-to-v18-"));
  assert.equal(original.length, 1, "the copy made before the upgrade began is still there");
  assert.equal(schemaOf(join(directory, original[0])), "14");
  assert.ok(kept.length <= 4, `retries don't pile up copies (${kept.length})`);
  assert.ok(kept.every((f) => /^anybot\.backup-v1[46]-to-v18-/.test(f)));
});

test("1b. a workspace that can't be backed up isn't upgraded", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-backup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await v14Into(directory);
  assert.throws(
    () =>
      new Store(directory, {
        backup: () => {
          throw new Error("disk full");
        },
      }),
    /couldn't back up .*schema 14 to 18.*left it unchanged.*disk full/i,
  );
  const db = new DatabaseSync(join(directory, "anybot.sqlite"));
  assert.equal(db.prepare("SELECT value FROM metadata WHERE key='schema'").get().value, "14", "left as it was");
  db.close();
  assert.deepEqual(await backups(directory), []);
});

// The heartbeat ---------------------------------------------------------------

test("2. a timer step that throws is logged at most once a minute, and queued work still starts", async (t) => {
  let time = Date.now();
  const { c, e, room } = await team(t, () => "Done", { names: ["Solo"], clock: () => time });
  const diagnostics = [];
  c.on("diagnostic", (entry) => diagnostics.push(entry));
  c.routines.tick = () => {
    throw new Error("routine table exploded at C:\\Users\\someone\\secret\\notes.txt");
  };
  const chat = await room("Solo", [e.Solo]);
  // Queued without a dispatch call: only the timer can start it.
  c.addRun(chat.id, e.Solo.id, c.addMessage(chat.id, "human", "user", "Hello"));
  await until(() => c.snapshot().runs[0].status === "succeeded", "the queued run");
  await pause(1200); // a few more ticks
  const failures = () => diagnostics.filter((d) => d.code === "runtime.tick_failed");
  assert.equal(failures().length, 1, "once per minute");
  assert.equal(failures()[0].context.step, "routines");
  assert.match(failures()[0].message, /routine table exploded/);
  assert.doesNotMatch(failures()[0].message + failures()[0].detail, /someone|secret/, "no paths");
  time += 61_000;
  await until(() => failures().length === 2, "the next minute's entry");
});

test("2b. a routine that can't queue is recorded as failed, and the others still run", async (t) => {
  let time = 1_000_000;
  const { c, e, room } = await team(t, () => "Done", { clock: () => time });
  clearInterval(c.timer);
  await c.command("runtime.pause");
  const good = await room("Ops", [e.Chief]);
  const old = await room("Old", [e.Lead]);
  for (const [conversation, employee, name] of [
    [old, e.Lead, "Broken"],
    [good, e.Chief, "Fine"],
  ])
    await c.command("routines.create", { name, prompt: "Check in", employee: employee.id, conversation: conversation.id, minutes: 5 });
  // An older version (or a script) archived the bot but left its routine on.
  c.store.run("UPDATE employees SET archived=1 WHERE id=?", e.Lead.id);
  const diagnostics = [];
  c.on("diagnostic", (entry) => diagnostics.push(entry));
  c.paused = false;
  time += 300_000;
  c.routines.tick();
  c.routines.tick();
  const routines = Object.fromEntries(c.snapshot().routines.map((r) => [r.name, r]));
  assert.deepEqual(c.snapshot().runs.map((r) => r.employee), [e.Chief.id], "the good routine queued");
  assert.equal(routines.Broken.lastOccurrence, "failed");
  assert.equal(routines.Broken.nextRun, time + 300_000, "its next time is scheduled");
  assert.equal(diagnostics.filter((d) => d.code === "routine.enqueue_failed").length, 1);
  assert.match(diagnostics.find((d) => d.code === "routine.enqueue_failed").message, /archived/);
});

// Archived bots -----------------------------------------------------------------

test("3. queued work for an archived bot is cancelled, never run, with one notice per conversation", async (t) => {
  const { c, e, calls, room, runsOf } = await team(t);
  const chat = await room("Chief", [e.Chief]);
  const other = await room("Lead", [e.Lead]);
  await c.command("runtime.pause");
  for (const body of ["First", "Second"])
    await c.command("messages.send", { conversation: chat.id, body, requestId: crypto.randomUUID() });
  await c.command("messages.send", { conversation: other.id, body: "Still working", requestId: crypto.randomUUID() });
  // Archiving asks for no work in flight, but work can still arrive for an
  // archived bot (a hand-off coming back to it), so it is set directly.
  c.store.run("UPDATE employees SET archived=1 WHERE id=?", e.Chief.id);
  await c.command("runtime.resume");
  await settled(c);
  assert.deepEqual(runsOf(e.Chief).map((r) => r.status), ["cancelled", "cancelled"]);
  assert.deepEqual(calls.map((call) => call.name), ["Lead"], "only the active bot ran");
  const notices = c.snapshot().messages.filter((m) => m.conversation === chat.id && m.kind === "notice");
  assert.equal(notices.length, 1);
  assert.match(notices[0].body, /Chief is archived/);
});

test("4. a reviewer's Changes on a task whose lead is archived starts no run and says so", async (t) => {
  const { c, e, room, archive, task, activity, runsOf } = await team(t, (name) =>
    name === "Chief"
      ? actions([{ type: "review", task: task("Pricing").id.slice(0, 8), decision: "changes", comment: "Add the FAQ" }])
      : "ok",
  );
  const project = await room("Launch", [e.Lead, e.Chief]);
  await c.command("runtime.pause");
  await c.command("tasks.create", { conversation: project.id, title: "Pricing", assignees: [e.Lead.id], reviewer: e.Chief.id });
  await c.command("tasks.move", { id: task("Pricing").id, status: "review" });
  await archive(e.Lead);
  await c.command("runtime.resume");
  await settled(c);
  assert.equal(runsOf(e.Chief).length, 1, "the review ran");
  assert.equal(runsOf(e.Lead).length, 0, "no run for the archived lead");
  assert.equal(task("Pricing").status, "in_progress");
  assert.ok((await activity("Pricing")).some((a) => a.kind === "notice" && /Lead is archived/.test(a.body)));
  assert.ok(c.snapshot().messages.some((m) => m.kind === "notice" && /Lead is archived/.test(m.body)), "the chat says so");
});

test("5. a task entering Review with an archived reviewer goes to that reviewer's manager", async (t) => {
  const { c, e, room, archive, task, activity, runsOf } = await team(
    t,
    (name) => (name === "Chief" ? actions([{ type: "review", task: task("Pricing").id.slice(0, 8), decision: "approve" }]) : "ok"),
    { names: ["Chief", "Lead", "Junior", "Peer", "Temp", "Boss", "Helper"] },
  );
  // Chief manages Junior and the lead, so it may review the lead's work.
  await c.command("employees.setManager", { id: e.Junior.id, manager: e.Chief.id });
  await c.command("employees.setManager", { id: e.Lead.id, manager: e.Chief.id });
  // Boss manages Temp but has nothing to do with this project or its lead.
  await c.command("employees.setManager", { id: e.Temp.id, manager: e.Boss.id });
  // Helper's manager is Lead, who is doing the work.
  await c.command("employees.setManager", { id: e.Helper.id, manager: e.Lead.id });
  const project = await room("Launch", [e.Lead, e.Junior, e.Peer, e.Temp, e.Helper]);
  await c.command("runtime.pause");
  for (const [title, reviewer] of [
    ["Pricing", e.Junior],
    ["Orphan", e.Peer],
    ["Outside", e.Temp],
    ["Own work", e.Helper],
  ])
    await c.command("tasks.create", { conversation: project.id, title, assignees: [e.Lead.id], reviewer: reviewer.id });
  for (const bot of [e.Junior, e.Peer, e.Temp, e.Helper]) await archive(bot);
  for (const title of ["Pricing", "Orphan", "Outside", "Own work"]) await c.command("tasks.move", { id: task(title).id, status: "review" });
  assert.deepEqual(
    c.snapshot().runs.map((r) => [r.employee, r.task]),
    [[e.Chief.id, task("Pricing").id]],
    "the manager reviews; otherwise the owner decides",
  );
  assert.equal(task("Pricing").reviewer, e.Chief.id);
  assert.equal(task("Outside").reviewer, e.Temp.id, "a manager who can't review here doesn't become the reviewer");
  const notice = async (title) => (await activity(title)).find((a) => a.kind === "notice")?.body || "";
  assert.match(await notice("Pricing"), /Junior is archived.*Chief/);
  assert.match(await notice("Orphan"), /Peer is archived and has no active manager.*you decide: Approve, or Request changes/);
  assert.match(await notice("Outside"), /Temp is archived.*Boss.*isn't in this project.*you decide: Approve, or Request changes/);
  assert.match(await notice("Own work"), /Helper is archived.*Lead.*working on this task.*you decide: Approve, or Request changes/);
  await c.command("runtime.resume");
  await settled(c);
  assert.equal(task("Pricing").status, "done", "the manager's verdict counts");
  assert.equal(runsOf(e.Boss).length, 0, "no review run outside the project");
  assert.equal(runsOf(e.Junior).length + runsOf(e.Peer).length + runsOf(e.Temp).length + runsOf(e.Helper).length, 0);
});

test("6. the owner's Changes starts exactly one run for the lead", async (t) => {
  const { c, e, room, task, activity } = await team(t);
  const project = await room("Launch", [e.Lead, e.Junior]);
  await c.command("runtime.pause");
  await c.command("tasks.create", { conversation: project.id, title: "Pricing", assignees: [e.Lead.id, e.Junior.id], reviewer: "" });
  await c.command("tasks.move", { id: task("Pricing").id, status: "review" });
  await c.command("tasks.review", { id: task("Pricing").id, decision: "changes", comment: "Tighten the copy" });
  const runs = () => c.snapshot().runs.filter((r) => r.task === task("Pricing").id);
  assert.deepEqual(runs().map((r) => r.employee), [e.Lead.id], "the lead, not the collaborator");
  const brief = c.snapshot().messages.find((m) => m.id === runs()[0].message);
  assert.equal(brief.body, "Changes requested by the owner: Tighten the copy");
  assert.equal(brief.author, "human");
  // Sent back again while that run still waits: still one run.
  await c.command("tasks.move", { id: task("Pricing").id, status: "review" });
  await c.command("tasks.review", { id: task("Pricing").id, decision: "changes", comment: "And the title" });
  assert.equal(runs().length, 1);
  assert.ok((await activity("Pricing")).some((a) => a.kind === "comment" && a.body === "And the title"), "the comment is kept");
  await c.command("runtime.resume");
  await settled(c);
  assert.equal(task("Pricing").status, "done", "the lead's round settles the card");
});

// Mentions ----------------------------------------------------------------------

// Chief's routine runs in its direct chat and hands work to Lead, who works in
// the Studio room (Chief isn't a member) and @mentions Junior there.
async function routineHandoff(t, script) {
  const fixture = await team(t, scripted(script));
  const { c, e, room } = fixture;
  await c.command("employees.setManager", { id: e.Lead.id, manager: e.Chief.id });
  const chiefChat = await room("Chief", [e.Chief]);
  const studio = await room("Studio", [e.Lead, e.Junior]);
  await c.command("routines.create", { name: "Plan", prompt: "Plan the week", employee: e.Chief.id, conversation: chiefChat.id, minutes: 60 });
  return { ...fixture, chiefChat, studio, start: () => c.command("routines.runNow", { id: c.snapshot().routines[0].id }) };
}

test("7. a mention in work a routine started joins that work, and its 9th run is refused", async (t) => {
  const script = {};
  const { c, e, studio, start, runsOf } = await routineHandoff(t, script);
  const root = () => c.snapshot().runs[0];
  Object.assign(script, {
    Chief: [
      delegate(e.Lead.id, "Draft the plan"),
      () => {
        // While the delegated work comes back, fill the root to 8 runs.
        for (let i = 0; i < 4; i++)
          c.store.run(
            "INSERT INTO runs(id,conversation,employee,message,root,depth,status,created) VALUES (?,?,?,?,?,?,?,?)",
            crypto.randomUUID(),
            root().conversation,
            e.Peer.id,
            root().message,
            root().id,
            1,
            "cancelled",
            new Date().toISOString(),
          );
        return "Summed up";
      },
    ],
    Lead: ["Drafted. @Junior please check the numbers."],
    Junior: ["Checked. @Lead the totals hold."],
  });
  await start();
  await settled(c);
  const [junior] = runsOf(e.Junior);
  assert.equal(junior.root, root().id, "the mention joined the routine's work");
  assert.equal(junior.depth, 2);
  assert.equal(junior.conversation, studio.id);
  assert.deepEqual(c.runOrigin(junior), { via: "system" }, "a routine's work, not the bot's");
  assert.equal(c.snapshot().runs.filter((r) => r.root === root().id).length, 8);
  assert.equal(runsOf(e.Lead).length, 1, "Junior's @Lead would be the 9th run");
  assert.ok(
    c.snapshot().messages.some((m) => m.kind === "notice" && m.thread === junior.thread && /limit/.test(m.body) && /Lead/.test(m.body)),
  );
});

test("7b. a mention three hand-offs deep in routine work is refused", async (t) => {
  const script = {};
  const { c, e, start, runsOf } = await routineHandoff(t, script);
  Object.assign(script, {
    Chief: [delegate(e.Lead.id, "Draft the plan"), "Summed up"],
    Lead: ["Drafted. @Junior please check the numbers.", "Fixed. @Junior once more?"],
    Junior: ["@Lead two totals are off."],
  });
  await start();
  await settled(c);
  assert.deepEqual(runsOf(e.Lead).map((r) => r.depth), [1, 3]);
  assert.deepEqual(runsOf(e.Junior).map((r) => r.depth), [2], "the depth-4 mention was refused");
  assert.ok(c.snapshot().messages.some((m) => m.kind === "notice" && /limit/.test(m.body) && /Junior/.test(m.body)));
});

test("7c. in the owner's own thread, each mention still starts fresh work", async (t) => {
  const { c, e, room, runsOf } = await team(
    t,
    scripted({
      Lead: ["@Junior please check the numbers.", "@Junior fixed, again please.", "@Junior and once more."],
      Junior: ["@Lead two totals are off.", "@Lead one more.", "Looks right."],
    }),
  );
  const studio = await room("Studio", [e.Lead, e.Junior]);
  await c.command("messages.send", { conversation: studio.id, body: "@Lead draft the plan", requestId: crypto.randomUUID() });
  await settled(c);
  const mentioned = [...runsOf(e.Lead).slice(1), ...runsOf(e.Junior)];
  assert.equal(mentioned.length, 5, "the bots passed it around past the depth limit");
  for (const run of mentioned) assert.deepEqual([run.root, run.depth], [run.id, 0]);
  assert.ok(!c.snapshot().messages.some((m) => m.kind === "notice" && /limit/.test(m.body)));
  // Each of those runs is still the owner's work, typed at this computer.
  for (const run of mentioned) {
    assert.equal(c.startedByPeople(run), true);
    assert.deepEqual(c.runOrigin(run), { via: "desktop" });
  }
});

// Autopilot -------------------------------------------------------------------

test("8. autopilot starts a task that keeps bouncing back to Backlog at most 3 times a day", async (t) => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-29T09:00:00.000Z") });
  t.after(() => mock.timers.reset());
  let ref = "";
  const { c, e, room, task, activity } = await team(t, (name) =>
    name === "Lead" ? actions([{ type: "task.update", task: ref, status: "backlog" }], "Not ready yet.") : "ok",
  );
  clearInterval(c.timer); // only the test's own ticks
  const diagnostics = [];
  c.on("diagnostic", (entry) => diagnostics.push(entry));
  const project = await room("Launch", [e.Lead, e.Junior]);
  await c.command("tasks.create", { conversation: project.id, title: "Bouncy", assignees: [e.Lead.id], reviewer: "" });
  ref = task("Bouncy").id.slice(0, 8);
  await c.command("conversations.setAutopilot", { conversation: project.id, enabled: true });
  const tick = async () => {
    c.lastAutopilot = 0;
    c.autopilot();
    await settled(c);
    mock.timers.tick(60_000);
  };
  const starts = async () => (await activity("Bouncy")).filter((a) => a.kind === "started" && a.author === "system").length;
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(await starts(), 3);
  assert.equal(task("Bouncy").status, "backlog");
  assert.equal((await activity("Bouncy")).filter((a) => a.kind === "notice" && /3 times in 24 hours/.test(a.body)).length, 1);
  assert.equal(diagnostics.filter((d) => d.code === "autopilot.bounce_capped").length, 1);
  // A day later it gets another try.
  mock.timers.tick(24 * 3600_000);
  await tick();
  assert.equal(await starts(), 4);
});

test("8c. a task that keeps bouncing day after day gets at most one note a day", async (t) => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-29T09:00:00.000Z") });
  t.after(() => mock.timers.reset());
  let ref = "";
  const { c, e, room, task, activity } = await team(t, (name) =>
    name === "Lead" ? actions([{ type: "task.update", task: ref, status: "backlog" }], "Not ready yet.") : "ok",
  );
  clearInterval(c.timer);
  const diagnostics = [];
  c.on("diagnostic", (entry) => diagnostics.push(entry));
  const project = await room("Launch", [e.Lead, e.Junior]);
  await c.command("tasks.create", { conversation: project.id, title: "Bouncy", assignees: [e.Lead.id], reviewer: "" });
  ref = task("Bouncy").id.slice(0, 8);
  await c.command("conversations.setAutopilot", { conversation: project.id, enabled: true });
  const tickAt = async (day, minute) => {
    mock.timers.setTime(Date.parse(`2026-09-${day}T09:${String(minute).padStart(2, "0")}:00.000Z`));
    c.lastAutopilot = 0;
    c.autopilot();
    await settled(c);
  };
  // Day one: starts ten minutes apart, then the cap and its note.
  for (const minute of [0, 10, 20, 30]) await tickAt(29, minute);
  // Day two, checked every minute: each time the oldest start is a day old,
  // the task gets one more start.
  for (let minute = 0; minute <= 40; minute++) await tickAt(30, minute);
  const log = await activity("Bouncy");
  const starts = log.filter((a) => a.kind === "started" && a.author === "system").map((a) => Date.parse(a.created));
  const notes = log.filter((a) => a.kind === "notice" && /3 times in 24 hours/.test(a.body)).map((a) => Date.parse(a.created));
  assert.equal(starts.length, 6);
  for (const start of starts) assert.ok(starts.filter((s) => s >= start && s < start + 24 * 3600_000).length <= 3, "3 starts a day at most");
  assert.equal(notes.length, 2, "one note each day");
  assert.ok(notes[1] - notes[0] >= 24 * 3600_000, "a day apart");
  assert.equal(diagnostics.filter((d) => d.code === "autopilot.bounce_capped").length, 2);
});

test("8b. a task that reached Review since its last starts isn't bouncing", async (t) => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-29T09:00:00.000Z") });
  t.after(() => mock.timers.reset());
  let ref = "";
  const { c, e, room, task, activity } = await team(t, (name) =>
    name === "Lead" ? actions([{ type: "task.update", task: ref, status: "backlog" }], "Not ready yet.") : "ok",
  );
  clearInterval(c.timer);
  const project = await room("Launch", [e.Lead, e.Junior]);
  await c.command("tasks.create", { conversation: project.id, title: "Bouncy", assignees: [e.Lead.id], reviewer: "" });
  ref = task("Bouncy").id.slice(0, 8);
  await c.command("conversations.setAutopilot", { conversation: project.id, enabled: true });
  const tick = async () => {
    c.lastAutopilot = 0;
    c.autopilot();
    await settled(c);
    mock.timers.tick(60_000);
  };
  const starts = async () => (await activity("Bouncy")).filter((a) => a.kind === "started" && a.author === "system").length;
  for (let i = 0; i < 3; i++) await tick();
  // The owner has a look: it goes to Review and back to Backlog.
  await c.command("tasks.move", { id: task("Bouncy").id, status: "review" });
  mock.timers.tick(60_000);
  await c.command("tasks.move", { id: task("Bouncy").id, status: "backlog" });
  mock.timers.tick(60_000);
  await tick();
  assert.equal(await starts(), 4, "the count starts over");
  assert.equal((await activity("Bouncy")).filter((a) => a.kind === "notice").length, 0);
});

// Indexes ---------------------------------------------------------------------

test("9. per-bot and per-day counts use the new indexes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-index-"));
  const store = new Store(directory);
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const plan = (sql, ...args) =>
    store
      .all(`EXPLAIN QUERY PLAN ${sql}`, ...args)
      .map((row) => row.detail)
      .join("\n");
  assert.match(plan("SELECT count(*) AS n FROM runs WHERE employee=? AND created>=?", "e1", "2026-09-29"), /runs_employee_created/);
  assert.match(plan("SELECT count(*) AS n FROM runs WHERE created>=?", "2026-09-29"), /runs_created/);
  assert.match(
    plan("SELECT count(*) AS n FROM task_activity WHERE kind='started' AND created>=?", "2026-09-29"),
    /task_activity_kind_created/,
  );
  assert.match(plan("SELECT count(*) AS n FROM messages WHERE author=? AND created>=?", "human", "2026-09-29"), /messages_author_created/);
});

// Where a message came from ------------------------------------------------------

test("messages from Slack, Buzz or a phone are labelled with where they came from, never as the owner at the desk", async (t) => {
  const { c, e, room, runsOf } = await team(t);
  await c.command("runtime.pause");
  const chat = await room("Chief", [e.Chief]);
  await c.command("messages.send", { conversation: chat.id, body: "From the desk", requestId: "desk-1" });
  const desk = c.snapshot().messages.find((m) => m.body === "From the desk");
  const slack = await c.command("bridge.send", {
    employee: e.Chief.id,
    body: "[Slack DM] price the course",
    requestId: "slack:T1:D1:1.1",
    origin: { via: "slack", team: "T1", user: "U1", channel: "D1" },
  });
  const unlabelled = await c.command("bridge.send", { employee: e.Chief.id, body: "no label", requestId: "other:1" });
  const forged = await c.command("bridge.send", { employee: e.Chief.id, body: "forged", requestId: "other:2", origin: { via: "desktop" } });
  assert.deepEqual(c.messageOrigin(desk.id), { via: "desktop" });
  assert.deepEqual(c.messageOrigin(slack.message), { via: "slack", team: "T1", user: "U1", channel: "D1" });
  assert.deepEqual(c.messageOrigin(unlabelled.message), { via: "bridge" }, "a bridge message is never the desk's");
  assert.deepEqual(c.messageOrigin(forged.message), { via: "bridge" });
  assert.equal(ownerAuthority(c.messageOrigin(desk.id)), true);
  for (const sent of [slack, unlabelled, forged]) assert.equal(ownerAuthority(c.messageOrigin(sent.message)), false);
  // Everything else about the message is unchanged.
  assert.equal(c.snapshot().messages.find((m) => m.id === slack.message).author, "human");
  // A run, and work handed on from it, carry the origin of the message that started it.
  const run = runsOf(e.Chief).find((r) => r.message === slack.message);
  assert.equal(c.runOrigin(run).via, "slack");
  const child = c.addRun(chat.id, e.Chief.id, c.addMessage(chat.id, e.Chief.id, "handoff", "More"), run.id, run.root, 1);
  assert.equal(c.runOrigin(c.store.one("SELECT * FROM runs WHERE id=?", child)).via, "slack");
  assert.equal(c.runOrigin(runsOf(e.Chief).find((r) => r.message === desk.id)).via, "desktop");
  // A routine's work is the system's.
  const routine = c.addMessage(chat.id, "system", "routine", "Routine: check");
  assert.deepEqual(c.messageOrigin(routine), { via: "system" });
});

test("a phone's message is labelled as the phone's, whatever it claims", async (t) => {
  const { c, e, room } = await team(t, () => "ok", { names: ["Chief"] });
  await c.command("runtime.pause");
  const chat = await room("Chief", [e.Chief]);
  const gateway = createMobileGateway({
    command: (...args) => c.command(...args),
    allowInsecureLoopback: true,
    origins: ["https://localhost"],
  });
  const { port } = await gateway.listen();
  t.after(() => gateway.close());
  const post = (path, payload, token) =>
    fetch(`http://127.0.0.1:${port}/v1${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    });
  const paired = await (await post("/pair", { code: gateway.createPairing({ role: "operator", memberId: "owner" }).code, name: "Phone" })).json();
  const sent = await post(
    `/conversations/${chat.id}/messages`,
    { body: "From the phone", requestId: "phone-1", origin: { via: "desktop" } },
    paired.token,
  );
  assert.equal(sent.status, 202);
  const message = c.snapshot().messages.find((m) => m.body === "From the phone");
  assert.deepEqual(c.messageOrigin(message.id), { via: "phone", member: "owner" });
  assert.equal(ownerAuthority(c.messageOrigin(message.id)), false);
});

test("a Buzz mention is labelled as Buzz's", async (t) => {
  process.env.ANYBOT_BUZZ_APP_DATA = join(tmpdir(), `anybot-buzz-app-${process.pid}`);
  const { c } = await team(t, () => "ok", { names: ["Chief"] });
  await c.command("runtime.pause");
  const { message } = c.buzz.accept({ requestId: "evt-1", employee: "Chief", channel: "#launch", body: "ship it" });
  assert.deepEqual(c.messageOrigin(message), { via: "buzz", channel: "#launch" });
  assert.equal(c.runOrigin(c.snapshot().runs.find((r) => r.message === message)).via, "buzz");
});

// The coordinator process ---------------------------------------------------------

test("the coordinator process reports an uncaught error once, without paths, stops starting work, then exits", () => {
  const target = new EventEmitter();
  const reported = [];
  const order = [];
  installCrashHandlers(target, {
    report: (entry) => (reported.push(entry), order.push("report")),
    stop: () => order.push("stop"),
    exit: (code) => order.push(`exit ${code}`),
  });
  const error = new Error("Cannot read properties of undefined (reading 'id') in C:\\Users\\someone\\data\\anybot.sqlite");
  error.stack = `${error.message}\n    at Coordinator.tick (file:///C:/Users/someone/AppData/Local/Programs/anybot/resources/app.asar/runtime/coordinator.mjs:220:14)`;
  target.emit("uncaughtException", error, "uncaughtException");
  target.emit("uncaughtException", new Error("second"), "uncaughtException");
  assert.equal(reported.length, 1, "reported once");
  assert.deepEqual(order, ["stop", "report", "exit 1"], "nothing new starts in the moment before the exit");
  const [entry] = reported;
  assert.equal(entry.code, "runtime.uncaught");
  assert.equal(entry.source, "runtime");
  assert.equal(entry.level, "error");
  assert.match(entry.message, /Cannot read properties/);
  assert.match(entry.detail, /coordinator\.mjs:220:14/, "code locations keep their file name");
  assert.doesNotMatch(`${entry.message}${entry.detail}`, /someone|AppData|anybot\.sqlite/);
  assert.equal(scrubPaths("open '/home/someone/notes.txt' failed"), "open '<path>' failed");
  // A stop that fails still ends in the exit.
  const other = new EventEmitter();
  const exits = [];
  installCrashHandlers(other, {
    report: () => {},
    stop: () => {
      throw new Error("not constructed yet");
    },
    exit: (code) => exits.push(code),
  });
  other.emit("uncaughtException", new Error("boom"), "uncaughtException");
  assert.deepEqual(exits, [1]);
});

test("a rejected promise nobody handled is logged at most once a minute, and the coordinator keeps running", () => {
  const target = new EventEmitter();
  let time = 1_000_000;
  const reported = [];
  const stopped = [];
  const exits = [];
  installCrashHandlers(target, {
    report: (entry) => reported.push(entry),
    stop: () => stopped.push(true),
    exit: (code) => exits.push(code),
    now: () => time,
  });
  const error = new Error("database is locked while saving C:\\Users\\someone\\data\\anybot.sqlite");
  target.emit("unhandledRejection", error);
  target.emit("unhandledRejection", new Error(error.message));
  // Node run with --unhandled-rejections=strict raises it as an uncaught exception instead.
  target.emit("uncaughtException", new Error(error.message), "unhandledRejection");
  assert.deepEqual(exits, [], "it keeps running, as Electron's own default does");
  assert.deepEqual(stopped, []);
  assert.equal(reported.length, 1, "once a minute");
  const [entry] = reported;
  assert.equal(entry.code, "runtime.unhandled_rejection");
  assert.equal(entry.source, "runtime");
  assert.match(entry.message, /database is locked/);
  assert.doesNotMatch(`${entry.message}${entry.detail}`, /someone|anybot\.sqlite/);
  time += 61_000;
  target.emit("unhandledRejection", error);
  target.emit("unhandledRejection", "a reason that isn't an Error");
  assert.equal(reported.length, 3);
  assert.equal(reported[2].message, "a reason that isn't an Error");
  // A real throw still stops it.
  target.emit("uncaughtException", new Error("thrown"), "uncaughtException");
  assert.deepEqual(exits, [1]);
});

test("a run whose clean-up fails is logged, frees its slot, and leaves no rejected promise", async (t) => {
  const { c, e, room } = await team(t, () => "Done", { names: ["Solo"] });
  const diagnostics = [];
  c.on("diagnostic", (entry) => diagnostics.push(entry));
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  t.after(() => process.off("unhandledRejection", listener));
  const release = c.approvals.release.bind(c.approvals);
  let broken = true;
  c.approvals.release = (runId) => {
    if (!broken) return release(runId);
    broken = false;
    throw new Error("release failed");
  };
  const chat = await room("Solo", [e.Solo]);
  await c.command("messages.send", { conversation: chat.id, body: "First", requestId: "first" });
  await until(() => diagnostics.some((d) => d.code === "runtime.tick_failed" && d.context.step === "run"), "the logged failure");
  await c.command("messages.send", { conversation: chat.id, body: "Second", requestId: "second" });
  await until(() => c.snapshot().runs.filter((r) => r.status === "succeeded").length === 2, "the next run");
  await pause(20);
  assert.deepEqual(unhandled, []);
});

test("paths with spaces in them are scrubbed whole", () => {
  for (const [text, expected] of [
    ["open 'C:\\Users\\Jane Doe\\OneDrive\\Home Admin\\bills 2026.pdf'", "open '<path>'"],
    [
      'ENOENT: no such file or directory, mkdir "C:\\Users\\Jane Doe\\AppData\\Roaming\\anybot-desktop\\data"',
      'ENOENT: no such file or directory, mkdir "<path>"',
    ],
    ["read `/home/jane doe/notes/plan b.txt` failed", "read `<path>` failed"],
    ["    at Store (C:\\Program Files\\Any Bot\\resources\\app.asar\\runtime\\store.mjs:12:3)", "    at Store (<path>/store.mjs:12:3)"],
    ["    at C:\\Program Files\\Any Bot\\resources\\app.asar\\desktop\\main.cjs:40:7", "    at <path>/main.cjs:40:7"],
    ["copy failed: C:\\Users\\Jane Doe\\Projects\\Big Client\\contract.pdf", "copy failed: <path>"],
    // Ordinary text stays as it is.
    ["The bot's reply was 'done' and/or 3/4 finished (exit 1)", "The bot's reply was 'done' and/or 3/4 finished (exit 1)"],
  ])
    assert.equal(scrubPaths(text), expected);
});

test("the new problems have plain-language titles", () => {
  for (const code of [
    "runtime.tick_failed",
    "runtime.uncaught",
    "runtime.unhandled_rejection",
    "autopilot.bounce_capped",
    "routine.enqueue_failed",
  ]) {
    const { title, hint } = describeIssue({ code });
    assert.notEqual(title, code, code);
    assert.ok(hint.length > 20, code);
  }
});
