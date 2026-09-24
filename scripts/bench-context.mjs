// Prompt sizes, per section, for every run in the benchmark corpus.
//   node scripts/bench-context.mjs [--json] [--workspace project2]
// Each run's prompt is rebuilt by the coordinator exactly as it would be sent
// today (every run is a fresh session, so every run is a "first turn").
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { WORKSPACES, loadCorpus, makeCorpus } from "./corpus.mjs";

const quantile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : 0);
export function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    runs: sorted.length,
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted.at(-1) || 0,
    mean: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
  };
}

export async function benchContext(names = WORKSPACES) {
  const corpus = makeCorpus();
  const results = {};
  for (const name of names) {
    const directory = mkdtempSync(join(tmpdir(), `anybot-bench-${name}-`));
    const c = new Coordinator({ directory, runner: async () => "", probe: async () => [], concurrency: 0 });
    try {
      loadCorpus(c.store, corpus[name]);
      const totals = [];
      const sections = {};
      for (const run of c.store.all("SELECT * FROM runs ORDER BY rowid")) {
        const employee = c.store.one("SELECT * FROM employees WHERE id=?", run.employee);
        const parts = c.promptParts(run, employee, []);
        totals.push(parts.text.length);
        for (const [section, size] of Object.entries(parts.sections)) (sections[section] ||= []).push(size);
      }
      results[name] = {
        prompt: stats(totals),
        sections: Object.fromEntries(Object.entries(sections).map(([section, sizes]) => [section, { median: stats(sizes).median, max: stats(sizes).max }])),
      };
    } finally {
      await c.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
  return results;
}

if (process.argv[1]?.endsWith("bench-context.mjs")) {
  const only = process.argv.indexOf("--workspace");
  const results = await benchContext(only > 0 ? [process.argv[only + 1]] : WORKSPACES);
  if (process.argv.includes("--json")) console.log(JSON.stringify(results, null, 2));
  else
    for (const [name, result] of Object.entries(results)) {
      const p = result.prompt;
      console.log(`${name}: ${p.runs} runs · prompt chars median ${p.median} · p95 ${p.p95} · max ${p.max}`);
      for (const [section, s] of Object.entries(result.sections)) console.log(`  ${section.padEnd(12)} median ${String(s.median).padStart(6)} · max ${s.max}`);
    }
}
