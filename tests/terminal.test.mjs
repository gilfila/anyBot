import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalLog, formatEvent } from "../runtime/terminal.mjs";
import { runHarness } from "../runtime/adapters.mjs";
import { Coordinator } from "../runtime/coordinator.mjs";

test("Claude Code events read like its terminal", () => {
  const f = (event) => formatEvent("claude", event);
  assert.equal(f({ type: "system", subtype: "init", model: "claude-opus-5-5", cwd: "C:/work" }), "● Session started · claude-opus-5-5 · C:/work\n");
  assert.equal(
    f({ type: "assistant", message: { content: [{ type: "text", text: "Running the tests." }, { type: "tool_use", name: "Bash", input: { command: "npm test" } }] } }),
    "Running the tests.\n⏺ Bash(npm test)\n",
  );
  const many = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join("\n");
  assert.equal(
    f({ type: "user", message: { content: [{ type: "tool_result", content: many }] } }),
    "  ⎿ line 1\n    line 2\n    line 3\n    line 4\n    line 5\n    line 6\n    … +3 lines\n",
  );
  assert.equal(
    f({ type: "result", num_turns: 3, duration_ms: 41800, total_cost_usd: 0.123, usage: { input_tokens: 1200, cache_read_input_tokens: 800, output_tokens: 345 } }),
    "✔ Done · 3 turns · 41.8s · $0.12 · 2,000 in / 345 out tokens\n",
  );
  assert.equal(f({ type: "stream_event" }), "", "noise is skipped");
});

test("Codex and Gemini events read like a terminal too", () => {
  assert.equal(formatEvent("codex", { type: "item.started", item: { type: "command_execution", command: "git status" } }), "⏺ Shell(git status)\n");
  assert.equal(
    formatEvent("codex", { type: "item.completed", item: { type: "command_execution", aggregated_output: "clean\n", exit_code: 1 } }),
    "  ⎿ clean\n    exit 1\n",
  );
  assert.equal(formatEvent("codex", { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } }), "✔ Turn done · 10 in / 2 out tokens\n");
  assert.equal(formatEvent("gemini", { type: "tool_use", tool_name: "read_file", parameters: { path: "a.md" } }), "⏺ read_file(a.md)\n");
  assert.equal(formatEvent("gemini", { type: "message", role: "assistant", content: "Hel", delta: true }), "Hel");
});

test("a run's terminal log reads in chunks from an offset and keeps the newest logs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-terminal-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const log = new TerminalLog(directory);
  assert.deepEqual(log.read("r1"), { text: "", offset: 0, size: 0, skipped: 0 });
  log.append("r1", "$ claude -p\n");
  const first = log.read("r1");
  assert.equal(first.text, "$ claude -p\n");
  log.append("r1", "⏺ Bash(ls)\n");
  const next = log.read("r1", first.offset);
  assert.equal(next.text, "⏺ Bash(ls)\n", "only what's new");
  // A long log opens at its tail, on a line boundary.
  log.append("big", Array.from({ length: 40000 }, (_, i) => `row ${i}`).join("\n"));
  const tail = log.read("big");
  assert.ok(tail.skipped > 0 && tail.text.startsWith("row ") && tail.text.endsWith("row 39999"));
  assert.throws(() => log.read("../escape"), /Invalid run ID/);
  for (let i = 0; i < 5; i++) log.append(`old${i}`, "x");
  log.prune(2);
  assert.equal(log.read("old0").size + log.read("old1").size + log.read("old2").size, 0);
});

