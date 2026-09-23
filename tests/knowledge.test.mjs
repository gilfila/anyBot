import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { words } from "../runtime/knowledge.mjs";

const actions = (list, prose = "Done.") => `${prose}\n\n\`\`\`anybot-actions\n${JSON.stringify(list)}\n\`\`\``;

// Chief manages Lead; Lead and Junior share the "Checkout" project, which
// has one task led by Lead. `reply(who, prompt)` scripts each employee.
async function fixture(t, reply = () => "ok") {
  const directory = await mkdtemp(join(tmpdir(), "anybot-kg-"));
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
  for (const name of ["Chief", "Lead", "Junior"])
    await c.command("employees.create", { name, role: `${name} role`, harness: "codex", trusted: true });
  const e = Object.fromEntries(c.snapshot().employees.map((x) => [x.name, x]));
  byWorkspace = Object.fromEntries(Object.values(e).map((x) => [x.workspace, x.name]));
  await c.command("employees.setManager", { id: e.Lead.id, manager: e.Chief.id });
  await c.command("conversations.create", { title: "Checkout", members: [e.Lead.id, e.Junior.id] });
  const project = c.snapshot().conversations.at(-1);
  await c.command("tasks.create", { conversation: project.id, title: "Payment form", assignees: [e.Lead.id] });
  const task = c.snapshot().tasks.at(-1);
  const settled = async () => {
    const deadline = Date.now() + 30000;
    while (c.snapshot().runs.some((r) => ["running", "queued", "cancelling"].includes(r.status))) {
      if (Date.now() > deadline) throw new Error("Queue did not settle");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const chat = async (employee, body, conversation = project) => {
    await c.command("messages.send", { conversation: conversation.id, body, recipients: [employee.id], requestId: crypto.randomUUID() });
    await settled();
  };
  return { c, e, project, task, prompts, settled, chat };
}

test("the workspace graph is derived from the org, projects, and board", async (t) => {
  const { c, e, project, task } = await fixture(t);
  const graph = await c.command("graph.get", {});
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const nodeId of [`agent:${e.Chief.id}`, `agent:${e.Lead.id}`, `project:${project.id}`, `task:${task.id}`])
    assert.ok(ids.has(nodeId), nodeId);
  const has = (src, relation, dst) =>
    graph.edges.some((edge) => edge.src === src && edge.relation === relation && edge.dst === dst);
  assert.ok(has(`agent:${e.Lead.id}`, "reports_to", `agent:${e.Chief.id}`));
  assert.ok(has(`agent:${e.Junior.id}`, "member_of", `project:${project.id}`));
  assert.ok(has(`task:${task.id}`, "in", `project:${project.id}`));
  assert.ok(has(`agent:${e.Lead.id}`, "assigned_to", `task:${task.id}`));
  // Direct chats are not projects.
  assert.equal(graph.nodes.filter((n) => n.type === "project").length, 1);
  await c.command("tasks.move", { id: task.id, status: "done" });
  const after = await c.command("graph.get", {});
  assert.ok(after.edges.some((edge) => edge.src === `agent:${e.Lead.id}` && edge.relation === "completed"));
  // Archived bots drop out, along with their edges.
  const junior = c.snapshot().employees.find((x) => x.id === e.Junior.id);
  await c.command("employees.setArchived", { id: junior.id, revision: junior.revision, archived: true });
  const archived = await c.command("graph.get", {});
  assert.ok(!archived.nodes.some((n) => n.id === `agent:${e.Junior.id}`));
  assert.ok(!archived.edges.some((edge) => edge.src === `agent:${e.Junior.id}`));
});

test("bots add facts that link workspace nodes, dedupe, and carry provenance", async (t) => {
  let script = {};
  const { c, e, task, prompts, chat } = await fixture(t, (who) => script[who]?.() ?? "ok");
  script = {
    Lead: () =>
      actions([
        { type: "kg.fact", subject: "Payment form", relation: "depends on", object: "Stripe API v3", note: "needs webhooks" },
        { type: "kg.fact", subject: { type: "decision", label: "Use hosted checkout" }, relation: "decided_by", object: "Chief" },
        { type: "kg.fact", subject: "Payment form", relation: "Depends on!", object: "stripe api v3", note: "webhooks + SCA" },
        { type: "kg.fact", subject: "Lead", relation: "owns", object: "" },
      ]),
  };
  await chat(e.Lead, "Plan the payment form");
  const notices = c.snapshot().messages.map((m) => m.body).join("\n");
  assert.match(notices, /recorded "Payment form depends on Stripe API v3"/);
  assert.match(notices, /Name is required/);
  const graph = await c.command("graph.get", {});
  const written = graph.edges.filter((edge) => edge.source !== "auto");
  assert.equal(written.length, 2, "the repeated fact updates the first one");
  const depends = written.find((edge) => edge.relation === "depends_on");
  assert.equal(depends.src, `task:${task.id}`, "task titles resolve to the task node");
  assert.equal(depends.note, "webhooks + SCA");
  assert.equal(depends.source, "agent");
  assert.equal(depends.createdBy, e.Lead.id);
  assert.ok(depends.run);
  const stripe = graph.nodes.find((n) => n.id === depends.dst);
  assert.deepEqual([stripe.type, stripe.label, stripe.source], ["concept", "Stripe API v3", "agent"]);
  const decided = written.find((edge) => edge.relation === "decided_by");
  assert.equal(decided.dst, `agent:${e.Chief.id}`);
  assert.equal(graph.nodes.find((n) => n.id === decided.src).type, "decision");

  // Recall: a later prompt that mentions Stripe gets the fact, marked as bot-written.
  script = {};
  await chat(e.Junior, "Which Stripe API does checkout use?");
  assert.match(prompts.at(-1).prompt, /Knowledge graph \(workspace data[\s\S]*Payment form —depends_on→ Stripe API v3 \(webhooks \+ SCA\) \[bot-written\]/);
  // Unrelated prompts don't carry unrelated facts.
  await chat(e.Junior, "Write a haiku about autumn");
  assert.doesNotMatch(prompts.at(-1).prompt, /Knowledge graph \(workspace data/);
  // Pinning a bot's fact vouches for it: always recalled, no bot-written marker.
  await c.command("graph.edgeUpdate", { id: depends.id, pinned: true });
  await chat(e.Junior, "Write another haiku");
  assert.match(prompts.at(-1).prompt, /Payment form —depends_on→ Stripe API v3 \(webhooks \+ SCA\)$/m);
  // Pinning an entity puts every fact about it in every prompt, still marked if unvouched.
  await c.command("graph.edgeUpdate", { id: depends.id, pinned: false });
  await c.command("graph.entityUpdate", { id: decided.src, pinned: true });
  await chat(e.Junior, "One more haiku");
  assert.match(prompts.at(-1).prompt, /Use hosted checkout —decided_by→ Chief \[bot-written\]/);
  assert.doesNotMatch(prompts.at(-1).prompt, /Stripe API v3 \(webhooks/);
});

test("graph queries seed from search or a focus node and expand by depth", async (t) => {
  const { c, e, task } = await fixture(t);
  await c.command("graph.fact", { subject: "Payment form", relation: "depends on", object: "Stripe API v3" });
  await c.command("graph.fact", { subject: "Stripe API v3", relation: "documented in", object: "Stripe docs" });
  const search = await c.command("graph.get", { q: "stripe" });
  const labels = (result) => result.nodes.map((n) => n.label).sort();
  assert.ok(labels(search).includes("Stripe API v3"));
  assert.ok(labels(search).includes("Payment form"), "one hop out from the match");
  assert.ok(search.seeds.length >= 1);
  const docs = (await c.command("graph.get", { q: "Stripe docs" })).nodes.find((n) => n.label === "Stripe docs");
  const focused = await c.command("graph.get", { focus: docs.id, depth: 1 });
  assert.deepEqual(labels(focused), ["Stripe API v3", "Stripe docs"]);
  const twoHops = await c.command("graph.get", { focus: docs.id, depth: 2 });
  assert.ok(labels(twoHops).includes("Payment form"));
  const tasksOnly = await c.command("graph.get", { types: ["task"] });
  assert.deepEqual(tasksOnly.nodes.map((n) => n.id), [`task:${task.id}`]);
  const none = await c.command("graph.get", { q: "zzzz nothing" });
  assert.equal(none.nodes.length, 0);
  assert.ok(words("The Stripe API for the task").includes("stripe"));
  assert.ok(!words("The Stripe API for the task").includes("the"));
  void e;
});

test("the owner curates written facts but cannot edit workspace nodes", async (t) => {
  const { c, e } = await fixture(t);
  await c.command("graph.fact", { subject: "Launch", relation: "blocked by", object: { type: "risk", label: "Legal review" }, note: "EU only" });
  let graph = await c.command("graph.get", {});
  const fact = graph.edges.find((edge) => edge.relation === "blocked_by");
  assert.equal(fact.source, "owner");
  const legal = graph.nodes.find((n) => n.label === "Legal review");
  assert.equal(legal.type, "risk");
  await c.command("graph.entityUpdate", { id: legal.id, label: "Legal sign-off", pinned: true });
  await c.command("graph.edgeUpdate", { id: fact.id, relation: "waits on", note: "", pinned: true });
  graph = await c.command("graph.get", { q: "sign-off" });
  const renamed = graph.nodes.find((n) => n.id === legal.id);
  assert.equal(renamed.label, "Legal sign-off");
  assert.equal(renamed.pinned, true);
  const edited = graph.edges.find((edge) => edge.id === fact.id);
  assert.deepEqual([edited.relation, edited.note, edited.pinned], ["waits_on", "", true]);
  await assert.rejects(c.command("graph.entityUpdate", { id: `agent:${e.Lead.id}`, label: "x" }), /Only written entities/);
  await assert.rejects(c.command("graph.entityUpdate", { id: legal.id, type: "agent" }), /custom type/);
  await assert.rejects(c.command("graph.edgeUpdate", { id: "auto:rep:x", note: "x" }), /Only written facts/);
  await assert.rejects(c.command("graph.fact", { subject: "A", relation: "is", object: "A" }), /two different things/);
  // Pinned facts are recalled even when the prompt doesn't mention them.
  assert.match(c.knowledge.recall("something unrelated").join("\n"), /Launch —waits_on→ Legal sign-off/);
  // Deleting an entity removes its facts.
  await c.command("graph.entityDelete", { id: legal.id });
  graph = await c.command("graph.get", {});
  assert.ok(!graph.edges.some((edge) => edge.id === fact.id));
  assert.ok(!graph.nodes.some((n) => n.id === legal.id));
  const launch = graph.nodes.find((n) => n.label === "Launch");
  await c.command("graph.fact", { subject: { id: launch.id }, relation: "owned by", object: { id: `agent:${e.Chief.id}` } });
  const owned = (await c.command("graph.get", {})).edges.find((edge) => edge.relation === "owned_by");
  await c.command("graph.edgeDelete", { id: owned.id });
  assert.ok(!(await c.command("graph.get", {})).edges.some((edge) => edge.id === owned.id));
  await assert.rejects(c.command("graph.fact", { subject: { id: "task:nope" }, relation: "x", object: "y" }), /Unknown node/);
});

test("asking the graph sends the question and matching facts as a direct chat", async (t) => {
  const { c, e, prompts, settled } = await fixture(t);
  await c.command("graph.fact", { subject: "Payment form", relation: "depends on", object: "Stripe API v3" });
  const before = c.snapshot().conversations.length;
  const snapshot = await c.command("graph.ask", { employee: e.Junior.id, question: "What does the payment form depend on?" });
  const conversation = snapshot.conversations.at(-1).id;
  await settled();
  const chats = c.snapshot().conversations;
  assert.equal(chats.length, before + 1);
  assert.deepEqual(chats.find((x) => x.id === conversation).members, [e.Junior.id]);
  assert.match(prompts.at(-1).prompt, /Question about the knowledge graph: What does the payment form depend on\?[\s\S]*Payment form —depends_on→ Stripe API v3/);
  // A second question reuses the same direct chat.
  const again = await c.command("graph.ask", { employee: e.Junior.id, question: "Anything else?" });
  assert.equal(again.conversations.length, before + 1);
  assert.equal(again.messages.filter((m) => m.conversation === conversation && m.author === "human").length, 2);
  await settled();
  await assert.rejects(c.command("graph.ask", { employee: e.Junior.id, question: "" }), /Question/);
});
