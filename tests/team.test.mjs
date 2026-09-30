// The always-on team's brakes in the coordinator (0.3.38): the Team switch
// and kill switch, daily budgets, the owner's reserved slots, the provider
// circuit breaker, dontAsk and Codex refusals, and getting through to a
// busy bot. Everything is off until the owner turns Team on, except the
// breaker (autonomous runs only) and the kill switch itself.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { describeIssue } from "../src/lib/diagnostics.js";

const pause = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, what = "the condition", turns = 1000) {
  for (let turn = 0; !(await check()); turn++) {
    if (turn > turns) throw new Error(`Timed out waiting for ${what}`);
    await pause();
  }
}
const settled = (c) =>
  until(() => !c.snapshot().runs.some((r) => ["queued", "running", "cancelling"].includes(r.status)), "the queue to settle");
const delegate = (employeeId, objective) =>
  `Handing off.\n\`\`\`anybot\n${JSON.stringify({ type: "delegate", employeeId, objective })}\n\`\`\``;
const limitError = (message = "API Error: 429 You've hit your limit") =>
  Object.assign(new Error(message), { failure: { code: "usage_limit" } });
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}
const aborted = (signal) =>
  new Promise((_, reject) => {
    if (signal.aborted) reject(new Error("Run cancelled"));
    signal.addEventListener("abort", () => reject(new Error("Run cancelled")), { once: true });
  });

// Bots are [name, harness, permissionMode]; each has its own workspace.
// `reply(name, run)` answers a turn (a promise holds it; an Error fails it).
async function office(t, bots, { reply = () => "ok", ...options } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-team-"));
  const calls = [];
  const diagnostics = [];
  const attention = [];
  let byWorkspace = {};
  const c = new Coordinator({
    directory,
    concurrency: 8,
    probe: async () => [],
    runner: async (run) => {
      const name = byWorkspace[run.workspace];
      calls.push({ name, prompt: run.prompt, harness: run.harness, unattended: run.unattended, disallowedTools: run.disallowedTools, codexMcpOff: run.codexMcpOff });
      const value = await Promise.race([reply(name, run), aborted(run.signal)]);
      if (value instanceof Error) throw value;
      return value;
    },
    ...options,
  });
  c.on("diagnostic", (entry) => diagnostics.push(entry));
  c.on("attention", (entry) => attention.push(entry));
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  for (const [name, harness = "claude", permissionMode = "auto"] of bots)
    await c.command("employees.create", { name, role: name, harness, permissionMode, trusted: true });
  const e = Object.fromEntries(c.snapshot().employees.map((x) => [x.name, x]));
  byWorkspace = Object.fromEntries(Object.values(e).map((x) => [x.workspace, x.name]));
  const room = async (title, members) => {
    await c.command("conversations.create", { title, members: members.map((m) => m.id) });
    return c.snapshot().conversations.at(-1);
  };
  const run = (id) => c.snapshot().runs.find((r) => r.id === id);
  const runsOf = (bot) => c.snapshot().runs.filter((r) => r.employee === bot.id);
  // Autonomous work, as a routine queues it (thread: its own message, as in a project).
  const routine = (conversation, bot, text = "Routine: check in") => {
    const message = c.addMessage(conversation.id, "system", "routine", text);
    return c.addRun(conversation.id, bot.id, message, null, null, 0, null, conversation.members.length > 1 ? message : null);
  };
  const say = async (conversation, body, recipients) => {
    const requestId = `desk-${Math.random()}`;
    await c.command("messages.send", { conversation: conversation.id, body, requestId, recipients });
    return c.store.one("SELECT r.* FROM runs r JOIN requests q ON q.result=r.message WHERE q.key=? ORDER BY r.rowid DESC", requestId);
  };
  const notices = (pattern) => c.snapshot().messages.filter((m) => m.kind === "notice" && pattern.test(m.body));
  return { c, e, calls, diagnostics, attention, directory, room, run, runsOf, routine, say, notices };
}

// Budgets and lanes ------------------------------------------------------------

