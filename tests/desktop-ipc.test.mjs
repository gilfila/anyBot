import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

// The renderer can only reach coordinator commands that desktop/main.cjs
// allowlists or handles explicitly. A missing entry fails silently in the UI
// with "Operation not allowed" (runs.dismiss shipped that way in 0.2.21).
test("every coordinator method the desktop renderer calls is reachable over IPC", async () => {
  const main = await read("desktop/main.cjs");
  const allowlist = main.match(/const methods = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(allowlist, "methods allowlist not found in desktop/main.cjs");
  const allowed = new Set([...allowlist[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const handled = new Set([...main.matchAll(/method === "([^"]+)"/g)].map((m) => m[1]));

  // Every renderer module: act("x"), request("x"), and window.anybot.request("x").
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(path.join(root, "src"), { recursive: true }))
    .filter((file) => /\.(jsx?|mjs)$/.test(file))
    .map((file) => path.join("src", file));
  assert.ok(files.length > 10, "found renderer sources");
  const sources = await Promise.all(files.map(read));
  const called = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/\b(?:act|request|call)\(\s*"([a-z]+\.[A-Za-z.]+)"/g)) called.add(match[1]);
    for (const match of source.matchAll(/act\(\s*[^,)]*\?\s*"([a-z]+\.[A-Za-z]+)"\s*:\s*"([a-z]+\.[A-Za-z]+)"/g)) {
      called.add(match[1]);
      called.add(match[2]);
    }
  }
  assert.ok(called.has("runs.dismiss"), "expected the renderer to call runs.dismiss");
  const unreachable = [...called].filter((method) => !allowed.has(method) && !handled.has(method));
  assert.deepEqual(unreachable, []);
});

test("coordinator implements every allowlisted desktop method", async () => {
  const [main, coordinator] = await Promise.all([read("desktop/main.cjs"), read("runtime/coordinator.mjs")]);
  const allowlist = main.match(/const methods = new Set\(\[([\s\S]*?)\]\)/);
  const allowed = [...allowlist[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  // artifacts.reveal is resolved in the main process via artifacts.resolve.
  const missing = allowed
    .filter((method) => method !== "artifacts.reveal")
    .filter((method) => !coordinator.includes(`case "${method}":`));
  assert.deepEqual(missing, []);
});

// File links come from bot output. Their code only talks to main through
// files.* requests, which re-check every path (desktop/file-access.cjs).
test("file-link code never reaches the shell, folder, or URL bridges", async () => {
  const files = [
    "src/lib/file-refs.js",
    "src/lib/markdown.js",
    "src/components/MessageContent.jsx",
    "src/components/FileLinks.jsx",
    "src/components/FilePreview.jsx",
    "src/components/RunTerminal.jsx",
  ];
  for (const file of files) {
    const source = await read(file);
    for (const bridge of ["revealPath", "listDirectory", "runCommand", "openUrl", "openExternal"])
      assert.ok(!source.includes(bridge), `${file} mentions ${bridge}`);
  }
});

test("shell.openPath only opens the app's own folders or a file link main has just inspected", async () => {
  const main = await read("desktop/main.cjs");
  const opened = [...main.matchAll(/shell\.openPath\(([^;]*)\);/g)].map((m) => m[1].trim()).sort();
  assert.deepEqual(opened, ['app.getPath("userData")', "diagnostics.directory", "ref.path"]);
  const branch = main.match(/if \(method === "files\.open"\) \{[\s\S]*?return \{ opened: true \};/)?.[0] || "";
  assert.match(branch, /const ref = await fileTarget\(payload, "open"\);[\s\S]*shell\.openPath\(ref\.path\)/);
  const shown = [...main.matchAll(/shell\.showItemInFolder\(([^;]*)\);/g)].map((m) => m[1].trim()).sort();
  assert.deepEqual(shown, ["file", "fileAccess.ownerPath(filePath)", "ref.path"]);
});

test("files.context is main-only", async () => {
  const main = await read("desktop/main.cjs");
  const allowlist = main.match(/const methods = new Set\(\[([\s\S]*?)\]\)/)[1];
  assert.ok(!allowlist.includes('"files.'), "no files.* method is allowlisted");
  assert.ok(!main.includes('method === "files.context"'), "the renderer can't reach files.context");
  assert.match(main, /request\("files\.context", \{ message \}\)/);
});

test("HTML previews never combine allow-scripts with allow-same-origin on local content", async () => {
  for (const file of ["src/components/HtmlPreviewModal.jsx", "src/components/ContextRail.jsx"]) {
    const source = await read(file);
    for (const match of source.matchAll(/<iframe[\s\S]*?\/>/g)) {
      const frame = match[0];
      if (!/sandbox="[^"]*allow-same-origin/.test(frame)) continue;
      assert.ok(
        !/srcDoc=/.test(frame) && !/blob:/.test(frame),
        `${file}: a same-origin iframe must only load remote http(s) pages`,
      );
    }
  }
});
