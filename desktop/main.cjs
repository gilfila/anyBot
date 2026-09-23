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
const { DiagnosticsLog, checkPendingUpdate, rememberPendingUpdate } = require("./diagnostics.cjs");
let diagnostics = null;
let window,
  worker,
  tray,
  quitting = false,
  ready = false,
  restarts = 0,
  launchAtLogin = false,
  keepRunningInTray = true,
  userDataFallback = false;

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Default update feed URL - points to public binary-only GitHub repo with releases.
// The source repo (gilfila/anyBot) remains private; gilfila/anyBot-updates contains
// only compiled binaries and electron-updater metadata (latest.yml, blockmaps).
// Override with ANYBOT_UPDATE_FEED_URL environment variable if needed.
const DEFAULT_UPDATE_FEED_URL = "https://github.com/gilfila/anyBot-updates/releases/latest/download";
const UPDATE_FEED_URL = process.env.ANYBOT_UPDATE_FEED_URL || DEFAULT_UPDATE_FEED_URL;

// Update state machine: idle → checking → available → downloading → downloaded → error
const UpdateState = {
  IDLE: "idle",
  CHECKING: "checking",
  AVAILABLE: "available",
  DOWNLOADING: "downloading",
  DOWNLOADED: "downloaded",
  ERROR: "error",
};

let updateState = UpdateState.IDLE;
let updateInfo = null;
let updateProgress = null;
let updateError = null;
let dismissedVersion = null;
let updateCheckTimer = null;
let autoUpdater = null;
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
const failureCodes = [
  ["Unhandled exception", "main.exception"],
  ["Unhandled promise rejection", "main.rejection"],
  ["Renderer failed to load", "renderer.load_failed"],
  ["Renderer process stopped", "renderer.gone"],
];
function reportStartupFailure(label, error) {
  const detail = logStartupFailure(label, error);
  diagnostics?.record({
    level: "error",
    source: "app",
    code: failureCodes.find(([prefix]) => label.startsWith(prefix))?.[1] || "app.failure",
    message: `${label}: ${error?.message || String(error)}`,
    detail,
  });
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

function updatePrefsPath() {
  return path.join(app.getPath("userData"), "update-prefs.json");
}

function loadDismissedVersion() {
  try {
    const data = JSON.parse(fs.readFileSync(updatePrefsPath(), "utf8"));
    return data.dismissedVersion || null;
  } catch {
    return null;
  }
}

function saveDismissedVersion(version) {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(
      updatePrefsPath(),
      JSON.stringify({ dismissedVersion: version }, null, 2),
    );
  } catch {
    // Preference write failure must not interrupt normal operation.
  }
}

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map(Number);
  const pb = String(b).replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// Validate that the update feed URL is safe (HTTPS, no credentials embedded)
function isValidUpdateFeedUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

// Initialize electron-updater with the configured feed URL
// Parse GitHub releases URL to extract owner/repo for GitHub provider
function parseGitHubReleasesUrl(url) {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  return null;
}