test("1. a bot at its daily cap: its Autopilot run stays queued, while your message to the same bot runs", async (t) => {
  const { c, e, room, say, notices, diagnostics, runsOf } = await office(t, [["Nova"], ["Reel"]]);
  clearInterval(c.timer);
  await c.command("team.set", { enabled: true, levelRuns: { unleveled: 1 } });
  const studio = await room("Studio", [e.Nova, e.Reel]);
  for (const title of ["First", "Second"]) await c.command("tasks.create", { conversation: studio.id, title, assignees: [e.Nova.id] });
  await c.command("conversations.setAutopilot", { conversation: studio.id, enabled: true });
  const autopilot = () => {
    c.lastAutopilot = 0;
    c.autopilot();
  };
  autopilot();
  await settled(c);
  autopilot();
  const second = runsOf(e.Nova).find((r) => r.status === "queued");
  assert.ok(second, "Autopilot queued the second task");
  for (let i = 0; i < 5; i++) c.dispatch();
  assert.equal(c.snapshot().runs.find((r) => r.id === second.id).status, "queued");
  assert.deepEqual(c.snapshot().team.waits[second.id], { reason: "budget", scope: "bot", cap: 1, used: 1 });
  const dm = await room("Nova", [e.Nova]);
  const mine = await say(dm, "Quick question");
  await until(() => c.snapshot().runs.find((r) => r.id === mine.id).status === "succeeded", "your message");
  assert.equal(c.snapshot().runs.find((r) => r.id === second.id).status, "queued", "still waiting for tomorrow");
  assert.equal(notices(/today's limit of 1 run/).length, 1, "one notice");
  assert.equal(diagnostics.filter((d) => d.code === "budget.cap_reached").length, 1, "one diagnostic");
  assert.deepEqual(diagnostics.find((d) => d.code === "budget.cap_reached").context.scope, "bot");
  assert.equal(c.snapshot().team.today.bots[e.Nova.id], 1);
  assert.equal(c.snapshot().team.today.owner, 1, "your run is counted, not capped");
});

test("2. with 8 slots and 2 kept for you, 8 queued autonomous runs use at most 6, and your message starts right away", async (t) => {
  const names = ["A", "B", "C", "D", "E", "F", "G", "H", "Owner"].map((name) => [name]);
  const gates = [];
  const { c, e, room, routine, say } = await office(t, names, {
    reply: () => {
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    },
  });
  clearInterval(c.timer);
  await c.command("team.set", { enabled: true });
  const hall = await room("Hall", Object.values(e));
  const queued = ["A", "B", "C", "D", "E", "F", "G", "H"].map((name) => routine(hall, e[name]));
  c.dispatch();
  const status = () => c.snapshot().runs.filter((r) => r.status === "running").length;
  await until(() => gates.length === 6, "six runs");
  assert.equal(status(), 6);
  const waiting = queued.filter((id) => c.snapshot().runs.find((r) => r.id === id).status === "queued");
  assert.equal(waiting.length, 2);
  for (const id of waiting) assert.equal(c.snapshot().team.waits[id].reason, "reserve");
  const dm = await room("Owner", [e.Owner]);
  const mine = await say(dm, "Now, please");
  assert.equal(c.snapshot().runs.find((r) => r.id === mine.id).status, "running");
  assert.equal(status(), 7);
  // Everything finishes once the gates open.
  for (;;) {
    gates.splice(0).forEach((gate) => gate.resolve("done"));
    if (!c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status))) break;
    await pause();
  }
});

