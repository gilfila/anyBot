import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, "release");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid package version: ${version}`);
}
const files = [
  `anyBot Setup ${version}.exe`,
  `anyBot ${version}.exe`,
  "anyBot-mobile-debug.apk",
];
const rows = [];
for (const name of files) {
  try {
    await access(path.join(release, name));
  } catch {
    console.warn(`Skipping missing release artifact: ${name}`);
    continue;
  }
  const bytes = await readFile(path.join(release, name));
  const hash = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  rows.push(`${hash}  ${name}  ${bytes.length} bytes`);
}
if (!rows.length) throw new Error("No release artifacts are available for a checksum manifest.");
await writeFile(path.join(release, "SHA256SUMS.txt"), `${rows.join("\n")}\n`);
console.log(rows.join("\n"));
