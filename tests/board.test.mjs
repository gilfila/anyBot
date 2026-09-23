import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";

const actions = (list, prose = "Done.") => `${prose}\n\n\`\`\`anybot-actions\n${JSON.stringify(list)}\n\`\`\``;

// replies: (options, employeeName) => string. Prompts are captured per run.
async function fixture(t, replies = () => "Finished", { concurrency = 2 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-board-"));
  const prompts = [];
  let names = {};
  const c = new Coordinator({
    directory,
    concurrency,
    probe: async () => [],
    runner: async (options) => {
      const who = Object.entries(names).find(([, value]) => options.workspace === value.workspace)?.[0];
      prompts.push({ who, prompt: options.prompt });
      const reply = await replies(options, who);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  for (const [name, harness] of [["Lead", "codex"], ["Helper", "claude"], ["Boss", "claude"]])
    await c.command("employees.create", { name, role: name, harness, trusted: true });
  const employees = c.snapshot().employees;
  names = Object.fromEntries(employees.map((e) => [e.name, e]));
  await c.command("conversations.create", {
    title: "Launch",
    members: employees.map((e) => e.id),
    delegation: true,
  });
  const conversation = c.snapshot().conversations[0];
  const task = (title) => c.snapshot().tasks.find((item) => item.title === title);
  return { c, prompts, employees, names, conversation, task };
}
async function settled(c) {
  const deadline = Date.now() + 5000;
  while (c.snapshot().runs.some((r) => ["running", "queued", "cancelling"].includes(r.status))) {
    if (Date.now() > deadline) throw new Error("Queue did not settle");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("owner can create, edit, and reorder tasks within and across columns", async (t) => {
  const { c, conversation, names, task } = await fixture(t);
  for (const title of ["A", "B", "C"]) await c.command("tasks.create", { conversation: conversation.id, title });
  const [a, b, cc] = ["A", "B", "C"].map(task);
  assert.deepEqual([a, b, cc].map((x) => x.status), ["backlog", "backlog", "backlog"]);
  assert.ok(a.sortKey < b.sortKey && b.sortKey < cc.sortKey);
  // Move C between A and B.
  await c.command("tasks.move", { id: cc.id, status: "backlog", before: a.id, after: b.id });
  const order = c.snapshot().tasks.filter((x) => x.status === "backlog").sort((x, y) => x.sortKey - y.sortKey).map((x) => x.title);
  assert.deepEqual(order, ["A", "C", "B"]);
  await c.command("tasks.move", { id: b.id, status: "review" });
  assert.equal(task("B").status, "review");
  await c.command("tasks.update", {
    id: a.id,
    title: "A renamed",
    priority: "high",
    labels: ["web"],
    assignees: [names.Lead.id],
    checklist: [{ text: "Draft" }],
  });
  const updated = task("A renamed");
  assert.equal(updated.priority, "high");
  assert.deepEqual(updated.assignees, [names.Lead.id]);
  await assert.rejects(c.command("tasks.update", { id: a.id, assignees: ["outsider"] }), /employees in this project/);
  await assert.rejects(c.command("tasks.update", { id: a.id, revision: 1, title: "stale" }), /Task changed/);
  await c.command("tasks.comment", { id: a.id, body: "Looks good" });
  const detail = await c.command("tasks.get", { id: a.id });
  assert.ok(detail.activity.some((entry) => entry.kind === "comment" && entry.body === "Looks good"));
  await c.command("tasks.delete", { id: b.id });
  assert.equal(task("B"), undefined);
});

test("starting a task runs every assignee with lead and collaborator roles, then completes it", async (t) => {
  const { c, conversation, names, prompts, task } = await fixture(t);
  await c.command("tasks.create", {
    conversation: conversation.id,
    title: "Pricing page",
    description: "Build the Pro tier page",
    assignees: [names.Lead.id, names.Helper.id],
  });
  await assert.rejects(c.command("tasks.start", { id: "missing" }), /Task not found/);
  await c.command("tasks.start", { id: task("Pricing page").id });
  assert.equal(task("Pricing page").status, "in_progress");
  await assert.rejects(c.command("tasks.start", { id: task("Pricing page").id }), /already being worked on/);
  await settled(c);
  const runs = c.snapshot().runs.filter((r) => r.task === task("Pricing page").id);
  assert.equal(runs.length, 2);
  assert.match(prompts.find((p) => p.who === "Lead").prompt, /You lead this task/);
  assert.match(prompts.find((p) => p.who === "Helper").prompt, /You are collaborating; Lead leads/);
  assert.match(prompts[0].prompt, /Build the Pro tier page/);
  assert.match(prompts[0].prompt, /anybot-actions/);
  assert.equal(task("Pricing page").status, "done");
  const message = c.snapshot().messages.find((m) => m.kind === "task");
  assert.match(message.body, /Pricing page/);
});

test("a task with a reviewer stops at Review until the reviewer or owner approves", async (t) => {
  const { c, conversation, names, task } = await fixture(t, (options, who) =>
    who === "Lead"
      ? actions([{ type: "task.update", task: c.snapshot().tasks[0].id.slice(0, 8), status: "done" }])
      : "ok",
  );
  await c.command("tasks.create", {
    conversation: conversation.id,
    title: "Reviewed",
    assignees: [names.Lead.id],
    reviewer: names.Boss.id,
  });
  await c.command("tasks.start", { id: task("Reviewed").id });
  await settled(c);
  // The lead tried to jump to Done; the reviewer gate rejected it, and the
  // round settled into Review instead.
  assert.equal(task("Reviewed").status, "review");
  assert.ok(c.snapshot().messages.some((m) => m.kind === "notice" && /rejected task.update: You cannot move/.test(m.body)));
  await assert.rejects(c.command("tasks.review", { id: task("Reviewed").id, decision: "maybe" }), /approve or changes/);
  await c.command("tasks.review", { id: task("Reviewed").id, decision: "changes", comment: "Tighten copy" });
  assert.equal(task("Reviewed").status, "in_progress");
  await c.command("tasks.move", { id: task("Reviewed").id, status: "review" });
  await c.command("tasks.review", { id: task("Reviewed").id, decision: "approve" });
  assert.equal(task("Reviewed").status, "done");
});

test("agent actions update progress, checklists, and create backlog tasks within permissions", async (t) => {
  let taskRef = "";
  const { c, conversation, names, task } = await fixture(t, (options, who) =>
    who === "Lead"
      ? actions(
          [
            { type: "task.update", task: taskRef, comment: "Copy drafted", checklist: [{ item: "draft copy", done: true }], addChecklist: ["Proofread"] },
            { type: "task.create", title: "Follow-up FAQ", priority: "medium", assignees: [names.Helper.id] },
            { type: "task.create", title: "Sneaky", status: "done" },
            { type: "task.claim", task: taskRef },
          ],
          "Here is the draft.",
        )
      : "ok",
    { concurrency: 1 },
  );
  await c.command("tasks.create", {
    conversation: conversation.id,
    title: "Copy",
    assignees: [names.Lead.id],
    checklist: [{ text: "Draft copy" }],
  });
  taskRef = task("Copy").id.slice(0, 8);
  await c.command("tasks.start", { id: task("Copy").id });
  await settled(c);
  const copy = task("Copy");
  assert.deepEqual(copy.checklist, [{ text: "Draft copy", done: true }, { text: "Proofread", done: false }]);
  assert.equal(task("Follow-up FAQ").status, "backlog");
  assert.equal(task("Follow-up FAQ").createdBy, names.Lead.id);
  assert.equal(task("Sneaky"), undefined);
  const notice = c.snapshot().messages.find((m) => m.kind === "notice").body;
  assert.match(notice, /Lead updated the project/);
  assert.match(notice, /Agents can only add tasks to Backlog/);
  assert.match(notice, /Only unassigned Backlog tasks can be claimed/);
  const reply = c.snapshot().messages.find((m) => m.author === names.Lead.id);
  assert.equal(reply.body, "Here is the draft.");
  const detail = await c.command("tasks.get", { id: copy.id });
  assert.ok(detail.activity.some((entry) => entry.kind === "progress" && entry.author === names.Lead.id));
});

test("a lead finishing early waits for collaborators before the card moves", async (t) => {
  let release;
  const helperGate = new Promise((resolve) => (release = resolve));
  let ref = "";
  const { c, conversation, names, task } = await fixture(t, async (options, who) => {
    if (who === "Helper") {
      await helperGate;
      return "Helper done";
    }
    return actions([{ type: "task.update", task: ref, status: "done" }]);
  });
  await c.command("tasks.create", { conversation: conversation.id, title: "Pair", assignees: [names.Lead.id, names.Helper.id] });
  ref = task("Pair").id.slice(0, 8);
  await c.command("tasks.start", { id: task("Pair").id });
  const deadline = Date.now() + 3000;
  while (!c.snapshot().runs.some((r) => r.employee === names.Lead.id && r.status === "succeeded")) {
    if (Date.now() > deadline) throw new Error("lead did not finish");
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(task("Pair").status, "in_progress", "card waits for the collaborator");
  assert.ok(c.snapshot().messages.some((m) => /will move to done when the other assignees finish/.test(m.body)));
  release();
  await settled(c);
  assert.equal(task("Pair").status, "done");
});

test("non-assignees cannot move a task and failed work leaves the card in progress", async (t) => {
  let ref = "";
  const { c, conversation, names, task } = await fixture(t, (options, who) =>
    who === "Helper" ? actions([{ type: "task.update", task: ref, status: "review" }]) : new Error("harness crashed"),
    { concurrency: 1 },
  );
  await c.command("tasks.create", { conversation: conversation.id, title: "Other", assignees: [names.Lead.id] });
  await c.command("tasks.create", { conversation: conversation.id, title: "Mine", assignees: [names.Helper.id] });
  ref = task("Other").id.slice(0, 8);
  await c.command("tasks.start", { id: task("Mine").id });
  await settled(c);
  assert.equal(task("Other").status, "backlog");
  assert.ok(c.snapshot().messages.some((m) => /Only a task's assignees or reviewer/.test(m.body)));
  await c.command("tasks.start", { id: task("Other").id });
  await settled(c);
  assert.equal(task("Other").status, "in_progress");
  const detail = await c.command("tasks.get", { id: task("Other").id });
  assert.ok(detail.activity.some((entry) => /did not finish/.test(entry.body)));
});

test("autopilot starts an idle assignee's highest priority backlog task", async (t) => {
  const { c, conversation, names, task } = await fixture(t);
  await c.command("tasks.create", { conversation: conversation.id, title: "Low", priority: "low", assignees: [names.Lead.id] });
  await c.command("tasks.create", { conversation: conversation.id, title: "Urgent", priority: "urgent", assignees: [names.Lead.id] });
  c.autopilot();
  assert.equal(task("Urgent").status, "backlog", "autopilot is off by default");
  await c.command("conversations.setAutopilot", { conversation: conversation.id, enabled: true });
  c.lastAutopilot = 0;
  c.autopilot();
  assert.equal(task("Urgent").status, "in_progress");
  assert.equal(task("Low").status, "backlog");
  await settled(c);
  assert.equal(task("Urgent").status, "done");
});

test("tasks with active work cannot be deleted and delegation inherits the task", async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { c, conversation, names, task } = await fixture(t, async (options, who) => {
    if (who === "Lead") {
      await gate;
      return `Handing off.\n\`\`\`anybot\n${JSON.stringify({ type: "delegate", employeeId: names.Helper.id, objective: "Write tests" })}\n\`\`\``;
    }
    return "Tests written";
  });
  await c.command("tasks.create", { conversation: conversation.id, title: "Ship", assignees: [names.Lead.id] });
  await c.command("tasks.start", { id: task("Ship").id });
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(c.command("tasks.delete", { id: task("Ship").id }), /Stop this task's work/);
  release();
  await settled(c);
  const runs = c.snapshot().runs.filter((r) => r.task === task("Ship").id);
  assert.ok(runs.some((r) => r.employee === names.Helper.id), "delegated run is linked to the task");
  assert.equal(task("Ship").status, "done");
});