test("7. a Buzz ask counts against the budget and runs unattended; your messages and your Run again are the owner lane", async (t) => {
  let failNext = true;
  const { c, e, room, routine, say, calls } = await office(t, [["Atlas"]], {
    reply: () => {
      if (failNext) {
        failNext = false;
        return new Error("Something broke");
      }
      return "ok";
    },
  });
  clearInterval(c.timer);
  await c.command("team.set", { enabled: true, levelRuns: { unleveled: 2 } });
  const dm = await room("Atlas", [e.Atlas]);
  // A routine run fails; you press Run again.
  const failed = routine(dm, e.Atlas);
  c.dispatch();
  await settled(c);
  assert.equal(c.snapshot().runs.find((r) => r.id === failed).status, "failed");
  await c.command("runs.retry", { id: failed });
  const retry = c.snapshot().runs.at(-1);
  assert.equal(c.runInfo(retry).lane, "owner");
  assert.equal(c.runPriority(retry), 30);
  await settled(c);
  assert.equal(calls.at(-1).unattended, false);
  const ask = async (n) =>
    c.command("bridge.send", {
      employee: e.Atlas.id,
      body: `[Buzz #general] ask ${n}`,
      requestId: `buzz:${n}`,
      origin: { via: "buzz", channel: "general" },
    });
  const first = await ask(1);
  await settled(c);
  assert.equal(calls.at(-1).unattended, true, "a guest's run is unattended");
  const guestRun = c.snapshot().runs.find((r) => r.message === first.message);
  assert.equal(c.runInfo(guestRun).lane, "guest");
  assert.equal(c.runPriority(guestRun), 20);
  await say(dm, "From me");
  await settled(c);
  assert.equal(calls.at(-1).unattended, false);
  const today = c.snapshot().team.today;
  assert.equal(today.bots[e.Atlas.id], 2, "the failed routine run and the Buzz ask");
  assert.equal(today.org, 2);
  assert.equal(today.owner, 2, "your Run again and your message");
  const second = await ask(2);
  for (let i = 0; i < 3; i++) c.dispatch();
  const held = c.snapshot().runs.find((r) => r.message === second.message);
  assert.equal(held.status, "queued");
  assert.equal(c.snapshot().team.waits[held.id].reason, "budget");
});

test("11. the org's daily budget warns at 80% and 100%, then holds autonomous work until midnight", async (t) => {
  let time = Date.now();
  const bots = ["A", "B", "C", "D", "E", "F"].map((name) => [name]);
  const { c, e, room, routine, attention, diagnostics } = await office(t, bots, { clock: () => time });
  clearInterval(c.timer);
  await c.command("team.set", { enabled: true, orgRunsPerDay: 5 });
  const hall = await room("Hall", Object.values(e));
  for (const name of ["A", "B", "C", "D"]) routine(hall, e[name]);
  c.dispatch();
  await settled(c);
  const budgetAlerts = () => attention.filter((a) => /budget|runs today/i.test(`${a.title} ${a.body}`));
  assert.equal(budgetAlerts().length, 1, "80% of the org's runs");
  routine(hall, e.E);
  c.dispatch();
  await settled(c);
  assert.equal(budgetAlerts().length, 2, "100%");
  const sixth = routine(hall, e.F);
  for (let i = 0; i < 3; i++) c.dispatch();
  assert.equal(c.snapshot().runs.find((r) => r.id === sixth).status, "queued");
  assert.deepEqual(c.snapshot().team.waits[sixth], { reason: "budget", scope: "org", cap: 5, used: 5 });
  assert.equal(diagnostics.filter((d) => d.code === "budget.cap_reached").length, 1);
  assert.equal(budgetAlerts().length, 2, "no more alerts while it waits");
  // The next day starts a fresh count.
  time += 24 * 3600_000;
  c.dispatch();
  await settled(c);
  assert.equal(c.snapshot().runs.find((r) => r.id === sixth).status, "succeeded");
});

// The provider circuit breaker ----------------------------------------------------