test("runHarness streams the command, readable events, stderr, and the exit to the terminal", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-terminal-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cli = join(directory, "fake-claude.mjs");
  await writeFile(
    cli,
    [
      `const say = (e) => console.log(JSON.stringify(e));`,
      `say({ type: "system", subtype: "init", model: "fake-model" });`,
      `say({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "echo hi" } }] } });`,
      `say({ type: "user", message: { content: [{ type: "tool_result", content: "hi sk-abcdefghijklmnopqrstuv" }] } });`,
      `process.stderr.write("warning: slow disk\\n");`,
      `say({ type: "assistant", message: { content: [{ type: "text", text: "All good." }] } });`,
      `say({ type: "result", result: "All good.", num_turns: 1, usage: { input_tokens: 5, output_tokens: 3 } });`,
    ].join("\n"),
  );
  let terminal = "";
  const result = await runHarness(
    { harness: "claude", workspace: directory, prompt: "hello", signal: new AbortController().signal, onText: () => {}, onTerminal: (text) => (terminal += text) },
    { resolve: async () => ({ file: process.execPath, prefix: [cli] }), args: [] },
  );
  assert.equal(result, "All good.");
  assert.match(terminal, /^\$ .*fake-claude\.mjs {2}< prompt \(5 chars\)\n/);
  // stderr is its own pipe, so it can land anywhere between stdout lines.
  assert.match(terminal, /warning: slow disk\n/);
  terminal = terminal.replace("warning: slow disk\n", "");
  assert.match(terminal, /● Session started · fake-model\n⏺ Bash\(echo hi\)\n {2}⎿ hi \[redacted\]\n/);
  assert.match(terminal, /All good\.\n✔ Done · 1 turns · 5 in \/ 3 out tokens\n/);
  assert.match(terminal, /\[exit 0\]\n$/);
});

test("the Activity terminal shows a run's CLI, and stopping one chat doesn't pause the others", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-terminal-runs-"));
  const hold = [];
  const c = new Coordinator({
    directory,
    probe: async () => [],
    runner: ({ onTerminal, signal, prompt }) => {
      onTerminal?.("⏺ Bash(npm test)\n");
      if (!prompt.includes("wait")) return Promise.resolve("Done");
      return new Promise((resolve, reject) => {
        hold.push(resolve);
        signal.addEventListener("abort", () => reject(new Error("Run cancelled")));
      });
    },
  });
  t.after(async () => {
    hold.forEach((go) => go("Done"));
    await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  for (const name of ["Alex", "Morgan"]) await c.command("employees.create", { name, role: "Builder", harness: "codex", trusted: true });
  const [alex, morgan] = c.snapshot().employees;
  await c.command("conversations.create", { title: "Alex", members: [alex.id] });
  await c.command("conversations.create", { title: "Morgan", members: [morgan.id] });
  const [one, two] = c.snapshot().conversations;
  const say = (conversation, body) => c.command("messages.send", { conversation, body, requestId: crypto.randomUUID() });
  const waitFor = async (check) => {
    const deadline = Date.now() + 30000;
    while (!check(c.snapshot())) {
      if (Date.now() > deadline) throw new Error("Timed out");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  await say(one.id, "Run the tests");
  await waitFor((s) => s.runs[0]?.status === "succeeded");
  const run = c.snapshot().runs[0];
  const view = await c.command("runs.terminal", { id: run.id });
  assert.equal(view.status, "succeeded");
  assert.match(view.text, /^── Alex · Codex CLI · started .+ ──\n.+\n⏺ Bash\(npm test\)\n── finished .+ ──\n$/);
  assert.deepEqual(await c.command("runs.terminal", { id: run.id, offset: view.offset }), { text: "", offset: view.offset, size: view.size, skipped: 0, status: "succeeded" });

  // Both bots at work; stopping Alex's chat leaves Morgan running and the workspace unpaused.
  await say(one.id, "wait here");
  await say(two.id, "wait there");
  await waitFor((s) => s.runs.filter((r) => r.status === "running").length === 2);
  await c.command("runs.stopConversation", { conversation: one.id });
  await waitFor((s) => s.runs.filter((r) => r.conversation === one.id).at(-1).status === "cancelled");
  const snap = c.snapshot();
  assert.equal(snap.runtime.paused, false);
  assert.equal(snap.runs.filter((r) => r.conversation === two.id).at(-1).status, "running");
});
