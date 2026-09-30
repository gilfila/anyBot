// End-to-end thread collaboration on the real Electron utility process, with
// a fake harness (harnesses.json) instead of a provider CLI:
//   the owner asks Alex in a project → Alex @mentions Morgan → Morgan works in
//   the same thread and its (lean) prompt carries the thread and the mention.
// Then desktop voice (V1), in the built renderer (dist/) with Chromium's fake
// microphone playing a WAV on a loop and ANYBOT_FAKE_STT for the text:
//   one spoken turn (with a pause inside it) is one recording and one
//   message; the reply of a run that outlasts the old 24 s wait is spoken
//   without markdown; the mic is shut while the bot works and while it talks,
//   so nothing is sent again meanwhile. Esc in a text field leaves the voice
//   chat running; Esc ends it; closing the window to the tray ends it too.
//   npm run test:e2e
const { app, BrowserWindow, ipcMain, session, utilityProcess } = require("electron");
const { mkdtemp, rm, writeFile, readFile } = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { existsSync, mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const { createVoice, parseWav } = require("../desktop/voice.cjs");
const { permissionAllowed, stopVoiceWhenHidden } = require("../desktop/window-shell.cjs");
const profileRoot = path.join(__dirname, "../.anybot/test-profiles");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("in-process-gpu");
mkdirSync(profileRoot, { recursive: true });
const userData = mkdtempSync(path.join(profileRoot, "electron-"));
app.setPath("userData", userData);
app.disableHardwareAcceleration();

// The fake microphone: 0.5 s quiet, 1 s of voice-like sound, a 0.8 s pause,
// 1 s more, 2 s quiet, played on a loop (48 kHz mono WAV).
function speechWav() {
  const rate = 48000;
  const parts = [[0.5, false], [1, true], [0.8, false], [1, true], [2, false]];
  const samples = [];
  for (const [seconds, voiced] of parts)
    for (let i = 0; i < seconds * rate; i++) {
      const t = i / rate;
      const pitch = 150 + 40 * Math.sin(2 * Math.PI * 1.5 * t);
      samples.push(voiced ? (0.3 * Math.sin(2 * Math.PI * pitch * t) + 0.12 * Math.sin(4 * Math.PI * pitch * t)) * (0.65 + 0.35 * Math.sin(2 * Math.PI * 4 * t)) : 0);
    }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
const micFile = path.join(userData, "speech.wav");
writeFileSync(micFile, speechWav());
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-file-for-fake-audio-capture", micFile);
const SPOKEN_TURN = "Plan the launch for Friday";
process.env.ANYBOT_FAKE_STT = SPOKEN_TURN;
// Longer than the 24 s the old voice chat waited for a reply.
const VOX_RUN_MS = 26_000;

// The fake CLI: reads the prompt on stdin, keeps a copy per bot, and replies
// as that bot. Alex hands off to Morgan with an @mention; Vox takes a while.
const FAKE = `
let prompt = "";
process.stdin.on("data", (c) => (prompt += c));
process.stdin.on("end", () => {
  const name = /You are working in Any Bot as ([^.]+)\\./.exec(prompt)?.[1] || "unknown";
  require("node:fs").appendFileSync(require("node:path").join(__dirname, name + ".prompts"), prompt + "\\n=====\\n");
  if (name === "Vox")
    return setTimeout(() => process.stdout.write("**All set.** The launch plan is in C:\\\\work\\\\launch\\\\plan.md. See https://example.com/plan for more."), ${VOX_RUN_MS});
  process.stdout.write(name === "Alex" ? "Plan is ready. @Morgan please build the page from it." : "Built the page from Alex's plan.");
});
`;

function nodeExecutable() {
  if (process.env.npm_node_execpath) return process.env.npm_node_execpath;
  const finder = process.platform === "win32" ? "where" : "which";
  return execFileSync(finder, ["node"], { encoding: "utf8" }).split(/\r?\n/)[0].trim();
}

let child, directory, win;
const calls = new Map();
let nextId = 0;
function request(method, payload = {}) {
  const id = String(++nextId);
  return new Promise((resolve, reject) => {
    calls.set(id, { resolve, reject });
    child.postMessage({ id, method, payload });
  });
}
async function finish(code) {
  win?.destroy();
  child?.kill();
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(code);
}
async function until(check, label, tries = 300, every = 100) {
  for (let i = 0; i < tries; i++) {
    const snapshot = await request("snapshot");
    if (check(snapshot)) return snapshot;
    await new Promise((r) => setTimeout(r, every));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The window's bridge, like desktop/preload.cjs, over one test channel.
const PRELOAD = `
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("anybot", {
  request: (method, payload) => ipcRenderer.invoke("test:request", method, payload),
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("anybot:changed", listener);
    return () => ipcRenderer.removeListener("anybot:changed", listener);
  },
  onNavigate: (callback) => {
    const listener = (_event, target) => callback(target);
    ipcRenderer.on("anybot:navigate", listener);
    return () => ipcRenderer.removeListener("anybot:navigate", listener);
  },
  onVoiceStop: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("anybot:voice-stop", listener);
    return () => ipcRenderer.removeListener("anybot:voice-stop", listener);
  },
  chooseDirectory: async () => null,
  chooseAttachments: async () => [],
  getPathForFile: () => "",
  listDirectory: async () => [],
  revealPath: async () => {},
  runCommand: async () => ({ code: 0 }),
  stopCommand: async () => ({}),
  openUrl: async () => {},
  update: { check: async () => ({}), download: async () => ({}), install: async () => ({}), cancelInstall: async () => ({}), dismiss: async () => ({}), retry: async () => ({}) },
});
`;

// Voice (V1) in the built renderer against the real coordinator.
async function voiceChat() {
  const dist = path.join(__dirname, "../dist/index.html");
  assert.ok(existsSync(dist), "dist/ is missing: run npm run build first");
  const page = pathToFileURL(dist).href;
  // main.cjs's microphone rule: the app's page may record audio.
  session.defaultSession.setPermissionRequestHandler((_c, permission, callback, details) => callback(permissionAllowed(permission, details, page)));
  session.defaultSession.setPermissionCheckHandler((_c, permission, _o, details) => permissionAllowed(permission, details, page));
  // main.cjs's voice.* routing, with its ANYBOT_FAKE_STT rule.
  const recordings = [];
  const voice = createVoice({ dir: userData, fakeStt: process.env.ANYBOT_FAKE_STT });
  ipcMain.handle("test:request", async (_event, method, payload = {}) => {
    if (method === "voice.start") return voice.start();
    if (method === "voice.status") return voice.status();
    if (method === "voice.transcribe") {
      recordings.push(parseWav(payload.wav));
      return voice.transcribe({ wav: payload.wav });
    }
    // Main's own file links: the reply names a file that isn't there.
    if (method === "files.check") return { results: {} };
    return request(method, payload);
  });
  await request("employees.create", { name: "Vox", role: "Chief of staff", harness: "fake", trusted: true });
  const vox = (await request("snapshot")).employees.find((e) => e.name === "Vox");
  await request("conversations.create", { title: "Vox", members: [vox.id] });
  const chat = (await request("snapshot")).conversations.find((c) => c.title === "Vox");
  const humans = (snapshot) => snapshot.messages.filter((m) => m.conversation === chat.id && m.author === "human");

  win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: { preload: path.join(directory, "preload.cjs"), sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  // main.cjs's rule: hiding or minimizing the window ends voice.
  stopVoiceWhenHidden(win);
  await win.loadFile(dist);
  const js = (code) => win.webContents.executeJavaScript(code);
  // Speech is recorded, not played: each sentence "takes" 2.5 s, longer in
  // all than one loop of the fake microphone. Streams are kept to check the
  // mic is shut while the bot works and talks.
  await js(`(() => {
    window.__spoken = [];
    window.__talking = 0;
    speechSynthesis.speak = (u) => {
      window.__spoken.push(u.text);
      window.__talking++;
      setTimeout(() => { window.__talking--; u.dispatchEvent(new Event("end")); }, 2500);
    };
    speechSynthesis.cancel = () => {};
    window.__streams = [];
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { const s = await getUserMedia(c); window.__streams.push(s); return s; };
    window.__micOpen = () => window.__streams.some((s) => s.getTracks().some((t) => t.readyState === "live"));
  })()`);
  const onPage = async (code, label, tries = 200) => {
    for (let i = 0; i < tries; i++) {
      const value = await js(code);
      if (value) return value;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  // Open Vox's chat and press Voice chat.
  for (let i = 0; i < 50 && !(await js(`Boolean(document.querySelector('button[aria-label="Voice chat"]'))`)); i++) {
    win.webContents.send("anybot:navigate", { conversation: chat.id });
    await sleep(200);
  }
  await js(`document.querySelector('button[aria-label="Voice chat"]').click()`);

  // One turn → one recording of the whole turn → one message.
  const sent = await until((s) => humans(s).length >= 1, "the spoken turn to be sent", 200);
  assert.deepEqual(humans(sent).map((m) => m.body), [SPOKEN_TURN]);
  assert.equal(recordings.length, 1);
  assert.ok(recordings[0].sampleRate === 16000 && recordings[0].channels === 1);
  assert.ok(recordings[0].seconds > 2.6 && recordings[0].seconds < 4, `the pause stayed inside the turn (${recordings[0].seconds.toFixed(2)} s)`);

  // Working: the mic is shut, the bar says so, and nothing more is sent.
  await onPage(`/Vox is working/.test(document.querySelector(".voice-bar-label")?.textContent || "")`, "the working label");
  await sleep(12_000);
  assert.equal(await js("window.__micOpen()"), false, "the mic is shut while Vox works");
  assert.equal(humans(await request("snapshot")).length, 1);

  // The reply, after the long run, spoken without markdown, paths or links.
  await onPage("window.__spoken.length >= 1", "the reply to be spoken", 400);
  assert.equal(await js("window.__micOpen()"), false, "the mic is shut while Vox talks");
  await onPage("window.__spoken.length === 3 && window.__talking === 0", "the reply to finish", 150);
  assert.deepEqual(await js("window.__spoken"), ["All set.", "The launch plan is in plan.md.", "See the link for more."]);
  assert.equal(humans(await request("snapshot")).length, 1, "nothing was sent again while Vox talked");
  // Then the mic opens again for the next turn. Esc typed in the message box
  // belongs to the box; a plain Esc ends the voice chat.
  await onPage("window.__micOpen()", "the mic to open again", 50);
  await js(`document.querySelector("textarea").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await sleep(300);
  assert.equal(await js(`Boolean(document.querySelector(".voice-bar")) && window.__micOpen()`), true, "Esc in a text field leaves the voice chat on");
  await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
  await onPage(`!document.querySelector(".voice-bar") && !window.__micOpen()`, "Esc to end the voice chat", 50);
  await sleep(1000);
  assert.equal(humans(await request("snapshot")).length, 1);
  // Closing the window to the tray (main hides it) ends a voice chat too.
  await js(`document.querySelector('button[aria-label="Voice chat"]').click()`);
  await onPage("window.__micOpen()", "the mic to open for a new voice chat", 50);
  win.emit("hide");
  await onPage(`!document.querySelector(".voice-bar") && !window.__micOpen()`, "hiding the window to end the voice chat", 50);
  await sleep(3000);
  assert.equal(humans(await request("snapshot")).length, 1, "nothing was sent after the window was hidden");
  const vox_run = (await request("snapshot")).runs.find((r) => r.employee === vox.id);
  const took = Date.parse(vox_run.ended) - Date.parse(vox_run.started);
  assert.ok(took >= VOX_RUN_MS - 1000, `the run really took longer than the old 24 s wait (${took} ms)`);
}

app
  .whenReady()
  .then(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "anybot-e2e-threads-"));
    const script = path.join(directory, "fake-cli.cjs");
    await writeFile(script, FAKE);
    await writeFile(path.join(directory, "preload.cjs"), PRELOAD);
    await writeFile(
      path.join(directory, "harnesses.json"),
      JSON.stringify({
        version: 1,
        adapters: [{ id: "fake", name: "Fake CLI", trusted: true, executable: nodeExecutable(), args: [script], output: "text" }],
      }),
    );
    child = utilityProcess.fork(path.join(__dirname, "../runtime/worker.mjs"), [directory], {
      serviceName: "anyBot thread e2e",
      stdio: "pipe",
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    const timeout = setTimeout(() => {
      console.error("Thread and voice e2e timed out");
      void finish(1);
    }, 150_000);
    const ready = new Promise((resolve, reject) => {
      child.on("exit", (code) => code !== 0 && reject(new Error(`Runtime exited: ${code}`)));
      child.on("message", (message) => {
        if (message.type === "ready") return resolve();
        if (message.type === "changed") return win && !win.isDestroyed() && win.webContents.send("anybot:changed");
        const call = calls.get(message.id);
        if (!call) return;
        calls.delete(message.id);
        message.error ? call.reject(new Error(message.error)) : call.resolve(message.result);
      });
    });
    try {
      await ready;
      for (const [name, role] of [["Alex", "Planner"], ["Morgan", "Builder"]])
        await request("employees.create", { name, role, harness: "fake", trusted: true });
      const bots = (await request("snapshot")).employees;
      await request("conversations.create", { title: "Launch", members: bots.map((b) => b.id) });
      const room = (await request("snapshot")).conversations[0];
      await request("messages.send", { conversation: room.id, body: "@Alex plan the launch", requestId: "e2e-1" });
      const done = await until(
        (s) => s.runs.length === 2 && s.runs.every((r) => r.status === "succeeded"),
        "Alex and Morgan to finish",
      );
      const byName = (id) => bots.find((b) => b.id === id).name;
      assert.deepEqual(done.runs.map((r) => byName(r.employee)).sort(), ["Alex", "Morgan"]);
      assert.equal(new Set(done.runs.map((r) => r.thread)).size, 1, "both bots work in one thread");
      const thread = done.runs[0].thread;
      const inThread = done.messages.filter((m) => m.thread === thread).map((m) => m.body);
      assert.ok(inThread.includes("Built the page from Alex's plan."), "Morgan replied in the thread");
      const morgan = await readFile(path.join(directory, "Morgan.prompts"), "utf8");
      assert.match(morgan, /The thread you are replying in:\nHuman: @Alex plan the launch/);
      assert.match(morgan, /Your current assignment:\nAlex mentioned you: Plan is ready\. @Morgan please build the page from it\./);
      assert.match(morgan, /To bring a teammate in, write @Name/);
      console.log("PASS: project thread collaboration end to end (Electron utility process, fake harness, @mention hand-off)");

      await voiceChat();
      console.log("PASS: desktop voice chat end to end (one turn, one message, the long reply spoken, mic shut while the bot works and talks, Esc and closing to the tray end it)");

      win.destroy();
      win = null;
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.postMessage({ type: "shutdown" });
      await stopped;
      clearTimeout(timeout);
      await finish(0);
    } catch (error) {
      clearTimeout(timeout);
      console.error(error);
      await finish(1);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