test("3. two usage-limit failures in 10 minutes hold that harness's autonomous runs (Team off too), notify once, leave Codex alone, and one probe closes it", async (t) => {
  let time = Date.parse("2026-09-30T10:00:00Z");
  const script = { Ana: [limitError()], Ben: [limitError(), limitError()] };
  let probe = null;
  const { c, e, room, routine, say, attention, diagnostics, calls } = await office(t, [["Ana"], ["Ben"], ["Cy"], ["Dex", "codex"]], {
    clock: () => time,
    reply: (name) => {
      const next = script[name]?.shift();
      if (next) return next;
      if (probe) return probe.promise;
      return "ok";
    },
  });
  clearInterval(c.timer);
  const hall = await room("Hall", Object.values(e));
  routine(hall, e.Ana);
  routine(hall, e.Ben);
  c.dispatch();
  await settled(c);
  assert.equal(c.snapshot().team.breakers.find((b) => b.harness === "claude").state, "open");
  const opened = () => attention.filter((a) => /usage limit/i.test(a.title));
  assert.equal(opened().length, 1);
  assert.equal(diagnostics.filter((d) => d.code === "breaker.opened").length, 1);
  const cy = routine(hall, e.Cy);
  const ana = routine(hall, e.Ana);
  const dex = routine(hall, e.Dex);
  c.dispatch();
  await until(() => c.snapshot().runs.find((r) => r.id === dex).status === "succeeded", "the Codex bot's run");
  for (const id of [cy, ana]) {
    assert.equal(c.snapshot().runs.find((r) => r.id === id).status, "queued");
    assert.equal(c.snapshot().team.waits[id].reason, "breaker");
    assert.equal(c.snapshot().team.waits[id].harness, "claude");
  }
  // Your own messages still try (this one hits the limit again).
  const dm = await room("Ben", [e.Ben]);
  const mine = await say(dm, "Try anyway");
  await until(() => c.snapshot().runs.find((r) => r.id === mine.id).status === "failed", "your run");
  assert.equal(opened().length, 1, "still one notification");
  // After 15 minutes, exactly one probe goes.
  time += 15 * 60_000;
  probe = deferred();
  const before = calls.length;
  c.dispatch();
  c.dispatch();
  await until(() => calls.length === before + 1, "the probe");
  await pause(50);
  assert.equal(calls.length, before + 1, "one probe at a time");
  assert.equal(c.snapshot().runs.filter((r) => [cy, ana].includes(r.id) && r.status === "running").length, 1);
  probe.resolve("back to work");
  probe = null;
  await settled(c);
  for (const id of [cy, ana]) assert.equal(c.snapshot().runs.find((r) => r.id === id).status, "succeeded");
  assert.equal(c.snapshot().team.breakers.find((b) => b.harness === "claude"), undefined, "closed again");
  assert.equal(diagnostics.filter((d) => d.code === "breaker.closed").length, 1);
  for (const code of ["breaker.opened", "breaker.closed"]) assert.notEqual(describeIssue({ code, context: { harness: "claude" } }).title, code);
});

test("3b. a failed run whose text says 'billing quota 429' never opens the breaker", async (t) => {
  let fail = 2;
  const { c, e, room, routine, diagnostics } = await office(t, [["Ana"], ["Ben"], ["Cy"]], {
    reply: () => (fail-- > 0 ? new Error("The task said: billing quota 429 exceeded, please log in again") : "ok"),
  });
  clearInterval(c.timer);
  const hall = await room("Hall", Object.values(e));
  routine(hall, e.Ana);
  routine(hall, e.Ben);
  c.dispatch();
  await settled(c);
  assert.equal(diagnostics.filter((d) => d.code === "harness.usage_limit").length, 2, "still logged as a likely limit");
  assert.deepEqual(c.snapshot().team.breakers, []);
  const next = routine(hall, e.Cy);
  c.dispatch();
  await settled(c);
  assert.equal(c.snapshot().runs.find((r) => r.id === next).status, "succeeded");
});

test("3c. while the breaker is open, a hand-off that hit the limit doesn't wake the bot that handed it off", async (t) => {
  const script = { Ana: [limitError(), limitError(), limitError()], Dex: [delegate("ANA", "Summarise the inbox")] };
  const { c, e, room, routine, say, notices, runsOf } = await office(t, [["Ana"], ["Ben"], ["Dex", "codex"]], {
    reply: (name) => script[name]?.shift() ?? "ok",
  });
  script.Dex[0] = delegate(e.Ana.id, "Summarise the inbox");
  clearInterval(c.timer);
  const hall = await room("Hall", Object.values(e));
  routine(hall, e.Ana);
  routine(hall, e.Ana);
  c.dispatch();
  await settled(c);
  assert.equal(c.snapshot().team.breakers[0]?.state, "open");
  // Your message to Dex; Dex hands off to Ana, whose run hits the limit again.
  await say(hall, "@Dex sort the inbox", [e.Dex.id]);
  await settled(c);
  assert.equal(runsOf(e.Dex).length, 1, "Dex isn't started again to report a failure");
  assert.equal(runsOf(e.Ana).at(-1).status, "failed");
  assert.equal(notices(/usage limit/i).length, 1);
});

