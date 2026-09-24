// Harness sessions (runtime/sessions.mjs, lean-runtime M2): turn 1 fresh,
// later turns resume the native CLI session with only what's new; every way a
// session must end or start over; the argv each harness gets.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invocation, runHarness } from "../runtime/adapters.mjs";
import { buildContext } from "../runtime/context.mjs";
import { Coordinator } from "../runtime/coordinator.mjs";

// --- argv -------------------------------------------------------------------

test("Claude: fresh turns choose the session id, resumed turns keep every run control", () => {
  const approvals = { configPath: "C:/anybot/approvals/r1.json" };
  const fresh = invocation("claude", "claude-sonnet-5", "auto", approvals, { id: "s-1", resume: false });
  const resumed = invocation("claude", "claude-sonnet-5", "auto", approvals, { id: "s-1", resume: true });
  const base = invocation("claude", "claude-sonnet-5", "auto", approvals);
  for (const flag of ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "--mcp-config", "--model"]) {
    assert.ok(fresh.includes(flag) && resumed.includes(flag), flag);
  }
  assert.deepEqual(fresh.slice(fresh.indexOf("--session-id"), fresh.indexOf("--session-id") + 2), ["--session-id", "s-1"]);
  assert.deepEqual(resumed.slice(resumed.indexOf("--resume"), resumed.indexOf("--resume") + 2), ["--resume", "s-1"]);
  assert.ok(!base.includes("--resume") && !base.includes("--session-id"));
});

test("Codex: resume carries JSON output and the workspace sandbox (exec resume has no --sandbox)", () => {
  assert.deepEqual(invocation("codex", "", "auto", undefined, { id: "t-1", resume: true }), [
    "exec", "resume", "--json", "--skip-git-repo-check", "-c", "sandbox_mode=workspace-write", "t-1", "-",
  ]);
  assert.deepEqual(invocation("codex", "gpt-5.3-codex", "auto", undefined, { id: "t-1", resume: true }).slice(-2), ["--model", "gpt-5.3-codex"]);
  // A fresh Codex turn is today's command; Codex reports its own thread id.
  assert.deepEqual(invocation("codex", "", "auto", undefined, { id: "ignored", resume: false }), invocation("codex"));
});

// --- runHarness: session ids and verified resume rejections ----------------

