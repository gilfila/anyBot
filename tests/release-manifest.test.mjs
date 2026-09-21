import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("release checksum manifest matches packaged Windows binaries", async (t) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let manifest;
  try {
    manifest = await readFile(path.join(root, "release", "SHA256SUMS.txt"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return t.skip("release binaries are not built in this checkout");
    throw error;
  }
  for (const line of manifest.trim().split(/\r?\n/)) {
    const match = line.match(/^([A-F0-9]{64})  (.+)  (\d+) bytes$/);
    assert.ok(match, `invalid release manifest line: ${line}`);
    const bytes = await readFile(path.join(root, "release", match[2]));
    assert.equal(bytes.length, Number(match[3]), match[2]);
    assert.equal(createHash("sha256").update(bytes).digest("hex").toUpperCase(), match[1], match[2]);
  }
});
