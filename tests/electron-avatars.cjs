// The 3D bots recover after their WebGL context is lost or a frame fails.
// Before 0.3.25 either one left every bot as a flat icon until restart.
// Renders the built app (dist/) in a sandboxed window with the same GPU
// switches as desktop/main.cjs and a fake bridge fed by a real snapshot.
//   npm run test:avatars
const { app, BrowserWindow } = require("electron");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { existsSync, mkdirSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");

if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("in-process-gpu");
}
const profileRoot = path.join(__dirname, "../.anybot/test-profiles");
mkdirSync(profileRoot, { recursive: true });
app.setPath("userData", mkdtempSync(path.join(profileRoot, "electron-")));

const dist = path.join(__dirname, "../dist");
const page = path.join(dist, "avatar-test.html");
const script = path.join(dist, "avatar-test.js");
let directory;

// Runs before the app bundle: keeps every WebGL context the page creates, and
// answers the bridge with a fixed snapshot while recording diagnostics.
const bridge = (snapshot) => `
window.__gl = [];
window.__reports = [];
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
  const context = getContext.call(this, type, ...rest);
  if (context && /webgl/.test(type)) window.__gl.push(context);
  return context;
};
const snapshot = ${JSON.stringify(snapshot)};
window.anybot = {
  request: async (method, payload) => {
    if (method === "diagnostics.report") window.__reports.push(payload);
    return method === "harnesses.models" ? [] : snapshot;
  },
  chooseDirectory: async () => null,
  onChanged: () => () => {},
  listDirectory: async () => [],
  revealPath: async () => {},
  runCommand: async () => ({ code: 0 }),
  openUrl: async () => {},
  update: { check: async () => snapshot, download: async () => snapshot, install: async () => snapshot, dismiss: async () => snapshot, retry: async () => snapshot },
};
`;

async function finish(code) {
  await rm(page, { force: true });
  await rm(script, { force: true });
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(code);
}

app
  .whenReady()
  .then(async () => {
    assert.ok(existsSync(path.join(dist, "index.html")), "dist/ is missing: run npm run build first");
    directory = await mkdtemp(path.join(tmpdir(), "anybot-avatars-"));
    const { Coordinator } = await import(pathToFileURL(path.join(__dirname, "../runtime/coordinator.mjs")).href);
    const c = new Coordinator({ directory, runner: async () => "Done", probe: async () => [] });
    await c.command("employees.create", { name: "Scout", role: "Engineer", harness: "claude", trusted: true });
    await c.command("employees.create", { name: "Orbit", role: "Researcher", harness: "codex", trusted: true });
    const snapshot = JSON.parse(JSON.stringify(c.snapshot()));
    await c.close();
    await writeFile(script, bridge(snapshot));
    const html = await readFile(path.join(dist, "index.html"), "utf8");
    await writeFile(page, html.replace("<script", '<script src="./avatar-test.js"></script><script'));

    const win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadFile(page);
    const renderers = () =>
      win.webContents.executeJavaScript(`[...document.querySelectorAll(".robot-avatar")].map((a) => a.dataset.renderer)`);
    async function allIn3d(label) {
      for (let i = 0; i < 200; i++) {
        const states = await renderers();
        if (states.length >= 2 && states.every((s) => s === "3d")) return states;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`${label}: the bots stayed ${JSON.stringify(await renderers())}`);
    }
    // The failure has to show (icons) before recovery means anything.
    async function droppedToIcons(label) {
      for (let i = 0; i < 100; i++) {
        if ((await renderers()).includes("fallback")) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`${label}: the bots never showed the failure`);
    }

    await allIn3d("first render");

    // A context the browser never restores (sleep, display or driver reset).
    await win.webContents.executeJavaScript(`window.__gl.at(-1).getExtension("WEBGL_lose_context").loseContext()`);
    await droppedToIcons("lost context");
    await allIn3d("after a lost context");
    const reports = await win.webContents.executeJavaScript("window.__reports");
    assert.ok(
      reports.some((r) => r.code === "avatar.render_failed" && r.context?.reason === "context-lost"),
      `the loss is recorded: ${JSON.stringify(reports)}`,
    );

    // One frame that throws.
    await win.webContents.executeJavaScript(`(() => {
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function () {
        CanvasRenderingContext2D.prototype.drawImage = draw;
        throw new Error("synthetic draw failure");
      };
      dispatchEvent(new Event("resize"));
    })()`);
    await droppedToIcons("failed frame");
    await allIn3d("after a failed frame");

    console.log("electron avatars: 3D bots recover from a lost context and a failed frame");
    await finish(0);
  })
  .catch(async (error) => {
    console.error(error);
    await finish(1);
  });