// The Team switch and the kill switch ----------------------------------------------

test("4. team.stop turns Autopilot off everywhere and cancels queued autonomous runs; your message still runs; team.resume restores exactly the rooms that were on", async (t) => {
  const { c, e, room, routine, say, notices } = await office(t, [["Nova"], ["Reel"]]);
  clearInterval(c.timer);
  await c.command("team.set", { enabled: true });
  const [a, b, d] = [await room("A", [e.Nova, e.Reel]), await room("B", [e.Nova, e.Reel]), await room("C", [e.Nova, e.Reel])];
  for (const r of [a, d]) await c.command("conversations.setAutopilot", { conversation: r.id, enabled: true });
  await c.command("runtime.pause");
  const autonomous = [routine(a, e.Nova), routine(d, e.Reel)];
  const mine = await say(b, "@Nova hello");
  await c.command("team.stop");
  const snapshot = c.snapshot();
  assert.deepEqual(snapshot.conversations.map((x) => x.autopilot), [0, 0, 0]);
  for (const id of autonomous) assert.equal(snapshot.runs.find((r) => r.id === id).status, "cancelled");
  assert.equal(snapshot.runs.find((r) => r.id === mine.id).status, "queued");
  assert.equal(snapshot.team.state, "stopped");
  assert.equal(notices(/team was stopped/i).length, 2, "one notice per conversation");
  await c.command("runtime.resume");
  await until(() => c.snapshot().runs.find((r) => r.id === mine.id).status === "succeeded", "your message");
  await c.command("team.resume");
  assert.deepEqual(
    c.snapshot().conversations.map((x) => [x.title, x.autopilot]).sort(),
    [
      ["A", 1],
      ["B", 0],
      ["C", 1],
    ],
  );
  assert.equal(c.snapshot().team.state, "running");
});

test("4b. after team.stop, a due routine, and a finishing run's hand-off, @mention and returned result, start nothing", async (t) => {
  let time = Date.parse("2026-09-30T10:00:00Z");
  const gates = { Chief: deferred(), Lead: deferred() };
  const { c, e, room, routine, notices, runsOf } = await office(t, [["Chief"], ["Lead"], ["Junior"]], {
    clock: () => time,
    reply: (name) => gates[name]?.promise ?? "ok",
  });
  clearInterval(c.timer);
  const studio = await room("Studio", Object.values(e));
  await c.command("routines.create", { name: "Check", prompt: "Check in", employee: e.Junior.id, conversation: studio.id, minutes: 5 });
  // Autonomous work already running: Chief (will hand off and @mention) and
  // Lead, a hand-off from routine work whose result would go back to Chief.
  const chiefRun = routine(studio, e.Chief);
  const parent = routine(studio, e.Junior, "Routine: plan");
  c.store.run("UPDATE runs SET status='succeeded' WHERE id=?", parent);
  const handoff = c.addMessage(studio.id, e.Junior.id, "handoff", "Draft it");
  c.addRun(studio.id, e.Lead.id, handoff, parent, parent, 1, null, handoff);
  c.dispatch();
  await until(() => c.snapshot().runs.filter((r) => r.status === "running").length === 2, "both running");
  await c.command("team.stop");
  gates.Chief.resolve(`${delegate(e.Lead.id, "Draft the plan")}\n\n@Junior please check the numbers.`);
  gates.Lead.resolve("Drafted.");
  await settled(c);
  assert.deepEqual(
    runsOf(e.Lead).map((r) => r.status),
    ["succeeded"],
    "no hand-off to Lead",
  );
  assert.equal(runsOf(e.Junior).filter((r) => r.id !== parent).length, 0, "no @mention run and no returned-result run");
  assert.equal(notices(/team is stopped/i).length, 3, "one notice each: the hand-off, the mention and the result");
  assert.ok(runsOf(e.Chief).every((r) => r.id === chiefRun));
  time += 5 * 60_000;
  c.routines.tick();
  assert.equal(runsOf(e.Junior).length, 1, "the due routine queued nothing");
  assert.equal(c.snapshot().routines[0].lastOccurrence, "skipped-stopped");
});