async function fakeCli(t, harness, script, session) {
  const workspace = await mkdtemp(join(tmpdir(), "anybot-session-cli-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const file = join(workspace, "cli.cjs");
  await writeFile(file, script);
  const reported = [];
  const run = runHarness(
    { harness, workspace, prompt: "p", signal: new AbortController().signal, onText: () => {}, onSession: (id) => reported.push(id), session },
    { resolve: async () => ({ file: process.execPath, prefix: [file] }), pipeGraceMs: 50 },
  );
  return { run, reported };
}
const lines = (...events) => events.map((e) => `process.stdout.write(${JSON.stringify(`${JSON.stringify(e)}\n`)});`).join("\n");

test("the session id comes from Claude's init event and Codex's thread.started", async (t) => {
  const claude = await fakeCli(t, "claude", lines({ type: "system", subtype: "init", session_id: "c-9" }, { type: "result", is_error: false, result: "ok", num_turns: 1 }));
  assert.equal(await claude.run, "ok");
  assert.deepEqual(claude.reported, ["c-9"]);
  const codex = await fakeCli(t, "codex", lines({ type: "thread.started", thread_id: "x-9" }, { type: "turn.started" }, { type: "item.completed", item: { type: "agent_message", text: "ok" } }));
  assert.equal(await codex.run, "ok");
  assert.deepEqual(codex.reported, ["x-9"]);
});

test("a resume refused before the turn is a typed ResumeRejected (captured shapes)", async (t) => {
  const claude = await fakeCli(
    t,
    "claude",
    `${lines({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0, errors: ["No conversation found with session ID: s-1"] })}\nprocess.exitCode=1;`,
    { id: "s-1", resume: true },
  );
  await assert.rejects(claude.run, (error) => error.code === "RESUME_REJECTED");
  const codex = await fakeCli(
    t,
    "codex",
    `process.stderr.write("Error: thread/resume: thread/resume failed: no rollout found for thread id t-1 (code -32600)\\n"); process.exitCode=1;`,
    { id: "t-1", resume: true },
  );
  await assert.rejects(codex.run, (error) => error.code === "RESUME_REJECTED");
});

test("a failure after the turn started is never treated as a refused resume", async (t) => {
  const midTurn = await fakeCli(
    t,
    "codex",
    `${lines({ type: "thread.started", thread_id: "t-1" }, { type: "turn.started" }, { type: "item.completed", item: { type: "agent_message", text: "Editing files" } })}
process.stderr.write("thread/resume failed: no rollout found\\n"); process.exitCode=1;`,
    { id: "t-1", resume: true },
  );
  await assert.rejects(midTurn.run, (error) => error.code !== "RESUME_REJECTED");
  // A fresh turn's failure isn't a refused resume either.
  const fresh = await fakeCli(t, "claude", `${lines({ type: "result", is_error: true, num_turns: 0, errors: ["No conversation found with session ID: s-2"] })}\nprocess.exitCode=1;`, { id: "s-2", resume: false });
  await assert.rejects(fresh.run, (error) => error.code !== "RESUME_REJECTED");
});

// --- the context of a resumed turn ------------------------------------------

let rowid = 0;
const msg = (author, body, extra = {}) => ({ id: `m${++rowid}`, rowid, author, kind: author === "human" ? "user" : "assistant", body, ...extra });

test("review finding: a message delivered out of order is still sent later (ids, not a cursor)", () => {
  // Row 11 (a human message) was not eligible for the last turn, row 12 was.
  const m10 = msg("human", "A: first ask");
  const m11 = msg("human", "B: posted while A waited");
  const m12 = msg("sam", "Answer to an earlier ask");
  const m13 = msg("human", "Now, @Alex, follow up");
  const context = buildContext({
    employee: { id: "alex", name: "Alex", instructions: "I", workspace: "w" },
    run: { thread: null },
    names: (id) => ({ sam: "Sam" })[id] || id,
    messages: [m10, m11, m12, m13],
    assignment: m13,
    session: { delivered: new Set([m10.id, m12.id]) },
  });
  assert.match(context.text, /B: posted while A waited/);
  assert.doesNotMatch(context.text, /A: first ask|Answer to an earlier ask/);
  assert.equal(context.sections.instructions + context.sections.platform + context.sections.actionGuide, 0, "stable layers stay in the session");
  assert.deepEqual(context.seen, [m10.id, m11.id, m12.id, m13.id]);
});

// --- coordinator ------------------------------------------------------------

// A runner that behaves like a resumable CLI: it reports a session id, and
// can refuse a resume or fail on cue.
function resumableRunner(calls, script = {}) {
  let threads = 0;
  return async (options) => {
    const call = { prompt: options.prompt, session: options.session, harness: options.harness };
    calls.push(call);
    const step = script[calls.length];
    if (step?.wait) await step.wait;
    if (step === "reject" && options.session?.resume) {
      const error = new Error("No conversation found with session ID");
      error.code = "RESUME_REJECTED";
      throw error;
    }
    if (step === "fail") throw new Error("Provider unavailable");
    options.onSession?.(options.harness === "codex" && !options.session?.resume ? `codex-thread-${++threads}` : options.session.id);
    return step?.reply || `Reply ${calls.length}`;
  };
}

// Resume is off by default (the M2 live gate), so these opt Claude in.
async function workspace(t, runner, { harness = "claude", bots = ["Alex"], resumable = ["claude"] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-sessions-"));
  const c = new Coordinator({ directory, runner, probe: async () => [], sessionProbe: async () => true, concurrency: 1, ...(resumable ? { resumable } : {}) });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  for (const name of bots) await c.command("employees.create", { name, role: "Engineer", harness, trusted: true });
  const people = Object.fromEntries(c.snapshot().employees.map((e) => [e.name, e]));
  await c.command("conversations.create", { title: "Room", members: Object.values(people).map((e) => e.id) });
  const room = c.snapshot().conversations[0];
  const settled = async () => {
    for (let i = 0; i < 400 && c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status)); i++)
      await new Promise((r) => setTimeout(r, 10));
  };
  const say = async (body, extra = {}) => {
    await c.command("messages.send", { conversation: room.id, body, requestId: crypto.randomUUID(), ...extra });
    await settled();
  };
  return { c, people, room, say, settled };
}
const rows = (c) => c.store.all("SELECT * FROM harness_sessions");

test("turn 1 is fresh; turn 2 resumes the same session with only what's new", async (t) => {
  const calls = [];
  const { c, say } = await workspace(t, resumableRunner(calls));
  await say("Plan the launch");
  await say("Now write the email");
  assert.equal(calls[0].session.resume, false);
  assert.deepEqual(calls[1].session, { id: calls[0].session.id, resume: true });
  assert.match(calls[0].prompt, /You are working in Any Bot as Alex/);
  assert.doesNotMatch(calls[1].prompt, /You are working in Any Bot|anybot-actions/, "stable layers stay in the session");
  assert.doesNotMatch(calls[1].prompt, /Reply 1/, "the bot's own reply is already in its session");
  assert.match(calls[1].prompt, /Your current assignment:\nNow write the email/);
  assert.equal(rows(c).length, 1, "one row for a direct chat (thread key '')");
  assert.equal(rows(c)[0].thread, "");
  assert.equal(rows(c)[0].turns, 2);
});

test("no harness resumes by default (live gate); when enabled, Codex resumes the thread id it reports", async (t) => {
  const off = [];
  const plain = await workspace(t, resumableRunner(off), { harness: "claude", resumable: null });
  await plain.say("One");
  await plain.say("Two");
  assert.deepEqual(off.map((call) => call.session), [undefined, undefined]);
  const calls = [];
  const { c, say } = await workspace(t, resumableRunner(calls), { harness: "codex", resumable: ["codex"] });
  await say("One");
  await say("Two");
  assert.deepEqual(calls[1].session, { id: "codex-thread-1", resume: true });
  assert.equal(rows(c)[0].session_id, "codex-thread-1");
});

test("a failed turn drops the session, so the next one starts fresh with full context", async (t) => {
  const calls = [];
  const { c, say } = await workspace(t, resumableRunner(calls, { 2: "fail" }));
  await say("One");
  await say("Two");
  assert.equal(rows(c).length, 0);
  await say("Three");
  assert.equal(calls[2].session.resume, false);
  assert.match(calls[2].prompt, /You are working in Any Bot as Alex/);
  assert.match(calls[2].prompt, /Reply 1/, "a fresh turn gets the history again");
});

test("a refused resume is retried once, fresh, in the same run, with a diagnostic", async (t) => {
  const calls = [];
  const { c, say } = await workspace(t, resumableRunner(calls, { 2: "reject" }));
  const seen = [];
  c.on("diagnostic", (entry) => seen.push(entry.code));
  await say("One");
  await say("Two");
  assert.equal(calls.length, 3, "one retry");
  assert.equal(calls[2].session.resume, false);
  assert.notEqual(calls[2].session.id, calls[0].session.id);
  assert.deepEqual(c.snapshot().runs.map((r) => r.status), ["succeeded", "succeeded"]);
  assert.ok(seen.includes("session.resume_failed"));
  assert.equal(rows(c)[0].session_id, calls[2].session.id);
});

test("review finding: any policy change starts a fresh session", async (t) => {
  const calls = [];
  const { c, people } = await workspace(t, resumableRunner(calls), { bots: ["Alex", "Sam"] });
  const alex = () => c.snapshot().employees.find((e) => e.name === "Alex");
  // A direct chat with Alex (project messages would each open a thread).
  await c.command("conversations.create", { title: "Alex", members: [people.Alex.id] });
  const direct = c.snapshot().conversations.find((x) => x.title === "Alex").id;
  const sayDirect = async (body) => {
    await c.command("messages.send", { conversation: direct, body, requestId: crypto.randomUUID() });
    for (let i = 0; i < 300 && c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status)); i++)
      await new Promise((r) => setTimeout(r, 10));
  };
  await sayDirect("One");
  await sayDirect("Two");
  assert.equal(calls.at(-1).session.resume, true);
  // Instructions changed: fresh.
  const a = alex();
  await c.command("employees.update", { ...a, instructions: "New instructions", trusted: true });
  await sayDirect("Three");
  assert.equal(calls.at(-1).session.resume, false);
  assert.match(calls.at(-1).prompt, /New instructions/);
  // A new direct report changes what it may delegate to: fresh.
  await sayDirect("Four");
  assert.equal(calls.at(-1).session.resume, true);
  await c.command("employees.setManager", { id: people.Sam.id, manager: people.Alex.id });
  await sayDirect("Five");
  assert.equal(calls.at(-1).session.resume, false);
  assert.match(calls.at(-1).prompt, /Your direct reports/);
});

