import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 0.2.25 bundled @capacitor/android build output at ~258-char install paths.
// The next update's rollback move pushed them past MAX_PATH and every
// update from 0.2.25 failed with NSIS exit code 2.
test("desktop package excludes mobile-only @capacitor modules", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.ok(pkg.build.files.includes("!**/node_modules/@capacitor/**"));
  const desktopSources = ["desktop/main.cjs", "desktop/preload.cjs", "runtime/worker.mjs", "runtime/coordinator.mjs"];
  for (const file of desktopSources) {
    const source = await readFile(path.join(root, file), "utf8");
    assert.ok(!source.includes("@capacitor"), `${file} must not load @capacitor`);
  }
});

test("NSIS installer clears 0.2.25 long-path leftovers before the old uninstaller runs", async () => {
  const hook = await readFile(path.join(root, "build", "installer.nsh"), "utf8");
  assert.match(hook, /!macro customInit/);
  assert.match(hook, /RMDir \/r "\$INSTDIR\\resources\\app\.asar\.unpacked\\node_modules\\@capacitor"/);
});
