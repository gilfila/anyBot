import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";

const actions = (list, prose = "Done.") => `${prose}\n\n\`\`\`anybot-actions\n${JSON.stringify(list)}\n\`\`\``;
const delegate = (employeeId, objective) =>
  `Handing off.\n\`\`\`anybot\n${JSON.stringify({ type: "delegate", employeeId, objective })}\n\`\`\``;

// Org: Chief (reports to owner) manages Lead; Lead manages Junior. Peer is
// unrelated. `reply(who, prompt)` scripts each employee.
async function fixture(t, reply = () => "ok") {
  const directory = await mkdtemp(join(tmpdir(), "anybot-org-"));
  const prompts = [];
  let byWorkspace = {};
  const c = new Coordinator({
    directory,
    concurrency: 1,
    probe: async () => [],
    runner: async (options) => {
      const who = byWorkspace[options.workspace];
      prompts.push({ who, prompt: options.prompt });
      return reply(who, options.prompt);
    },
  });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  for (const name of ["Chief", "Lead", "Junior", "Peer"])
    await c.command("employees.create", { name, role: name, harness: "codex", trusted: true });
  const e = Object.fromEntries(c.snapshot().employees.map((x) => [x.name, x]));
  byWorkspace = Object.fromEntries(Object.values(e).map((x) => [x.workspace, x.name]));
  await c.command("employees.setManager", { id: e.Lead.id, manager: e.Chief.id });
  await c.command("employees.setManager", { id: e.Junior.id, manager: e.Lead.id });
  const settled = async () => {
    const deadline = Date.now() + 30000;
    while (c.snapshot().runs.some((r) => ["running", "queued", "cancelling"].includes(r.status))) {
      if (Date.now() > deadline) throw new Error("Queue did not settle");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const chat = async (employee, body, conversation) => {
    await c.command("messages.send", { conversation: conversation.id, body, recipients: [employee.id], requestId: crypto.randomUUID() });
    await settled();
  };
  const direct = async (employee) => {
    await c.command("conversations.create", { title: employee.name, members: [employee.id] });
    return c.snapshot().conversations.at(-1);
  };
  return { c, e, prompts, settled, chat, direct };
}

test("reporting lines reject loops, self-management, and archived managers", async (t) => {
  const { c, e } = await fixture(t);
  await assert.rejects(c.command("employees.setManager", { id: e.Chief.id, manager: e.Junior.id }), /reporting loop/);
  await assert.rejects(c.command("employees.setManager", { id: e.Lead.id, manager: e.Lead.id }), /themselves/);
  await c.command("employees.setArchived", { id: e.Peer.id, revision: c.snapshot().employees.find((x) => x.id === e.Peer.id).revision, archived: true });
  await assert.rejects(c.command("employees.setManager", { id: e.Junior.id, manager: e.Peer.id }), /Restore that manager/);
  assert.deepEqual(c.org.chain(e.Junior.id), [e.Lead.id, e.Chief.id]);
  assert.equal(c.snapshot().employees.find((x) => x.id === e.Junior.id).manager, e.Lead.id);
  // "" returns an employee to reporting to the owner.
  await c.command("employees.setManager", { id: e.Junior.id, manager: "" });
  assert.deepEqual(c.org.chain(e.Junior.id), []);
});

test("managers delegate down the chain from any conversation; sideways and upward are refused", async (t) => {
  let script = {};
  const { c, e, prompts, chat, direct } = await fixture(t, (who) => script[who]?.() ?? "ok");
  const chiefChat = await direct(e.Chief);
  // Chief delegates to Junior (two levels down) from a direct chat with delegation off.
  script = { Chief: () => delegate(e.Junior.id, "Draft the launch email") };
  await chat(e.Chief, "Get the email drafted", chiefChat);
  const juniorRun = c.snapshot().runs.find((r) => r.employee === e.Junior.id);
  assert.ok(juniorRun, "report received the delegation");
  assert.equal(juniorRun.conversation, chiefChat.id, "runs as a guest in the manager's conversation");
  assert.match(prompts.find((p) => p.who === "Chief").prompt, /as a manager you may delegate/);
  // Junior cannot delegate upward or sideways outside a shared project.
  const juniorChat = await direct(e.Junior);
  script = { Junior: () => delegate(e.Lead.id, "Do my work") };
  await chat(e.Junior, "try upward", juniorChat);
  script = { Junior: () => delegate(e.Peer.id, "Do my work") };
  await chat(e.Junior, "try sideways", juniorChat);
  const notices = c.snapshot().messages.filter((m) => m.conversation === juniorChat.id && m.kind === "notice").map((m) => m.body);
  assert.equal(notices.length, 2);
  assert.ok(notices.every((body) => /Delegation was not scheduled/.test(body)));
});

test("the lead's agent manager reviews by default and can send work back", async (t) => {
  let verdicts = ["changes", "approve"];
  let taskRef = "";
  const { c, e, prompts, settled } = await fixture(t, (who) => {
    if (who === "Chief") {
      const decision = verdicts.shift();
      return actions([{ type: "review", task: taskRef, decision, comment: decision === "changes" ? "Add pricing FAQ" : "Looks good" }]);
    }
    return "Built it";
  });
  // Chief is not a member of this project, but manages the lead.
  await c.command("conversations.create", { title: "Site", members: [e.Lead.id, e.Junior.id], delegation: true });
  const site = c.snapshot().conversations.at(-1);
  await c.command("tasks.create", { conversation: site.id, title: "Landing page", assignees: [e.Lead.id] });
  const task = () => c.snapshot().tasks.find((x) => x.title === "Landing page");
  assert.equal(task().reviewer, e.Chief.id, "defaults to the lead's manager");
  taskRef = task().id.slice(0, 8);
  await c.command("tasks.start", { id: task().id });
  await settled();
  assert.equal(task().status, "done");
  const chiefPrompts = prompts.filter((p) => p.who === "Chief");
  assert.equal(chiefPrompts.length, 2, "two review rounds");
  assert.match(chiefPrompts[0].prompt, /You are this task's reviewer/);
  const leadPrompts = prompts.filter((p) => p.who === "Lead");
  assert.equal(leadPrompts.length, 2, "lead re-ran after changes were requested");
  const detail = await c.command("tasks.get", { id: task().id });
  assert.ok(detail.activity.some((a) => a.kind === "comment" && a.body === "Add pricing FAQ"));
  // The default follows whoever the lead reports to (Junior reports to Lead).
  await c.command("tasks.create", { conversation: site.id, title: "Owner-level", assignees: [e.Junior.id] });
  assert.equal(c.snapshot().tasks.find((x) => x.title === "Owner-level").reviewer, e.Lead.id);
  await assert.rejects(
    c.command("tasks.update", { id: task().id, reviewer: e.Peer.id }),
    /Reviewer must be in this project or manage the lead/,
  );
});

test("finished task work rolls up to the manager's next prompt, then the owner's feed", async (t) => {
  let script = {};
  const { c, e, prompts, chat, direct, settled } = await fixture(t, (who) => script[who]?.() ?? "ok");
  await c.command("conversations.create", { title: "Ops", members: [e.Junior.id, e.Chief.id] });
  const ops = c.snapshot().conversations.at(-1);
  await c.command("tasks.create", { conversation: ops.id, title: "Rotate keys", assignees: [e.Junior.id], reviewer: "" });
  script = { Junior: () => "Rotated all API keys and updated the vault." };
  await c.command("tasks.start", { id: c.snapshot().tasks[0].id });
  await settled();
  const [report] = c.org.reports({ to: e.Lead.id });
  assert.match(report.summary, /Rotated all API keys/);
  assert.equal(report.read, false);
  const leadChat = await direct(e.Lead);
  await chat(e.Lead, "Anything new?", leadChat);
  assert.match(prompts.at(-1).prompt, /Reports from your team[\s\S]*Junior on "Rotate keys": Rotated all API keys/);
  assert.equal(c.org.reports({ to: e.Lead.id })[0].read, true, "delivered reports are marked read");
  // An explicit report action replaces the automatic summary; Chief reports to the owner.
  await c.command("tasks.create", { conversation: ops.id, title: "Quarterly review", assignees: [e.Chief.id] });
  script = { Chief: () => actions([{ type: "report", summary: "Q3 closed: 12 tasks shipped" }], "Long narrative...") };
  await c.command("tasks.start", { id: c.snapshot().tasks.find((x) => x.title === "Quarterly review").id });
  await settled();
  const ownerFeed = c.org.reports({ to: "" });
  assert.deepEqual(ownerFeed.map((r) => r.summary), ["Q3 closed: 12 tasks shipped"]);
  assert.equal(c.snapshot().reportsUnread, 1);
  await c.command("reports.markRead", { ids: ownerFeed.map((r) => r.id) });
  assert.equal(c.snapshot().reportsUnread, 0);
});

test("memories are scoped, recalled by relevance, and only forgettable by their owner", async (t) => {
  let script = {};
  const { c, e, prompts, chat, direct } = await fixture(t, (who) => script[who]?.() ?? "ok");
  const juniorChat = await direct(e.Junior);
  script = {
    Junior: () =>
      actions([
        { type: "memory.save", body: "The staging database password rotates every Monday", tags: ["staging"] },
        { type: "memory.save", body: "Brand colour is vermilion, never blue", scope: "team" },
        { type: "memory.save", body: "Only for this chat", scope: "project" },
      ]),
  };
  await chat(e.Junior, "Remember things", juniorChat);
  const memories = (await c.command("memory.list", { employee: e.Junior.id })).memories;
  assert.equal(memories.length, 3);
  script = {};
  await chat(e.Junior, "When does the staging database rotate?", juniorChat);
  const recall = prompts.at(-1).prompt;
  assert.match(recall, /Memory you can use[\s\S]*staging database password rotates/);
  // Peer sees team memories, not Junior's private ones; Lead (manager) sees private.
  const peerChat = await direct(e.Peer);
  await chat(e.Peer, "What is our brand colour and the staging database schedule?", peerChat);
  assert.match(prompts.at(-1).prompt, /Brand colour is vermilion/);
  assert.doesNotMatch(prompts.at(-1).prompt, /staging database password/);
  assert.doesNotMatch(prompts.at(-1).prompt, /Only for this chat/);
  const leadChat = await direct(e.Lead);
  await chat(e.Lead, "Staging database schedule?", leadChat);
  assert.match(prompts.at(-1).prompt, /staging database password rotates[\s\S]*from Junior|from Junior[\s\S]*staging database/);
  // Peer cannot forget Junior's memory; Junior can.
  const target = memories.find((m) => /staging/.test(m.body)).id.slice(0, 8);
  script = { Peer: () => actions([{ type: "memory.forget", id: target }]) };
  await chat(e.Peer, "forget", peerChat);
  assert.ok(c.snapshot().messages.some((m) => /You can only forget your own memories/.test(m.body)));
  script = { Junior: () => actions([{ type: "memory.forget", id: target }]) };
  await chat(e.Junior, "forget", juniorChat);
  assert.equal((await c.command("memory.list", { employee: e.Junior.id })).memories.length, 2);
  // Owner edits: pin and delete.
  const team = (await c.command("memory.list", { employee: e.Junior.id })).memories.find((m) => m.scope === "team");
  await c.command("memory.update", { id: team.id, pinned: true, employee: e.Junior.id });
  assert.equal((await c.command("memory.list", { employee: e.Junior.id })).memories[0].pinned, true);
  await c.command("memory.create", { employee: e.Peer.id, body: "Owner note", scope: "private" });
  await assert.rejects(c.command("memory.create", { employee: e.Peer.id, body: "", scope: "private" }), /needs text/);
  await assert.rejects(c.command("memory.create", { employee: e.Peer.id, body: "x", scope: "galaxy" }), /Scope must be/);
  const { memories: peerMemories } = await c.command("memory.delete", { id: (await c.command("memory.list", { employee: e.Peer.id })).memories[0].id, employee: e.Peer.id });
  assert.equal(peerMemories.length, 0);
});
