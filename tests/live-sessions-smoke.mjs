// Live gate for lean-runtime M2 (docs/plans/lean-runtime.md §4, M2). Explicit
// opt-in: it uses the installed CLI's own login and spends real tokens.
//   node tests/live-sessions-smoke.mjs claude|codex [--runs 3] [--model id]
// A controlled 5-turn task, run with resumed sessions and in fresh mode. It
// checks the bot remembers earlier turns, and reports the median uncached
// input tokens (input − cached, from the stored usage) for turns 2–5.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";

const harness = process.argv[2];
if (!["claude", "codex"].includes(harness)) throw new Error("Usage: node tests/live-sessions-smoke.mjs claude|codex [--runs 3] [--model id]");
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const runs = Number(flag("runs", "1"));
const model = flag("model", "");

const TURNS = [
  ["Remember these facts for later turns: the project codename is TERN, the budget is 4200, and the owner is Priya. Reply with the single word: noted", /noted/i],
  ["What is the project codename? Answer with one word.", /TERN/i],
  ["Add 800 to the budget and give the new total as a number only.", /5,?000/],
  ["Who is the owner? Answer with one word.", /Priya/i],
  ["List the codename, the new budget, and the owner, separated by commas.", /TERN[\s\S]*5,?000[\s\S]*Priya/i],
];

const base = resolve(".anybot/live-tests");
await mkdir(base, { recursive: true });

async function session(resumeSessions) {
  const directory = await mkdtemp(join(base, `sessions-${harness}-`));
  const c = new Coordinator({ directory, concurrency: 1, resumable: resumeSessions ? [harness] : [] });
  try {
    await c.initialize();
    await c.command("employees.create", {
      name: "Recall",
      role: "Tester",
      instructions:
        "Do not use any tools, run commands, read files, or write anybot blocks of any kind (no memory, board, or canvas actions). Answer only from the conversation, in plain text.",
      harness,
      model,
      trusted: true,
    });
    const employee = c.snapshot().employees[0];
    await c.command("conversations.create", { title: "Live sessions smoke", members: [employee.id] });
    const conversation = c.snapshot().conversations[0].id;
    const uncached = [];
    for (const [body, expected] of TURNS) {
      await c.command("messages.send", { conversation, body, requestId: crypto.randomUUID() });
      for (let i = 0; i < 1800 && c.snapshot().runs.some((r) => ["queued", "running"].includes(r.status)); i++)
        await new Promise((r) => setTimeout(r, 100));
      const run = c.snapshot().runs.at(-1);
      assert.equal(run.status, "succeeded", run.error);
      // The bot's own reply to this run (a notice may follow it).
      const reply = c.store.one("SELECT m.body FROM run_responses rr JOIN messages m ON m.id=rr.message WHERE rr.run=?", run.id)?.body || "";
      assert.match(reply, expected, `turn "${body}" answered: ${reply}`);
      const usage = run.usage || {};
      uncached.push((usage["gen_ai.usage.input_tokens"] || 0) - (usage["gen_ai.usage.cached_input_tokens"] || 0));
    }
    const resumed = c.store.one("SELECT turns FROM harness_sessions")?.turns || 0;
    return { uncached, resumed };
  } finally {
    await c.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};
const results = { resumed: [], fresh: [] };
for (let i = 0; i < runs; i++) {
  const resumed = await session(true);
  assert.equal(resumed.resumed, TURNS.length, "every turn after the first resumed the same session");
  results.resumed.push(...resumed.uncached.slice(1));
  const fresh = await session(false);
  results.fresh.push(...fresh.uncached.slice(1));
  console.log(`run ${i + 1}: resumed ${resumed.uncached.join(", ")} · fresh ${fresh.uncached.join(", ")} (uncached input per turn)`);
}
const cut = 1 - median(results.resumed) / median(results.fresh);
console.log(
  `${harness}: median uncached input, turns 2–5: resumed ${median(results.resumed)} vs fresh ${median(results.fresh)} (${Math.round(cut * 100)}% lower). Gate: at least 50% lower.`,
);
assert.ok(cut >= 0.5, "M2 live gate not met");
console.log("PASS");