test("two threads keep separate sessions; archiving a project drops them", async (t) => {
  const calls = [];
  const { c, room, say } = await workspace(t, resumableRunner(calls), { bots: ["Alex", "Sam"] });
  await say("@Alex first topic");
  await say("@Alex second topic");
  const threads = rows(c).map((r) => r.thread);
  assert.equal(new Set(threads).size, 2);
  assert.ok(threads.every(Boolean));
  const [first] = c.snapshot().runs.map((r) => r.thread);
  await say("@Alex back to the first", { thread: first });
  assert.equal(calls.at(-1).session.resume, true);
  assert.equal(calls.at(-1).session.id, calls[0].session.id);
  await c.command("conversations.setArchived", { id: room.id, conversation: room.id, archived: true });
  assert.equal(rows(c).length, 0);
});

test("a CLI without the session flags keeps running fresh", async (t) => {
  const calls = [];
  const directory = await mkdtemp(join(tmpdir(), "anybot-sessions-old-"));
  const c = new Coordinator({ directory, runner: resumableRunner(calls), probe: async () => [], sessionProbe: async () => false, concurrency: 1, resumable: ["claude"] });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  await c.command("employees.create", { name: "Alex", role: "Engineer", harness: "claude", trusted: true });
  await c.command("conversations.create", { title: "Alex", members: [c.snapshot().employees[0].id] });
  const conversation = c.snapshot().conversations[0].id;
  for (const body of ["One", "Two"]) {
    await c.command("messages.send", { conversation, body, requestId: crypto.randomUUID() });
    for (let i = 0; i < 300 && c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status)); i++)
      await new Promise((r) => setTimeout(r, 10));
  }
  assert.deepEqual(calls.map((call) => call.session), [undefined, undefined], "no --session-id for a CLI that lacks it");
});

