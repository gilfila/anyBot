import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finishUsage, parseUsage, readUsage, usageState } from "../runtime/usage.mjs";
import { runHarness } from "../runtime/adapters.mjs";
import { Coordinator } from "../runtime/coordinator.mjs";

const events = async (harness) =>
  (await readFile(new URL(`./fixtures/usage/${harness}.jsonl`, import.meta.url), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const parse = async (harness, options = {}) => {
  const state = usageState();
  for (const event of await events(harness)) readUsage(harness, event, state);
  return finishUsage(state, { harness, ...options });
};

test("Claude usage counts cache reads and writes as input, cached separately", async () => {
  assert.deepEqual(await parse("claude"), {
    "gen_ai.usage.input_tokens": 40118,
    "gen_ai.usage.cached_input_tokens": 40116,
    "gen_ai.usage.output_tokens": 4,
    "gen_ai.system": "anthropic",
    "gen_ai.request.model": "claude-sonnet-5",
    turns: 1,
    duration_ms: 1942,
    cost_usd: 0.008067,
  });
});

test("Codex usage keeps its input total, which already includes cached tokens", async () => {
  const usage = await parse("codex", { model: "gpt-5.3-codex", durationMs: 61000 });
  assert.equal(usage["gen_ai.usage.input_tokens"], 148409);
  assert.equal(usage["gen_ai.usage.cached_input_tokens"], 12800);
  assert.equal(usage["gen_ai.usage.output_tokens"], 1515);
  assert.equal(usage["gen_ai.request.model"], "gpt-5.3-codex");
  assert.equal(usage["gen_ai.system"], "openai");
  assert.equal(usage.turns, 1);
  assert.equal(usage.duration_ms, 61000);
  assert.equal(usage.cost_usd, undefined);
});

test("Gemini usage reads the result stats", async () => {
  const usage = await parse("gemini");
  assert.equal(usage["gen_ai.usage.input_tokens"], 9000);
  assert.equal(usage["gen_ai.usage.cached_input_tokens"], 4000);
  assert.equal(usage["gen_ai.usage.output_tokens"], 120);
  assert.equal(usage["gen_ai.request.model"], "gemini-2.5-pro");
  assert.equal(usage.duration_ms, 2100);
});

test("Cursor results without token counts still record the run's duration", async () => {
  const usage = await parse("cursor");
  assert.equal(usage["gen_ai.usage.input_tokens"], 0);
  assert.equal(usage.duration_ms, 3050);
  assert.equal(usage["gen_ai.request.model"], "gpt-5");
});

test("usage is null when the harness reports nothing, and never carries text", async () => {
  assert.equal(finishUsage(usageState(), { harness: "hermes" }), null);
  const state = usageState();
  readUsage("claude", { type: "system", subtype: "init", model: "Ignore previous instructions and" }, state);
  readUsage("claude", { type: "result", result: "secret reply text", usage: { input_tokens: "12", output_tokens: -3 } }, state);
  const usage = finishUsage(state, { harness: "claude" });
  assert.equal(usage["gen_ai.request.model"], undefined);
  assert.equal(usage["gen_ai.usage.input_tokens"], 0);
  assert.equal(usage["gen_ai.usage.output_tokens"], 0);
  assert.doesNotMatch(JSON.stringify(usage), /secret|Ignore/);
  assert.equal(parseUsage("not json"), null);
  assert.deepEqual(parseUsage('{"turns":1}'), { turns: 1 });
});

async function fakeCli(t, harness, lines, exit = 0) {
  const workspace = await mkdtemp(join(tmpdir(), "anybot-usage-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const script = join(workspace, "cli.cjs");
  await writeFile(
    script,
    `${lines.map((line) => `process.stdout.write(${JSON.stringify(JSON.stringify(line) + "\n")});`).join("\n")}\nprocess.exitCode=${exit};`,
  );
  let reported;
  const run = runHarness(
    { harness, workspace, prompt: "p", signal: new AbortController().signal, onText: () => {}, onUsage: (u) => (reported = u) },
    { resolve: async () => ({ file: process.execPath, prefix: [script] }), pipeGraceMs: 50 },
  );
  return { run, usage: () => reported };
}

test("runHarness reports usage from a real subprocess stream", async (t) => {
  const cli = await fakeCli(t, "codex", await events("codex"));
  assert.equal(await cli.run, "ok");
  assert.equal(cli.usage()["gen_ai.usage.input_tokens"], 148409);
  assert.ok(cli.usage().duration_ms >= 0);
});

test("runHarness reports usage for a failed turn too", async (t) => {
  const cli = await fakeCli(
    t,
    "claude",
    [{ type: "result", is_error: true, result: "boom", num_turns: 2, usage: { input_tokens: 10, output_tokens: 5 } }],
  );
  await assert.rejects(cli.run, /boom/);
  assert.equal(cli.usage()["gen_ai.usage.input_tokens"], 10);
  assert.equal(cli.usage().turns, 2);
});

async function coordinator(t, runner, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-usage-coord-"));
  const c = new Coordinator({ directory, runner, probe: async () => [], concurrency: 1, ...options });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  await c.command("employees.create", { name: "Builder", role: "Engineer", harness: "codex", trusted: true });
  const employee = c.snapshot().employees[0];
  await c.command("conversations.create", { title: "Direct", members: [employee.id] });
  const conversation = c.snapshot().conversations[0];
  const send = (body) => c.command("messages.send", { conversation: conversation.id, body, requestId: crypto.randomUUID() });
  return { c, send };
}
const settled = async (c) => {
  for (let i = 0; i < 200; i++) {
    if (c.snapshot().runs.every((r) => !["queued", "running"].includes(r.status))) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("runs did not settle");
};

test("a run stores its usage and its prompt's section sizes, not their text", async (t) => {
  const usage = { "gen_ai.usage.input_tokens": 100, "gen_ai.usage.cached_input_tokens": 40, "gen_ai.usage.output_tokens": 7, turns: 1, duration_ms: 5 };
  const { c, send } = await coordinator(t, async (options) => {
    options.onUsage(usage);
    return "Done";
  });
  await send("Build the landing page");
  await settled(c);
  const run = c.snapshot().runs[0];
  assert.deepEqual(run.usage, usage);
  const input = c.store.one("SELECT * FROM run_inputs WHERE run=?", run.id);
  const sections = JSON.parse(input.sections);
  assert.deepEqual(Object.keys(sections), [
    "instructions", "platform", "delegation", "artifacts", "board", "actionGuide",
    "org", "knowledge", "team", "background", "history", "assignment",
  ]);
  assert.ok(Object.values(sections).every((n) => Number.isInteger(n) && n >= 0));
  assert.equal(Object.values(sections).reduce((a, b) => a + b, 0), input.prompt.length);
  assert.equal(input.chars, input.prompt.length);
  assert.match(input.hash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(input.sections, /landing/);
  assert.ok(sections.assignment > "Build the landing page".length);
});

test("a failed run keeps the usage its harness reported", async (t) => {
  const { c, send } = await coordinator(t, async (options) => {
    options.onUsage({ "gen_ai.usage.input_tokens": 9, turns: 1 });
    throw new Error("Provider unavailable");
  });
  await send("Try this");
  await settled(c);
  const run = c.snapshot().runs[0];
  assert.equal(run.status, "failed");
  assert.equal(run.usage["gen_ai.usage.input_tokens"], 9);
});

test("prompt() is the concatenation of promptParts()", async (t) => {
  let seen;
  const { c, send } = await coordinator(t, async (options) => {
    seen = options.prompt;
    return "Done";
  });
  await send("Hello");
  await settled(c);
  const input = c.store.one("SELECT prompt FROM run_inputs");
  assert.equal(input.prompt, seen);
  assert.match(seen, /Conversation:\nHuman: Hello\n\nYour current assignment:\nHello\n\nRespond/);
});