function initializeAutoUpdater() {
  if (!UPDATE_FEED_URL) {
    console.log("Update feed URL not configured. Set ANYBOT_UPDATE_FEED_URL to enable auto-updates.");
    return null;
  }

  if (!isValidUpdateFeedUrl(UPDATE_FEED_URL)) {
    console.error("Invalid update feed URL. Must be HTTPS without embedded credentials.");
    return null;
  }

  try {
    const { autoUpdater: electronAutoUpdater } = require("electron-updater");
    // Keep the updater's own timeline (check, download, install) in the
    // diagnostics log; failures are recorded from the error event below.
    electronAutoUpdater.logger = {
      info: (message) => diagnostics?.record({ level: "info", source: "updater", code: "update.log", message: String(message) }),
      warn: (message) => diagnostics?.record({ level: "warn", source: "updater", code: "update.warning", message: String(message) }),
      error: () => {},
      debug: () => {},
    };
    
    // Configure electron-updater
    electronAutoUpdater.autoDownload = false;
    electronAutoUpdater.autoInstallOnAppQuit = false;
    electronAutoUpdater.allowDowngrade = false;
    
    // Detect GitHub releases URL pattern and use appropriate provider
    const githubInfo = parseGitHubReleasesUrl(UPDATE_FEED_URL);
    if (githubInfo) {
      // Use GitHub provider for GitHub releases URLs - supports latest.yml lookup
      electronAutoUpdater.setFeedURL({
        provider: "github",
        owner: githubInfo.owner,
        repo: githubInfo.repo,
      });
    } else {
      // Use generic provider for other HTTPS URLs
      electronAutoUpdater.setFeedURL({
        provider: "generic",
        url: UPDATE_FEED_URL,
      });
    }

    // Event handlers
    electronAutoUpdater.on("checking-for-update", () => {
      updateState = UpdateState.CHECKING;
      updateError = null;
      notifyRenderer();
    });

    electronAutoUpdater.on("update-available", (info) => {
      updateState = UpdateState.AVAILABLE;
      updateInfo = {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: typeof info.releaseNotes === "string" 
          ? info.releaseNotes 
          : Array.isArray(info.releaseNotes) 
            ? info.releaseNotes.map(n => n.note || n).join("\n")
            : "",
        files: info.files?.map(f => ({ name: f.url, size: f.size })) || [],
      };
      updateProgress = null;
      updateError = null;
      notifyRenderer();
    });

    electronAutoUpdater.on("update-not-available", () => {
      updateState = UpdateState.IDLE;
      updateInfo = null;
      updateProgress = null;
      updateError = null;
      notifyRenderer();
    });

    electronAutoUpdater.on("download-progress", (progress) => {
      updateState = UpdateState.DOWNLOADING;
      updateProgress = {
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      };
      notifyRenderer();
    });

    electronAutoUpdater.on("update-downloaded", () => {
      updateState = UpdateState.DOWNLOADED;
      updateProgress = { percent: 100 };
      updateError = null;
      notifyRenderer();
    });

    electronAutoUpdater.on("error", (error) => {
      diagnostics?.record({
        level: "error",
        source: "updater",
        code: "update.failed",
        message: error.message || "Update failed",
        detail: error.stack,
        context: { phase: updateState, code: error.code, version: updateInfo?.version },
      });
      updateState = UpdateState.ERROR;
      updateError = {
        message: error.message || "Update failed",
        code: error.code,
        retryable: true,
      };
      updateProgress = null;
      notifyRenderer();
    });

    return electronAutoUpdater;
  } catch (error) {
    console.error("Failed to initialize auto-updater:", error.message);
    diagnostics?.record({ level: "error", source: "updater", code: "update.init_failed", message: error.message, detail: error.stack });
    return null;
  }
}

function notifyRenderer() {
  window?.webContents.send("anybot:changed");
}

// Get the current update state for the renderer
function getUpdateState() {
  // Always include feedConfigured so the UI knows whether the feed is set up,
  // even when there's no pending update to display.
  const feedConfigured = !!UPDATE_FEED_URL && isValidUpdateFeedUrl(UPDATE_FEED_URL);

  // If update is dismissed, hide it unless we're already downloading/downloaded
  if (
    updateInfo &&
    dismissedVersion &&
    compareVersions(updateInfo.version, dismissedVersion) <= 0 &&
    updateState === UpdateState.AVAILABLE
  ) {
    return { feedConfigured };
  }

  if (!updateInfo && updateState === UpdateState.IDLE) {
    return { feedConfigured };
  }

  return {
    state: updateState,
    version: updateInfo?.version || null,
    releaseNotes: updateInfo?.releaseNotes || "",
    releaseDate: updateInfo?.releaseDate || null,
    progress: updateProgress,
    error: updateError,
    feedConfigured,
  };
}