test("4c. turning Team off is the same as Stop the team, and turning it on again restores Autopilot", async (t) => {
  let time = Date.parse("2026-09-30T10:00:00Z");
  const { c, e, room, routine, runsOf } = await office(t, [["Nova"], ["Reel"]], { clock: () => time });
  clearInterval(c.timer);
  const studio = await room("Studio", [e.Nova, e.Reel]);
  await c.command("conversations.setAutopilot", { conversation: studio.id, enabled: true });
  await c.command("routines.create", { name: "Check", prompt: "Check in", employee: e.Nova.id, conversation: studio.id, minutes: 5 });
  await c.command("team.set", { enabled: true });
  await c.command("runtime.pause");
  const queued = routine(studio, e.Reel);
  await c.command("team.set", { enabled: false });
  const team = c.snapshot().team;
  assert.equal(team.state, "stopped");
  assert.equal(team.enabled, false);
  assert.equal(c.snapshot().conversations[0].autopilot, 0);
  assert.equal(c.snapshot().runs.find((r) => r.id === queued).status, "cancelled");
  await c.command("runtime.resume");
  time += 5 * 60_000;
  c.routines.tick();
  assert.equal(runsOf(e.Nova).length, 0);
  assert.equal(c.snapshot().routines[0].lastOccurrence, "skipped-stopped");
  await c.command("team.set", { enabled: true });
  assert.equal(c.snapshot().team.state, "running");
  assert.equal(c.snapshot().conversations[0].autopilot, 1);
});

test("4d. a paused team holds autonomous work until the pause ends; your messages still run", async (t) => {
  let time = Date.parse("2026-09-30T10:00:00Z");
  const { c, e, room, routine, say } = await office(t, [["Nova"]], { clock: () => time });
  clearInterval(c.timer);
  const dm = await room("Nova", [e.Nova]);
  await c.command("team.pause", { minutes: 60 });
  assert.equal(c.snapshot().team.state, "paused");
  assert.equal(c.snapshot().team.pausedUntil, time + 3600_000);
  const held = routine(dm, e.Nova);
  c.dispatch();
  assert.equal(c.snapshot().runs.find((r) => r.id === held).status, "queued");
  assert.equal(c.snapshot().team.waits[held].reason, "paused");
  const mine = await say(dm, "Still here?");
  await until(() => c.snapshot().runs.find((r) => r.id === mine.id).status === "succeeded", "your message");
  assert.equal(c.snapshot().runs.find((r) => r.id === held).status, "queued");
  time += 3600_000;
  c.dispatch();
  await settled(c);
  assert.equal(c.snapshot().runs.find((r) => r.id === held).status, "succeeded");
  assert.equal(c.snapshot().team.state, "off", "Team was off before the pause");
  await assert.rejects(c.command("team.pause", { minutes: 0 }), /1 to 1440/);
  await c.command("team.stop");
  await assert.rejects(c.command("team.pause", { minutes: 5 }), /stopped/);
});

test("5. with Team off the queue is first come, first served; with Team on your message goes first", async (t) => {
  const { c, e, room, routine, say, calls } = await office(t, [["A"], ["B"]], { concurrency: 1 });
  clearInterval(c.timer);
  const [dmA, dmB] = [await room("A", [e.A]), await room("B", [e.B])];
  const order = async () => {
    calls.length = 0;
    await c.command("runtime.pause");
    routine(dmA, e.A);
    await say(dmB, "Mine");
    await c.command("runtime.resume");
    await settled(c);
    return calls.map((call) => call.name);
  };
  assert.deepEqual(await order(), ["A", "B"]);
  await c.command("team.set", { enabled: true });
  assert.deepEqual(await order(), ["B", "A"]);
});

