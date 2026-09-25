// What the renderer receives: snapshot bytes per corpus workspace, and the
// bytes of one push while a bot streams.
//   node scripts/bench-sync.mjs [--json]
// Today every push while a bot streams is a full snapshot (the worker
// throttles pushes to one per 100 ms), and the streaming run's whole output is
// written to SQLite every 150 ms.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { WORKSPACES, loadCorpus, makeCorpus } from "./corpus.mjs";

const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
// A reply at the send limit, streamed: the push carries all of it so far.
const STREAMED = "Streaming reply text. ".repeat(1100).slice(0, 24000);

export async function benchSync(names = WORKSPACES) {
  const corpus = makeCorpus();
  const results = {};
  for (const name of names) {
    const directory = mkdtempSync(join(tmpdir(), `anybot-bench-${name}-`));
    const c = new Coordinator({ directory, runner: async () => "", probe: async () => [], concurrency: 0 });
    try {
      loadCorpus(c.store, corpus[name]);
      const snapshot = c.snapshot();
      const duplicated = snapshot.runs.reduce((sum, run) => sum + Buffer.byteLength(run.output), 0);
      const last = snapshot.runs.at(-1);
      c.store.run("UPDATE runs SET status='running', output=? WHERE id=?", STREAMED, last.id);
      results[name] = {
        messages: snapshot.messages.length,
        runs: snapshot.runs.length,
        snapshotBytes: bytes(snapshot),
        // Reply text sent twice: once as the message, again as runs.output.
        duplicatedOutputBytes: duplicated,
        streamingTickBytes: bytes(c.snapshot()),
        pushIntervalMs: 100,
        outputWriteIntervalMs: 150,
      };
    } finally {
      await c.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
  return results;
}

if (process.argv[1]?.endsWith("bench-sync.mjs")) {
  const results = await benchSync();
  if (process.argv.includes("--json")) console.log(JSON.stringify(results, null, 2));
  else
    for (const [name, r] of Object.entries(results))
      console.log(
        `${name}: ${r.messages} messages, ${r.runs} runs · snapshot ${(r.snapshotBytes / 1024).toFixed(0)} KB · per streaming tick ${(r.streamingTickBytes / 1024).toFixed(0)} KB · reply text duplicated in runs.output ${(r.duplicatedOutputBytes / 1024).toFixed(0)} KB`,
      );
}