// Check for updates
async function checkForUpdates() {
  if (!autoUpdater) {
    // If auto-updater isn't configured, return current state
    return getUpdateState();
  }

  // A re-check while a download is in flight or finished would emit
  // update-available again and throw away the "ready to restart" state.
  if (
    updateState === UpdateState.CHECKING ||
    updateState === UpdateState.DOWNLOADING ||
    updateState === UpdateState.DOWNLOADED
  ) {
    return getUpdateState();
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    updateState = UpdateState.ERROR;
    updateError = {
      message: error.message || "Failed to check for updates",
      code: error.code,
      retryable: true,
    };
    notifyRenderer();
  }
  
  return getUpdateState();
}

// Start downloading the update
async function downloadUpdate() {
  if (!autoUpdater) {
    throw new Error("Auto-updater not configured. Set ANYBOT_UPDATE_FEED_URL.");
  }

  if (updateState !== UpdateState.AVAILABLE) {
    throw new Error("No update available to download");
  }

  try {
    updateState = UpdateState.DOWNLOADING;
    updateProgress = { percent: 0 };
    notifyRenderer();
    await autoUpdater.downloadUpdate();
  } catch (error) {
    updateState = UpdateState.ERROR;
    updateError = {
      message: error.message || "Download failed",
      code: error.code,
      retryable: true,
    };
    notifyRenderer();
    throw error;
  }
}

// Install the downloaded update and restart
function installUpdate() {
  if (!autoUpdater) {
    throw new Error("Auto-updater not configured");
  }

  if (updateState !== UpdateState.DOWNLOADED) {
    throw new Error("No downloaded update to install");
  }

  // Silent install: isSilent=true runs the NSIS installer with /S flag,
  // which suppresses the Setup wizard UI entirely. isForceRunAfter=true
  // ensures the app restarts automatically after the silent install completes.
  // This requires the NSIS config to use oneClick=true (one-click installers
  // support silent mode natively). Per-user install (perMachine=false) avoids
  // UAC prompts since installation goes to %LOCALAPPDATA%\Programs.
  quitting = true;
  // Lets the next start confirm the installer actually ran (see
  // checkPendingUpdate). Install behavior itself is unchanged.
  rememberPendingUpdate(app.getPath("userData"), app.getVersion(), updateInfo?.version);
  diagnostics?.record({
    level: "info",
    source: "updater",
    code: "update.install_started",
    message: `Installing ${updateInfo?.version} over ${app.getVersion()}`,
  });
  autoUpdater.quitAndInstall(true, true);
}

// Dismiss an update version
function dismissUpdate(version) {
  if (version) {
    dismissedVersion = version;
    saveDismissedVersion(version);
    if (updateState === UpdateState.AVAILABLE) {
      notifyRenderer();
    }
  }
}

// Retry after an error
async function retryUpdate() {
  if (updateState !== UpdateState.ERROR) {
    return;
  }
  
  updateState = UpdateState.IDLE;
  updateError = null;
  notifyRenderer();
  
  return checkForUpdates();
}

function startUpdateChecker() {
  dismissedVersion = loadDismissedVersion();
  autoUpdater = initializeAutoUpdater();
  
  // Initial check after a short delay to let the app settle
  setTimeout(() => {
    checkForUpdates();
  }, 3000);

  // Periodic checks. AVAILABLE is included so a newer release still surfaces
  // after the owner dismissed an older one.
  updateCheckTimer = setInterval(() => {
    if (
      updateState === UpdateState.IDLE ||
      updateState === UpdateState.ERROR ||
      updateState === UpdateState.AVAILABLE
    ) {
      checkForUpdates();
    }
  }, UPDATE_CHECK_INTERVAL_MS);
}

function stopUpdateChecker() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
}