test("Start fresh drops a bot's sessions, or one thread's", async (t) => {
  const calls = [];
  const { c, people, say } = await workspace(t, resumableRunner(calls), { bots: ["Alex", "Sam"] });
  await say("@Alex @Sam topic one");
  await say("@Alex topic two");
  assert.equal(rows(c).length, 3);
  const [first] = c.snapshot().runs.map((r) => r.thread);
  await c.command("sessions.startFresh", { conversation: c.snapshot().conversations[0].id, thread: first });
  assert.deepEqual(rows(c).map((r) => r.employee), [people.Alex.id]);
  await c.command("sessions.startFresh", { employee: people.Alex.id });
  assert.equal(rows(c).length, 0);
});

test("review finding: a human message posted while a turn waits isn't in it, and comes next turn", async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const calls = [];
  const { c, room } = await workspace(t, resumableRunner(calls, { 2: { wait: gate } }));
  const send = (body) => c.command("messages.send", { conversation: room.id, body, requestId: crypto.randomUUID() });
  const settled = async () => {
    for (let i = 0; i < 300 && c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status)); i++)
      await new Promise((r) => setTimeout(r, 10));
  };
  await send("One");
  await settled();
  await send("Two");
  await new Promise((r) => setTimeout(r, 30));
  await send("Three, sent while Two runs");
  release();
  await settled();
  assert.doesNotMatch(calls[1].prompt, /Three, sent while Two runs/);
  assert.match(calls[2].prompt, /Your current assignment:\nThree, sent while Two runs/);
  assert.equal(calls[2].session.resume, true);
});

test("review finding: channel background ignores a human reply posted while the run waited", async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const calls = [];
  const { c, room } = await workspace(t, resumableRunner(calls, { 1: { reply: "Topic A answer" }, 2: { wait: gate } }), { bots: ["Alex", "Sam"] });
  const send = (body, extra = {}) => c.command("messages.send", { conversation: room.id, body, requestId: crypto.randomUUID(), ...extra });
  const settled = async () => {
    for (let i = 0; i < 300 && c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status)); i++)
      await new Promise((r) => setTimeout(r, 10));
  };
  await send("@Alex topic A");
  await settled();
  const topicA = c.snapshot().runs[0].thread;
  await send("@Sam something slow"); // Sam's run waits on the gate
  await new Promise((r) => setTimeout(r, 30));
  await send("@Alex topic B"); // queued behind Sam (concurrency 1)
  await send("Owner's later note in topic A", { thread: topicA, recipients: [] });
  release();
  await settled();
  const topicB = calls.find((call) => /topic B/.test(call.prompt)).prompt;
  assert.match(topicB, /Topic A answer/, "the earlier answer is background");
  assert.doesNotMatch(topicB, /Owner's later note/);
});

