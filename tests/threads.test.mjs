import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { mentionedIds, mentionMatches, mentionQuery } from "../runtime/mentions.mjs";

const bots = [
  { id: "a", name: "Alex" },
  { id: "m", name: "Morgan" },
  { id: "s2", name: "Sage Two" },
  { id: "s", name: "Sage" },
];

test("mentions are read the way people write them", () => {
  assert.deepEqual(mentionedIds("@Alex and @morgan, take a look", bots), ["a", "m"]);
  assert.deepEqual(mentionedIds("Ask @Sage Two, not @Sage", bots), ["s2", "s"], "the longest name wins");
  assert.deepEqual(mentionedIds("mail tony@alex.com or @Alexandra", bots), [], "emails and longer words don't count");
  assert.deepEqual(mentionedIds("(@Alex) @Alex again", bots), ["a"], "each bot once");
  assert.deepEqual(mentionQuery("Hey @Mo", 7), { start: 4, query: "Mo" });
  assert.deepEqual(mentionQuery("@", 1), { start: 0, query: "" });
  assert.equal(mentionQuery("tony@exa", 8), null);
  assert.deepEqual(mentionMatches("s", bots).map((b) => b.name), ["Sage Two", "Sage"]);
});

// A coordinator whose runner answers from a script: each bot replies with
// whatever the script says (or "Done by <name>").
async function project(t, { delegation = true, script = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-threads-"));
  const prompts = [];
  const c = new Coordinator({
    directory,
    probe: async () => [],
    concurrency: 3,
    runner: async ({ prompt, workspace }) => {
      const name = c.snapshot().employees.find((e) => e.workspace === workspace).name;
      prompts.push({ name, prompt });
      const next = script[name]?.shift();
      return next ?? `Done by ${name}`;
    },
  });
  t.after(async () => {
    await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  for (const name of ["Alex", "Morgan", "Sage"]) await c.command("employees.create", { name, role: `${name} role`, harness: "codex", trusted: true });
  const people = Object.fromEntries(c.snapshot().employees.map((e) => [e.name, e]));
  await c.command("conversations.create", { title: "Launch", members: Object.values(people).map((e) => e.id), delegation });
  const [room] = c.snapshot().conversations;
  const settled = async () => {
    const deadline = Date.now() + 30000;
    while (c.snapshot().runs.some((r) => ["queued", "running", "cancelling"].includes(r.status))) {
      if (Date.now() > deadline) throw new Error("Queue did not settle");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const say = async (body, extra = {}) => {
    await c.command("messages.send", { conversation: room.id, body, requestId: crypto.randomUUID(), ...extra });
    await settled();
    return c.snapshot().messages.filter((m) => m.conversation === room.id).at(-1);
  };
  const byId = (id) => Object.values(people).find((p) => p.id === id)?.name;
  return { c, people, room, say, settled, prompts, byId };
}

test("an @mention puts that bot to work in a thread under the message", async (t) => {
  const { c, say, byId } = await project(t);
  await say("@Morgan can you draft the pricing page?");
  const snap = c.snapshot();
  const root = snap.messages.find((m) => m.author === "human");
  assert.equal(root.thread, null, "the ask sits in the channel");
  assert.deepEqual(snap.runs.map((r) => [byId(r.employee), r.thread]), [["Morgan", root.id]]);
  const reply = snap.messages.find((m) => m.author !== "human");
  assert.equal(reply.thread, root.id, "the reply lands in the thread");
});

test("a project message that names no one is a note; a direct chat always answers", async (t) => {
  const { c, say, people } = await project(t);
  await say("Reminder: launch is Friday.");
  assert.equal(c.snapshot().runs.length, 0);
  await c.command("conversations.create", { title: "Alex", members: [people.Alex.id] });
  const dm = c.snapshot().conversations.find((x) => x.title === "Alex");
  await c.command("messages.send", { conversation: dm.id, body: "What's next?", requestId: crypto.randomUUID() });
  const deadline = Date.now() + 5000;
  while (!c.snapshot().messages.some((m) => m.conversation === dm.id && m.author === people.Alex.id)) {
    if (Date.now() > deadline) throw new Error("no reply");
    await new Promise((r) => setTimeout(r, 10));
  }
  const reply = c.snapshot().messages.find((m) => m.conversation === dm.id && m.author === people.Alex.id);
  assert.equal(reply.thread, null, "direct chats stay one conversation");
});

test("a thread follow-up goes to the bots already in it unless someone else is named", async (t) => {
  const { c, say, byId } = await project(t);
  const root = (await say("@Alex @Morgan kick this off")).thread;
  const before = c.snapshot().runs.length;
  await say("Looks good, keep going", { thread: root });
  assert.deepEqual(c.snapshot().runs.slice(before).map((r) => byId(r.employee)).sort(), ["Alex", "Morgan"]);
  const mid = c.snapshot().runs.length;
  await say("@Sage can you check the numbers?", { thread: root });
  assert.deepEqual(c.snapshot().runs.slice(mid).map((r) => byId(r.employee)), ["Sage"]);
  assert.ok(c.snapshot().messages.filter((m) => m.thread === root).length >= 6, "the whole exchange stays in the thread");
});

test("bots pull teammates into the thread by @mentioning them, and see the thread", async (t) => {
  const { c, say, prompts, byId } = await project(t, { script: { Alex: ["Plan is ready. @Morgan please build the page from it."] } });
  await say("@Alex plan the launch");
  const runs = c.snapshot().runs;
  assert.deepEqual(runs.map((r) => byId(r.employee)), ["Alex", "Morgan"]);
  assert.equal(runs[1].thread, runs[0].thread, "Morgan works in the same thread");
  const morgan = prompts.find((p) => p.name === "Morgan").prompt;
  assert.match(morgan, /Alex mentioned you: Plan is ready/);
  assert.match(morgan, /The thread you are replying in:\nHuman: @Alex plan the launch/);
  // Alex's message is the assignment: quoted once, in full, at the end.
  assert.equal(morgan.split("Plan is ready").length - 1, 1);
  assert.match(morgan, /Your current assignment:\nAlex mentioned you: Plan is ready\. @Morgan please build the page from it\./);
  assert.match(morgan, /To bring a teammate in, write @Name/);
});

test("bot-to-bot mentions work in every project, and can't loop forever", async (t) => {
  // The old per-project handoffs switch is gone: a project made with it off still hands off.
  const legacy = await project(t, { delegation: false, script: { Alex: ["@Morgan over to you"] } });
  await legacy.say("@Alex go");
  assert.deepEqual(legacy.c.snapshot().runs.map((r) => legacy.byId(r.employee)), ["Alex", "Morgan"]);

  const ping = Array.from({ length: 10 }, () => "@Morgan your turn");
  const pong = Array.from({ length: 10 }, () => "@Alex your turn");
  const loud = await project(t, { script: { Alex: ping, Morgan: pong } });
  await loud.say("@Alex start the relay");
  const snap = loud.c.snapshot();
  assert.equal(snap.runs.length, 1 + 6, "the owner's ask plus six bot handoffs");
  assert.ok(snap.messages.some((m) => /passed this thread around 6 times/.test(m.body)));
  // Replying resets the budget.
  const root = snap.runs[0].thread;
  const before = snap.runs.length;
  await loud.say("Keep going", { thread: root });
  assert.ok(loud.c.snapshot().runs.length > before + 1, "a new reply lets the bots continue");
});

test("explicit recipients still work and still thread; retries stay idempotent", async (t) => {
  const { c, people, room, settled } = await project(t);
  const request = { conversation: room.id, body: "Status please", recipients: [people.Sage.id], requestId: "same" };
  await c.command("messages.send", request);
  await c.command("messages.send", request);
  await settled();
  const runs = c.snapshot().runs;
  assert.equal(runs.length, 1);
  assert.ok(runs[0].thread);
  await assert.rejects(c.command("messages.send", { ...request, body: "Something else" }), /already used/);
});

test("bots asked together can confer: a mention to a teammate that's still working waits for it", async (t) => {
  // Alex answers at once and asks Morgan; Morgan is still on its own reply.
  const later = (text, ms) => new Promise((resolve) => setTimeout(() => resolve(text), ms));
  const { c, say, prompts, byId } = await project(t, {
    script: { Alex: ["My part is done. @Morgan what's your status?"], Morgan: [later("Still building the page.", 600), "@Alex the page is live."] },
  });
  await say("@Alex @Morgan status update, and confer with each other");
  const snap = c.snapshot();
  assert.deepEqual(
    snap.runs.map((r) => [byId(r.employee), r.status]),
    [["Alex", "succeeded"], ["Morgan", "succeeded"], ["Morgan", "succeeded"], ["Alex", "succeeded"]],
    "Morgan answers Alex after its own reply, then Alex hears back",
  );
  assert.equal(new Set(snap.runs.map((r) => r.thread)).size, 1, "all in one thread");
  const second = prompts.filter((p) => p.name === "Morgan")[1].prompt;
  assert.match(second, /Alex mentioned you: My part is done\. @Morgan what's your status\?/);
  assert.match(second, /Morgan: Still building the page\./, "it sees its own first reply in the thread");
});
