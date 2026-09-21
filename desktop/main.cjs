const {
  app,
  BrowserWindow,
  ipcMain,
  utilityProcess,
  dialog,
  Tray,
  Menu,
  nativeImage,
  shell,
} = require("electron");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
let window,
  worker,
  tray,
  quitting = false,
  ready = false,
  restarts = 0,
  launchAtLogin = false,
  keepRunningInTray = true,
  userDataFallback = false;
const pending = new Map();
const readyWaiters = new Set();
let mobileGateway, mobileUrl, mobileError;
const page = pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
const startupPath = () => path.join(app.getPath("userData"), "startup.json");
function startupLogPath() {
  try {
    return path.join(app.getPath("userData"), "startup.log");
  } catch {
    return path.join(app.getPath("temp"), "anyBot-startup.log");
  }
}
function logStartupFailure(label, error) {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  const line = `[${new Date().toISOString()}] ${label}\n${detail}\n`;
  try {
    fs.mkdirSync(path.dirname(startupLogPath()), { recursive: true });
    fs.appendFileSync(startupLogPath(), line, "utf8");
  } catch {
    // Startup diagnostics must never become a second startup failure.
  }
  return detail;
}
function reportStartupFailure(label, error) {
  const detail = logStartupFailure(label, error);
  const message = `${label}: ${detail}\n\nSee ${startupLogPath()} for details.`;
  if (app.isReady()) dialog.showErrorBox("anyBot could not start", message);
  else app.once("ready", () => dialog.showErrorBox("anyBot could not start", message));
}
process.on("uncaughtException", (error) => reportStartupFailure("Unhandled exception", error));
process.on("unhandledRejection", (error) => reportStartupFailure("Unhandled promise rejection", error));
function ensureWritableUserData() {
  const current = app.getPath("userData");
  try {
    fs.mkdirSync(current, { recursive: true });
    const probe = path.join(current, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    return;
  } catch {
    const candidates = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "anyBot-data"),
      path.join(app.getPath("appData"), "anyBot-data"),
      path.join(app.getPath("temp"), "anyBot-data"),
    ].filter(Boolean);
    for (const fallback of candidates) {
      try {
        fs.mkdirSync(fallback, { recursive: true });
        const probe = path.join(fallback, `.write-probe-${process.pid}`);
        fs.writeFileSync(probe, "ok");
        fs.rmSync(probe, { force: true });
        app.setPath("userData", fallback);
        userDataFallback = true;
        return;
      } catch {
        // Try the next user-data location. The temporary location is an
        // explicitly marked emergency mode for ACL-corrupted hosts.
      }
    }
    throw new Error("No writable anyBot user-data directory is available.");
  }
}
function loadStartupPreference() {
  try {
    const value = JSON.parse(fs.readFileSync(startupPath(), "utf8"));
    return {
      launchAtLogin: value.launchAtLogin === true,
      keepRunningInTray: value.keepRunningInTray !== false,
    };
  } catch {
    return { launchAtLogin: false, keepRunningInTray: true };
  }
}
function saveStartupPreference() {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(
      startupPath(),
      JSON.stringify({ launchAtLogin, keepRunningInTray }, null, 2),
    );
  } catch {
    // A failed preference write must not prevent the local runtime from starting.
  }
}
function applyStartupPreference(enabled) {
  launchAtLogin = Boolean(enabled);
  app.setLoginItemSettings({ openAtLogin: launchAtLogin });
  saveStartupPreference();
}
function applyTrayPreference(enabled) {
  keepRunningInTray = Boolean(enabled);
  saveStartupPreference();
}
// Some Windows hosts have a broken or unavailable GPU driver. Keep the
// local-first desktop shell usable by using Chromium's software compositor.
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("in-process-gpu");
// A stale install can leave the default Chromium profile ACL-protected. Keep
// the desktop runtime startable and preserve the old profile for recovery.
ensureWritableUserData();
const methods = new Set([
  "snapshot",
  "artifacts.preview",
  "artifacts.reveal",
  "harnesses.probe",
  "employees.create",
  "employees.update",
  "employees.setArchived",
  "conversations.create",
  "conversations.updateMembers",
  "messages.send",
  "runs.cancel",
  "routines.create",
  "routines.setEnabled",
  "routines.runNow",
  "runtime.pause",
  "runtime.resume",
  "runtime.stopAll",
]);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(() => {
    const startupPreference = loadStartupPreference();
    applyStartupPreference(startupPreference.launchAtLogin);
    applyTrayPreference(startupPreference.keepRunningInTray);
    ipcMain.handle("anybot:request", async (event, method, payload) => {
      validateSender(event);
      if (method === "runtime.startup") {
        applyStartupPreference(payload?.enabled === true);
        await waitForReady();
        const result = await request("snapshot");
        return {
          ...result,
          runtime: { ...result.runtime, launchAtLogin, keepRunningInTray, userDataFallback },
        };
      }
      if (method === "snapshot") {
        await waitForReady();
        const result = await request(method, payload);
        result.runtime = { ...result.runtime, launchAtLogin, keepRunningInTray, userDataFallback };
        return result;
      }
      if (method === "mobile.status")
        return {
          enabled: !!mobileGateway,
          url: mobileUrl,
          error: mobileError,
          devices: mobileGateway?.devices() || [],
          members: mobileGateway?.members() || [],
        };
      if (method === "runtime.tray") {
        applyTrayPreference(payload?.enabled === true);
        await waitForReady();
        const result = await request("snapshot");
        result.runtime = { ...result.runtime, launchAtLogin, keepRunningInTray, userDataFallback };
        return result;
      }
      if (method === "mobile.pair") {
        if (!mobileGateway)
          throw new Error("Configure mobile-access.json with TLS first.");
        return {
          ...mobileGateway.createPairing({
            role: payload?.role,
            memberId: payload?.memberId,
          }),
          url: mobileUrl,
        };
      }
      if (method === "mobile.revoke") {
        mobileGateway?.revoke(payload?.id);
        return { revoked: true };
      }
      if (method === "mobile.member.add") {
        if (!mobileGateway) throw new Error("Configure mobile-access.json with TLS first.");
        return { members: mobileGateway.addMember(payload || {}) };
      }
      if (method === "mobile.member.remove") {
        if (!mobileGateway) throw new Error("Configure mobile-access.json with TLS first.");
        return { members: mobileGateway.removeMember(payload?.id) };
      }
      if (method === "app.quit") {
        quitting = true;
        app.quit();
        return { quitting: true };
      }
      if (!methods.has(method)) throw new Error("Operation not allowed");
      await waitForReady();
      if (method === "artifacts.reveal") {
        const file = await request("artifacts.resolve", payload);
        shell.showItemInFolder(file);
        return { revealed: true };
      }
      return request(method, payload);
    });
    ipcMain.handle("anybot:directory", async (event) => {
      validateSender(event);
      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    });
    startWorker();
    startMobileGateway().catch((error) => {
      mobileError = String(error.message);
    });
    showWindow();
    const pixels = Buffer.alloc(16 * 16 * 4);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const p = (y * 16 + x) * 4;
        const lit = x > 3 && x < 12 && y > 3 && y < 12;
        pixels[p] = lit ? 211 : 28;
        pixels[p + 1] = lit ? 239 : 30;
        pixels[p + 2] = lit ? 154 : 28;
        pixels[p + 3] = 255;
      }
    tray = new Tray(
      nativeImage.createFromBitmap(pixels, { width: 16, height: 16 }),
    );
    tray.setToolTip("anyBot — your team is available");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open anyBot", click: showWindow },
        {
          label: "Pause new work",
          click: () => request("runtime.pause").catch(() => {}),
        },
        {
          label: "Resume work",
          click: () => request("runtime.resume").catch(() => {}),
        },
        { type: "separator" },
        { label: "Quit and stop active work", click: () => app.quit() },
      ]),
    );
    tray.on("double-click", showWindow);
  });
}
function validateSender(event) {
  if (event.sender !== window?.webContents || event.senderFrame?.url !== page)
    throw new Error("Untrusted application sender");
}
function request(method, payload) {
  return new Promise((resolve, reject) => {
    if (!ready || !worker) {
      reject(new Error("Runtime unavailable"));
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Runtime request timed out"));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, method, payload });
  });
}
function waitForReady(timeout = 30000) {
  if (ready && worker) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject };
    const timer = setTimeout(() => {
      readyWaiters.delete(waiter);
      reject(new Error("Runtime did not become ready in time."));
    }, timeout);
    waiter.finish = (error) => {
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    readyWaiters.add(waiter);
  });
}
function settleReadyWaiters(error) {
  for (const waiter of readyWaiters) waiter.finish(error);
  readyWaiters.clear();
}
function startWorker() {
  worker = utilityProcess.fork(
    path.join(__dirname, "../runtime/worker.mjs"),
    [app.getPath("userData")],
    { serviceName: "anyBot coordinator", stdio: "pipe" },
  );
  worker.stderr?.on("data", (chunk) => console.error(String(chunk)));
  worker.on("message", (message) => {
    if (message.type === "ready") {
      ready = true;
      settleReadyWaiters();
      window?.webContents.send("anybot:changed");
      return;
    }
    if (message.type === "changed") {
      window?.webContents.send("anybot:changed");
      return;
    }
    const call = pending.get(message.id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error));
    else call.resolve(message.result);
  });
  worker.on("exit", () => {
    ready = false;
    settleReadyWaiters(new Error("Runtime interrupted"));
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error("Runtime interrupted"));
    }
    pending.clear();
    if (!quitting && restarts++ < 3) setTimeout(startWorker, 1000 * restarts);
    else if (!quitting)
      dialog.showErrorBox(
        "anyBot runtime stopped",
        "The coordinator failed repeatedly. Restart the application to retry. Your saved conversations are retained.",
      );
  });
}
function showWindow(rendererSandbox = app.isPackaged) {
  if (window && !window.isDestroyed()) {
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: "#111411",
    title: "anyBot",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep the Chromium renderer sandbox wherever the host can launch it.
      // A few Windows installations fail before page load with Electron's
      // launch-failed (49); the renderer-gone handler below retries once with
      // context isolation and narrow IPC still enabled.
      sandbox: rendererSandbox,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    reportStartupFailure(
      `Renderer failed to load (${errorCode})`,
      new Error(`${errorDescription} — ${validatedURL}`),
    );
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (rendererSandbox && details.reason === "launch-failed" && !quitting) {
      window.destroy();
      window = null;
      setTimeout(() => showWindow(false), 0);
      return;
    }
    reportStartupFailure("Renderer process stopped", new Error(`${details.reason} (exit ${details.exitCode})`));
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== page) event.preventDefault();
  });
  window.loadURL(page);
  window.on("close", (event) => {
    if (!quitting) {
      if (keepRunningInTray) {
        event.preventDefault();
        window.hide();
        return;
      }
      event.preventDefault();
      app.quit();
    }
  });
}
app.on("window-all-closed", () => {});
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void mobileGateway?.close();
  ready = false;
  if (!worker) {
    app.quit();
    return;
  }
  worker.once("exit", () => app.quit());
  worker.postMessage({ type: "shutdown" });
  setTimeout(() => {
    worker?.kill();
    app.quit();
  }, 10000).unref();
});
async function startMobileGateway() {
  const configPath = path.join(app.getPath("userData"), "mobile-access.json");
  if (!fs.existsSync(configPath)) return;
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (config.enabled !== true) return;
  const url = new URL(config.publicUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Mobile publicUrl must be an HTTPS origin");
  if (!path.isAbsolute(config.certPath) || !path.isAbsolute(config.keyPath))
    throw new Error("TLS certificate paths must be absolute");
  const { createMobileGateway } = await import("../runtime/mobile-gateway.mjs");
  const gateway = createMobileGateway({
    command: request,
    host: config.host || "127.0.0.1",
    port: config.port || 4319,
    tls: {
      cert: fs.readFileSync(config.certPath),
      key: fs.readFileSync(config.keyPath),
    },
    origins: [
      "capacitor://localhost",
      "https://localhost",
      ...(Array.isArray(config.webOrigins) ? config.webOrigins : []),
    ],
    members: Array.isArray(config.members) ? config.members : [],
    membersPath: path.join(app.getPath("userData"), "mobile-members.json"),
    statePath: path.join(app.getPath("userData"), "mobile-membership.json"),
    auditPath: path.join(app.getPath("userData"), "mobile-audit.jsonl"),
  });
  await gateway.listen();
  mobileGateway = gateway;
  mobileUrl = url.origin;
}