test("exit gate: turns 2–5 send at most 15% of what fresh mode would", async (t) => {
  const calls = [];
  const { c, room, say } = await workspace(t, resumableRunner(calls));
  // A conversation with real history before the session starts.
  const alex = c.snapshot().employees[0].id;
  for (let i = 0; i < 24; i++) {
    const author = i % 2 ? alex : "human";
    c.store.run(
      "INSERT INTO messages(id,conversation,author,kind,body,created) VALUES (?,?,?,?,?,?)",
      `h${i}`, room.id, author, author === "human" ? "user" : "assistant", `History ${i}: ${"detail ".repeat(120)}`, new Date(Date.now() - 1e6 + i).toISOString(),
    );
  }
  for (const body of ["Turn one", "Turn two", "Turn three", "Turn four", "Turn five"]) await say(body);
  assert.deepEqual(calls.map((call) => call.session.resume), [false, true, true, true, true]);
  const runs = c.store.all("SELECT id,employee FROM runs ORDER BY rowid");
  const employee = c.store.one("SELECT * FROM employees WHERE id=?", alex);
  let sent = 0,
    fresh = 0;
  for (const run of runs.slice(1)) {
    sent += c.store.one("SELECT chars FROM run_inputs WHERE run=?", run.id).chars;
    fresh += c.promptParts(c.store.one("SELECT * FROM runs WHERE id=?", run.id), employee, []).text.length;
  }
  assert.ok(sent <= fresh * 0.15, `sent ${sent} chars vs ${fresh} fresh (${Math.round((sent / fresh) * 100)}%)`);
});

test("code review: a restart drops the session of a turn it interrupted", async (t) => {
  const calls = [];
  const directory = await mkdtemp(join(tmpdir(), "anybot-sessions-restart-"));
  let c;
  // One hook: close the workspace, then remove it (Windows cannot delete an open database).
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  const options = { directory, probe: async () => [], sessionProbe: async () => true, concurrency: 1, resumable: ["claude"] };
  c = new Coordinator({ ...options, runner: resumableRunner(calls) });
  await c.initialize();
  await c.command("employees.create", { name: "Alex", role: "Engineer", harness: "claude", trusted: true });
  await c.command("conversations.create", { title: "Alex", members: [c.snapshot().employees[0].id] });
  const conversation = c.snapshot().conversations[0].id;
  const settle = async () => {
    for (let i = 0; i < 300 && c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status)); i++)
      await new Promise((r) => setTimeout(r, 10));
  };
  await c.command("messages.send", { conversation, body: "One", requestId: crypto.randomUUID() });
  await settle();
  assert.equal(rows(c).length, 1);
  // The app stops while turn 2 is running.
  c.store.run("UPDATE runs SET status='running' WHERE rowid=(SELECT max(rowid) FROM runs)");
  await c.close();
  c = new Coordinator({ ...options, runner: resumableRunner(calls) });
  await c.initialize();
  assert.equal(rows(c).length, 0);
});

test("code review: Start fresh during a run isn't undone when that run finishes", async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const calls = [];
  const { c, people, room, say } = await workspace(t, resumableRunner(calls, { 2: { wait: gate } }));
  await say("One");
  await c.command("messages.send", { conversation: room.id, body: "Two", requestId: crypto.randomUUID() });
  await new Promise((r) => setTimeout(r, 30));
  await c.command("sessions.startFresh", { employee: people.Alex.id });
  release();
  for (let i = 0; i < 300 && c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status)); i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(rows(c).length, 0, "the in-flight run didn't save its session back");
  await say("Three");
  assert.equal(calls.at(-1).session.resume, false);
});

test("code review: renaming a teammate starts a fresh session (the roster is in the stable layers)", async (t) => {
  const calls = [];
  const { c, people, say } = await workspace(t, resumableRunner(calls), { bots: ["Alex", "Sam"] });
  await say("@Alex one");
  const thread = c.snapshot().runs[0].thread;
  await say("@Alex two", { thread });
  assert.equal(calls.at(-1).session.resume, true);
  const sam = c.snapshot().employees.find((e) => e.id === people.Sam.id);
  await c.command("employees.update", { ...sam, name: "Samira", trusted: true });
  await say("@Alex three", { thread });
  assert.equal(calls.at(-1).session.resume, false);
  assert.match(calls.at(-1).prompt, /@Samira/);
});