// Some Windows hosts have a broken or unavailable GPU driver. Keep the
// local-first desktop shell usable by using Chromium's software compositor.
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("in-process-gpu");
// A stale install can leave the default Chromium profile ACL-protected. Keep
// the desktop runtime startable and preserve the old profile for recovery.
ensureWritableUserData();
diagnostics = new DiagnosticsLog(app.getPath("userData"), { version: app.getVersion() });
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
  "conversations.updateSettings",
  "messages.send",
  "runs.cancel",
  "runs.dismiss",
  "tasks.get",
  "tasks.create",
  "tasks.update",
  "tasks.move",
  "tasks.delete",
  "tasks.comment",
  "tasks.start",
  "tasks.stop",
  "tasks.review",
  "conversations.setAutopilot",
  "docs.get",
  "docs.save",
  "docs.history",
  "docs.restore",
  "employees.setManager",
  "org.get",
  "reports.markRead",
  "memory.list",
  "graph.get",
  "graph.fact",
  "graph.entityUpdate",
  "graph.entityDelete",
  "graph.edgeUpdate",
  "graph.edgeDelete",
  "graph.ask",
  "memory.create",
  "memory.update",
  "memory.delete",
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
    // Every coordinator command answers with a snapshot. The renderer replaces
    // its state with that snapshot, so shell-owned fields (startup prefs and
    // updater state) must ride along or the UI flickers until the next poll.
    const withShellState = (result) =>
      result && typeof result === "object" && result.runtime
        ? {
            ...result,
            runtime: { ...result.runtime, launchAtLogin, keepRunningInTray, userDataFallback },
            update: getUpdateState(),
            diagnostics: diagnostics.summary(),
          }
        : result;
    ipcMain.handle("anybot:request", async (event, method, payload) => {
      validateSender(event);
      if (method === "runtime.startup") {
        applyStartupPreference(payload?.enabled === true);
        await waitForReady();
        return withShellState(await request("snapshot"));
      }
      if (method === "snapshot") {
        await waitForReady();
        return withShellState(await request(method, payload));
      }
      if (method === "update.check") {
        await checkForUpdates();
        return { update: getUpdateState() };
      }
      if (method === "update.dismiss") {
        dismissUpdate(payload?.version);
        return { dismissed: true, update: getUpdateState() };
      }
      if (method === "update.download") {
        try {
          await downloadUpdate();
          return { downloading: true, update: getUpdateState() };
        } catch (error) {
          return { error: error.message, update: getUpdateState() };
        }
      }
      if (method === "update.install") {
        try {
          installUpdate();
          return { installing: true };
        } catch (error) {
          return { error: error.message, update: getUpdateState() };
        }
      }
      if (method === "update.retry") {
        await retryUpdate();
        return { update: getUpdateState() };
      }
      if (method === "diagnostics.list")
        return {
          groups: diagnostics.groups(),
          summary: diagnostics.summary(),
          version: app.getVersion(),
          directory: diagnostics.directory,
        };
      if (method === "diagnostics.report") {
        const code = String(payload?.code || "error");
        diagnostics.record({
          level: payload?.level === "warn" ? "warn" : "error",
          source: "renderer",
          code: /^[a-z][a-z_.]{0,39}$/.test(code) ? `renderer.${code}` : "renderer.error",
          message: String(payload?.message || "").slice(0, 600),
          detail: typeof payload?.detail === "string" ? payload.detail.slice(0, 4000) : undefined,
          context: payload?.context && typeof payload.context === "object" ? payload.context : undefined,
        });
        notifyRenderer();
        return { recorded: true };
      }
      if (method === "diagnostics.markSeen") {
        diagnostics.markSeen();
        notifyRenderer();
        return { summary: diagnostics.summary() };
      }
      if (method === "diagnostics.clear") {
        diagnostics.clear();
        notifyRenderer();
        return { groups: diagnostics.groups(), summary: diagnostics.summary() };
      }
      if (method === "diagnostics.reveal") {
        fs.mkdirSync(diagnostics.directory, { recursive: true });
        const failure = await shell.openPath(diagnostics.directory);
        return { opened: !failure, error: failure || undefined };
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
        return withShellState(await request("snapshot"));
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
      return withShellState(await request(method, payload));
    });
    ipcMain.handle("anybot:directory", async (event) => {
      validateSender(event);
      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    });
    ipcMain.handle("anybot:listDirectory", async (event, dirPath) => {
      validateSender(event);
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return {
          entries: entries.map((entry) => {
            const entryPath = path.join(dirPath, entry.name);
            let size;
            // A locked or dangling entry must not hide the rest of the folder.
            try {
              if (entry.isFile()) size = fs.statSync(entryPath).size;
            } catch {}
            return { name: entry.name, path: entryPath, isDirectory: entry.isDirectory(), size };
          }),
        };
      } catch (error) {
        throw new Error(`Cannot read directory: ${error.message}`);
      }
    });
    ipcMain.handle("anybot:revealPath", async (event, filePath) => {
      validateSender(event);
      shell.showItemInFolder(filePath);
      return { revealed: true };
    });
    ipcMain.handle("anybot:runCommand", async (event, { id, command }) => {
      validateSender(event);
      const { spawn } = require("node:child_process");
      return new Promise((resolve) => {
        const isWindows = process.platform === "win32";
        const shell = isWindows ? "cmd.exe" : "/bin/sh";
        const shellArgs = isWindows ? ["/c", command] : ["-c", command];
        
        const child = spawn(shell, shellArgs, {
          cwd: app.getPath("userData"),
          env: { ...process.env, FORCE_COLOR: "0" },
        });
        
        let output = "";
        
        child.stdout.on("data", (data) => {
          const chunk = data.toString();
          output += chunk;
          window?.webContents.send("anybot:commandOutput", { id, chunk });
        });
        
        child.stderr.on("data", (data) => {
          const chunk = data.toString();
          output += chunk;
          window?.webContents.send("anybot:commandOutput", { id, chunk });
        });
        
        const timeout = setTimeout(() => {
          if (child.exitCode === null && !child.killed) {
            child.kill();
            resolve({ output: output + "\n[Command timed out after 60s]", exitCode: 124 });
          }
        }, 60000);

        child.on("close", (exitCode) => {
          clearTimeout(timeout);
          resolve({ output, exitCode: exitCode ?? 0 });
        });

        child.on("error", (error) => {
          clearTimeout(timeout);
          resolve({ output: error.message, exitCode: 1 });
        });
      });
    });
    ipcMain.handle("anybot:openUrl", async (event, url) => {
      validateSender(event);
      if (!isExternalWebUrl(url)) throw new Error("Only http and https links can be opened");
      await shell.openExternal(url);
      return { opened: true };
    });
    startWorker();
    startMobileGateway().catch((error) => {
      mobileError = String(error.message);
    });
    showWindow();
    const installed = checkPendingUpdate(app.getPath("userData"), app.getVersion());
    if (installed) diagnostics.record(installed);
    app.on("child-process-gone", (_event, details) => {
      // The coordinator's exits are recorded by the worker supervisor.
      if (quitting || details.type === "Utility" || details.reason === "clean-exit") return;
      diagnostics.record({
        level: "error",
        source: "app",
        code: "process.gone",
        message: `${details.type} process ${details.reason} (exit ${details.exitCode})`,
        context: { type: details.type, reason: details.reason, exitCode: details.exitCode, name: details.name },
      });
    });
    startUpdateChecker();
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
function isExternalWebUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
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
  worker.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    console.error(text);
    // Node prints ExperimentalWarning for node:sqlite on every start.
    const lines = text.split("\n").filter((line) => line.trim() && !/ExperimentalWarning|--trace-warnings/.test(line));
    if (lines.length)
      diagnostics?.record({ level: "warn", source: "runtime", code: "runtime.stderr", message: lines[0], detail: lines.join("\n") });
  });
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
    if (message.type === "diagnostic") {
      diagnostics?.record(message.entry);
      notifyRenderer();
      return;
    }
    const call = pending.get(message.id);
    if (!call) return;
    clearTimeout(call.timer);
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error));
    else call.resolve(message.result);
  });
  worker.on("exit", (code) => {
    if (!quitting)
      diagnostics?.record({
        level: "error",
        source: "runtime",
        code: "runtime.exited",
        message: `The coordinator stopped unexpectedly (exit ${code})`,
        context: { exitCode: code, restarts },
      });
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
  // Links in employee output use target=_blank. Hand web links to the
  // system browser instead of silently dropping the click; never open
  // additional Electron windows.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
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
  stopUpdateChecker();
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
