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
  assert.deepEqual(opened, ['app.getPath("userData")', "diagnostics.directory", "target"]);
  const branch = main.match(/if \(method === "files\.open"\) \{[\s\S]*?return \{ opened: true \};/)?.[0] || "";
  assert.match(branch, /const ref = await fileTarget\(payload, "open"\);[\s\S]*const target = ref\.state === "folder"[^;]*ref\.path[^;]*;[\s\S]*shell\.openPath\(target\)/);
  const shown = [...main.matchAll(/shell\.showItemInFolder\(([^;]*)\);/g)].map((m) => m[1].trim()).sort();
  assert.deepEqual(shown, ["file", "fileAccess.ownerPath(filePath)", "ref.path"]);
});

// Bot HTML in chat can request file://host (SMB) through CSS or SVG, which
// the page CSP allows on a file: page; main cancels it for every frame.
test("main cancels file: requests outside the app before the window opens", async () => {
  const main = await read("desktop/main.cjs");
  assert.match(main, /session\.defaultSession\.webRequest\.onBeforeRequest\(\(details, callback\) => \{\s*const blocked = fileRequestBlocked\(details\.url, root\);\s*callback\(\{ cancel: blocked \}\);/);
  assert.match(main, /guardFileRequests\(\);[\s\S]*showWindow\(\);/);
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

// Voice (V1): speech-to-text and API keys live in main (desktop/voice.cjs),
// reached through explicit voice.* branches before the allowlist, like
// slack.*; the coordinator never sees them. The renderer follows its own
// messages with messages.follow, which is allowlisted.
test("voice.* is handled in main before the allowlist, and messages.follow reaches the coordinator", async () => {
  const main = await read("desktop/main.cjs");
  const allowlist = main.match(/const methods = new Set\(\[([\s\S]*?)\]\)/)[1];
  assert.ok(allowlist.includes('"messages.follow"'), "messages.follow is allowlisted");
  assert.ok(!allowlist.includes('"voice.'), "no voice.* method goes to the coordinator");
  const route = main.indexOf('if (method.startsWith("voice.")) return voiceRequest(method, payload || {});');
  assert.ok(route > 0, "voice.* is routed to voiceRequest");
  assert.ok(route < main.indexOf('if (!methods.has(method)) throw new Error("Operation not allowed");'), "before the allowlist check");
  for (const method of ["voice.status", "voice.start", "voice.setProvider", "voice.setKey", "voice.set", "voice.download", "voice.cancelDownload", "voice.remove", "voice.transcribe"])
    assert.ok(main.includes(`method === "${method}"`), `${method} has its own branch`);
  // The media permission handlers are set before the window opens.
  assert.match(main, /session\.defaultSession\.setPermissionRequestHandler\(/);
  assert.match(main, /session\.defaultSession\.setPermissionCheckHandler\(/);
  assert.match(main, /guardMedia\(\);[\s\S]*showWindow\(\);/);
  const coordinator = await read("runtime/coordinator.mjs");
  assert.ok(coordinator.includes('case "messages.follow":'));
  assert.ok(!coordinator.includes('case "voice.'), "the coordinator has no voice commands");
});

// main.cjs's own voiceRequest, run with a stand-in for createVoice (main.cjs
// can't load without Electron): each voice.* method reaches the matching
// call with the payload fields main passes on, and ANYBOT_FAKE_STT works
// only in a copy run from source.
test("main's voiceRequest hands each voice.* method its own payload fields, and fake speech-to-text never runs packaged", async () => {
  const main = (await read("desktop/main.cjs")).replace(/\r\n/g, "\n");
  const from = main.indexOf("function voiceRequest(method, payload) {");
  assert.ok(from > 0, "voiceRequest not found");
  const body = main.slice(from, main.indexOf("\n}\n", from) + 2);
  const load = ({ packaged, env = {} }) => {
    const made = [];
    const calls = [];
    const names = ["status", "start", "setProvider", "setKey", "set", "download", "cancelDownload", "remove", "transcribe"];
    const createVoice = (options) => {
      made.push(options);
      return Object.fromEntries(names.map((name) => [name, (...args) => calls.push([name, ...args])]));
    };
    const app = { isPackaged: packaged, getPath: () => "C:/userData" };
    const make = new Function(
      "createVoice",
      "app",
      "protectSecret",
      "unprotectSecret",
      "diagnostics",
      "notifyRenderer",
      "process",
      `let voice = null;\n${body}\nreturn voiceRequest;`,
    );
    return { voiceRequest: make(createVoice, app, (t) => t, (t) => t, null, () => {}, { env }), made, calls };
  };
  const { voiceRequest, made, calls } = load({ packaged: true, env: { ANYBOT_FAKE_STT: "hello" } });
  const wav = new Uint8Array([1, 2, 3]);
  voiceRequest("voice.status", { extra: 1 });
  voiceRequest("voice.start", {});
  voiceRequest("voice.setProvider", { provider: "groq", key: "no" });
  voiceRequest("voice.setKey", { provider: "openai", key: "sk-test", other: true });
  voiceRequest("voice.set", { voice: "Zira", pushToTalk: true });
  voiceRequest("voice.download", { model: "small.en", url: "https://elsewhere.example" });
  voiceRequest("voice.cancelDownload", {});
  voiceRequest("voice.remove", {});
  voiceRequest("voice.transcribe", { wav, provider: "groq" });
  assert.throws(() => voiceRequest("voice.runAnything", {}), /Operation not allowed/);
  assert.equal(made.length, 1, "one voice service for the app");
  assert.equal(made[0].dir, "C:/userData");
  assert.equal(made[0].fakeStt, null, "no fake speech-to-text in a packaged app");
  assert.deepEqual(calls, [
    ["status"],
    ["start"],
    ["setProvider", "groq"],
    ["setKey", { provider: "openai", key: "sk-test" }],
    ["set", { voice: "Zira", pushToTalk: true }],
    ["download", { model: "small.en" }],
    ["cancelDownload"],
    ["remove"],
    ["transcribe", { wav }],
  ]);
  const source = load({ packaged: false, env: { ANYBOT_FAKE_STT: "hello" } });
  source.voiceRequest("voice.status", {});
  assert.equal(source.made[0].fakeStt, "hello", "the e2e's fake speech-to-text, from source only");
  const plain = load({ packaged: false });
  plain.voiceRequest("voice.status", {});
  assert.equal(plain.made[0].fakeStt, null);
});

// Closing the window to the tray or minimizing it ends a voice chat: main
// hooks the window (window-shell.cjs stopVoiceWhenHidden) and the preload
// passes the message on as onVoiceStop.
test("a hidden or minimized window stops voice through main and the preload", async () => {
  const main = await read("desktop/main.cjs");
  assert.match(main, /stopVoiceWhenHidden\(window\);[\s\S]*?window\.loadURL\(page\);/, "createWindow hooks the window before loading the page");
  const preload = await read("desktop/preload.cjs");
  assert.match(preload, /onVoiceStop: \(callback\) => \{[\s\S]*?ipcRenderer\.on\("anybot:voice-stop", listener\);[\s\S]*?removeListener\("anybot:voice-stop", listener\)/);
  const hook = await read("src/lib/useVoice.js");
  assert.match(hook, /window\.anybot\?\.onVoiceStop\?\.\(stop\)/);
  assert.match(hook, /addEventListener\("visibilitychange"/);
});
