// Writes the benchmark corpus to tests/fixtures/corpus/ and its manifest.
//   node scripts/make-corpus.mjs          write the workspaces and manifest.json
//   node scripts/make-corpus.mjs --check  fail if the generator no longer matches the manifest
// The workspace files are regenerated on demand (and gitignored); the
// manifest's digests are committed so a changed generator is a reviewed diff.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SEED, SIZES, digest, makeCorpus } from "./corpus.mjs";

const directory = fileURLToPath(new URL("../tests/fixtures/corpus/", import.meta.url));
const corpus = makeCorpus();
const manifest = {
  seed: SEED,
  sizes: SIZES,
  workspaces: Object.fromEntries(
    Object.entries(corpus).map(([name, workspace]) => [
      name,
      { messages: workspace.messages.length, runs: workspace.runs.length, sha256: digest(workspace) },
    ]),
  ),
};

if (process.argv.includes("--check")) {
  const committed = JSON.parse(readFileSync(`${directory}manifest.json`, "utf8"));
  if (JSON.stringify(committed) !== JSON.stringify(manifest)) {
    console.error("The corpus generator no longer matches tests/fixtures/corpus/manifest.json.");
    console.error("If the change is intended, run node scripts/make-corpus.mjs and commit the manifest.");
    process.exit(1);
  }
  console.log("Corpus matches its manifest.");
} else {
  mkdirSync(directory, { recursive: true });
  for (const [name, workspace] of Object.entries(corpus))
    writeFileSync(`${directory}${name}.json`, `${JSON.stringify(workspace)}\n`);
  writeFileSync(`${directory}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [name, entry] of Object.entries(manifest.workspaces))
    console.log(`${name}: ${entry.messages} messages, ${entry.runs} runs`);
}