// Refusals ------------------------------------------------------------------------

test("6. with Team on, a dontAsk bot's routine run is refused with a notice until it's opted in; with Team off it runs", async (t) => {
  const { c, e, room, routine, say, notices, diagnostics, calls } = await office(t, [["Pax", "claude", "dontAsk"]]);
  clearInterval(c.timer);
  const dm = await room("Pax", [e.Pax]);
  const status = (id) => c.snapshot().runs.find((r) => r.id === id).status;
  const off = routine(dm, e.Pax);
  c.dispatch();
  await settled(c);
  assert.equal(status(off), "succeeded", "Team off: unchanged");
  await c.command("team.set", { enabled: true });
  const before = calls.length;
  const refused = [routine(dm, e.Pax), routine(dm, e.Pax)];
  c.dispatch();
  await settled(c);
  for (const id of refused) assert.equal(status(id), "cancelled");
  assert.equal(calls.length, before, "never started");
  assert.equal(notices(/Everything runs|dontAsk|without asking/i).length, 1, "one notice");
  assert.equal(diagnostics.filter((d) => d.code === "run.dontask_refused").length, 1);
  const mine = await say(dm, "Do this");
  await settled(c);
  assert.equal(status(mine.id), "succeeded", "your own message still runs");
  await c.command("team.set", { dontAskAllowed: [e.Pax.id] });
  const allowed = routine(dm, e.Pax);
  c.dispatch();
  await settled(c);
  assert.equal(status(allowed), "succeeded");
});

test("9. with Team on, Codex bots take no unattended work until Any Bot can switch off their MCP servers", async (t) => {
  const { c, e, room, routine, say, notices, diagnostics } = await office(t, [["Scout", "codex"]]);
  clearInterval(c.timer);
  const dm = await room("Scout", [e.Scout]);
  const status = (id) => c.snapshot().runs.find((r) => r.id === id).status;
  await c.command("team.set", { enabled: true });
  const refused = routine(dm, e.Scout);
  c.dispatch();
  await settled(c);
  assert.equal(status(refused), "cancelled");
  assert.equal(notices(/Codex/).length, 1);
  assert.equal(diagnostics.filter((d) => d.code === "run.codex_mcp_unverified").length, 1);
  assert.notEqual(describeIssue({ code: "run.codex_mcp_unverified", context: {} }).title, "run.codex_mcp_unverified");
  const mine = await say(dm, "Look this up");
  await settled(c);
  assert.equal(status(mine.id), "succeeded");
  // Turning Team off stops the team; resuming without it goes back to how things were.
  await c.command("team.set", { enabled: false });
  assert.equal(c.snapshot().team.state, "stopped");
  await c.command("team.resume", { enabled: false });
  assert.equal(c.snapshot().team.state, "off");
  const off = routine(dm, e.Scout);
  c.dispatch();
  await settled(c);
  assert.equal(status(off), "succeeded", "Team off: unchanged");
});

// Getting through to a busy bot ---------------------------------------------------

