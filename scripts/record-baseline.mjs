// Records docs/architecture/baseline.json: prompt and sync numbers for every
// corpus workspace, the reference each lean-runtime milestone's gate is
// measured against.
//   node scripts/record-baseline.mjs
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import packageMetadata from "../package.json" with { type: "json" };
import { SEED, SIZES } from "./corpus.mjs";
import { benchContext } from "./bench-context.mjs";
import { benchSync } from "./bench-sync.mjs";

let commit = "";
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  // Recorded outside a checkout.
}
const context = await benchContext();
const sync = await benchSync();
const baseline = {
  recorded: new Date().toISOString().slice(0, 10),
  version: packageMetadata.version,
  commit,
  corpus: { seed: SEED, sizes: SIZES },
  workspaces: Object.fromEntries(Object.keys(context).map((name) => [name, { ...context[name], sync: sync[name] }])),
};
const target = fileURLToPath(new URL("../docs/architecture/baseline.json", import.meta.url));
writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(`Wrote ${target}`);