test("8. your message to a bot busy with autonomous work says why it waits, and Interrupt starts it at once; the interrupted work runs after", async (t) => {
  let turn = 0;
  const { c, e, room, routine, say, calls, notices } = await office(t, [["Nova"]], {
    reply: () => (turn++ === 0 ? new Promise(() => {}) : "ok"),
  });
  clearInterval(c.timer);
  const dm = await room("Nova", [e.Nova]);
  const busy = routine(dm, e.Nova);
  c.dispatch();
  await until(() => calls.length === 1, "the routine run");
  const mine = await say(dm, "Can you look at this now?");
  const wait = c.snapshot().team.waits[mine.id];
  assert.equal(wait.reason, "bot-busy");
  assert.equal(wait.blocker, busy);
  assert.equal(wait.lane, "autonomous");
  assert.equal(wait.kind, "routine");
  assert.equal(wait.mine, true, "your own message, so you may interrupt");
  await assert.rejects(c.command("runs.interrupt", { id: mine.id }), /running/);
  await c.command("runs.interrupt", { id: busy });
  await settled(c);
  const runs = c.snapshot().runs;
  assert.equal(runs.find((r) => r.id === busy).status, "cancelled");
  assert.equal(runs.find((r) => r.id === mine.id).status, "succeeded");
  const again = runs.filter((r) => r.message === runs.find((x) => x.id === busy).message && r.id !== busy);
  assert.equal(again.length, 1, "the routine's work was queued again");
  assert.equal(again[0].status, "succeeded");
  assert.equal(again[0].root, busy, "as the same piece of work");
  assert.equal(calls.length, 3);
  assert.match(calls[1].prompt, /Can you look at this now?/, "your message went first");
  assert.match(calls[2].prompt, /Routine: check in/);
  assert.equal(notices(/interrupted/i).length, 1);
  // Your own work can only be stopped, not interrupted.
  const ownGate = deferred();
  turn = -100;
  c.runner = async () => ownGate.promise;
  const own = await say(dm, "Long one");
  await until(() => c.snapshot().runs.find((r) => r.id === own.id).status === "running", "your run");
  await assert.rejects(c.command("runs.interrupt", { id: own.id }), /your own/i);
  ownGate.resolve("done");
  await settled(c);
});

// Settings ------------------------------------------------------------------------

test("10. concurrency changes live within 1–12 and is kept across restarts; team.get reports the state", async (t) => {
  const { c, directory } = await office(t, []);
  let status = await c.command("team.get");
  assert.equal(status.state, "off");
  assert.equal(status.enabled, false);
  assert.equal(status.settings.concurrency, 8);
  const snapshot = await c.command("team.set", { concurrency: 3, ownerReserve: 1 });
  assert.equal(c.concurrency, 3);
  assert.equal(snapshot.runtime.concurrency, 3);
  status = await c.command("team.get");
  assert.equal(status.settings.concurrency, 3);
  assert.equal(status.settings.ownerReserve, 1);
  await assert.rejects(c.command("team.set", { concurrency: 13 }), /1 to 12/);
  await assert.rejects(c.command("team.set", { concurrency: 0 }), /1 to 12/);
  await c.close();
  const again = new Coordinator({ directory, concurrency: 8, probe: async () => [] });
  try {
    assert.equal(again.concurrency, 3);
    assert.equal((await again.command("team.get")).state, "off", "still off");
  } finally {
    await again.close();
  }
});

test("12. Stop the team works with Team off too, and Resume goes back to off", async (t) => {
  let time = Date.parse("2026-09-30T10:00:00Z");
  const { c, e, room, runsOf } = await office(t, [["Nova"]], { clock: () => time });
  clearInterval(c.timer);
  const dm = await room("Nova", [e.Nova]);
  await c.command("routines.create", { name: "Check", prompt: "Check in", employee: e.Nova.id, conversation: dm.id, minutes: 5 });
  await c.command("team.stop");
  assert.equal(c.snapshot().team.state, "stopped");
  time += 5 * 60_000;
  c.routines.tick();
  assert.equal(runsOf(e.Nova).length, 0);
  // You can still run a routine yourself.
  await c.command("routines.runNow", { id: c.snapshot().routines[0].id });
  await settled(c);
  assert.equal(runsOf(e.Nova).at(-1).status, "succeeded");
  assert.equal(c.runInfo(runsOf(e.Nova).at(-1)).lane, "owner");
  await c.command("team.resume");
  assert.equal(c.snapshot().team.state, "off");
  time += 5 * 60_000;
  c.routines.tick();
  c.dispatch();
  await settled(c);
  assert.equal(runsOf(e.Nova).length, 2, "routines run again");
});

test("the Team's problems have plain-language titles and next steps", async () => {
  for (const code of ["budget.cap_reached", "breaker.opened", "breaker.closed", "run.dontask_refused", "run.codex_mcp_unverified"]) {
    const issue = describeIssue({ code, context: { employee: "Nova", harness: "claude", scope: "bot" } });
    assert.notEqual(issue.title, code, code);
    assert.ok(issue.hint.length > 20, code);
  }
});
