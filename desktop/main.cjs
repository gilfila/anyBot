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
  Notification,
  safeStorage,
  clipboard,
  session,
} = require("electron");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const { DISPLAY_NAME, BRAND_DIR, applyBrand, trayIcon } = require("./brand.cjs");
applyBrand(app);
const { pathToFileURL } = require("node:url");
const { DiagnosticsLog, checkPendingUpdate, rememberPendingUpdate } = require("./diagnostics.cjs");
const {
  createShutdown,
  createCrashTracker,
  createRestartBudget,
  createStartupFailures,
  stoppedDialog,
  isOfflineError,
} = require("./lifecycle.cjs");
const { commandDirectory, killTree } = require("./shell-command.cjs");
const fileAccess = require("./file-access.cjs");
const { contextMenuItems, fileRequestBlocked, navigationTarget } = require("./window-shell.cjs");
const { teamTrayItems, teamTrayTooltip, traySignature, trayRefreshDelay } = require("./team-tray.cjs");
let diagnostics = null;
let fileLinks = null;
let window,
  worker,
  tray,
  quitting = false,
  ready = false,
  // Set once the window first loads: from then on a failure is logged, not
  // shown in a blocking "could not start" dialog.
  windowLoaded = false,
  launchAtLogin = false,
  keepRunningInTray = true,
  userDataFallback = false;
const restarts = createRestartBudget();
const startupFailures = createStartupFailures();
const rendererCrashes = createCrashTracker();
// Terminal commands still running (Settings → context rail → Terminal), by id.
const commands = new Map();

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
// An automatic check that failed because the computer was offline tries again
// this much later, without showing a problem.
const OFFLINE_RETRY_MS = 5 * 60 * 1000;

// The Android app is attached to every release under one name (docs/mobile.md),
// so this link always gives the newest. The pairing screen offers it only once
// a release actually carries it: GitHub redirects either way, so follow the
// redirects and look at the final status. Cached; a miss is rechecked sooner.
const PHONE_APP_URL = "https://github.com/gilfila/anyBot/releases/latest/download/AnyBot-phone.apk";
let phoneAppCheck = null;
function phoneAppDownload() {
  const age = phoneAppCheck ? Date.now() - phoneAppCheck.at : Infinity;
  if (age > (phoneAppCheck?.available ? 30 : 2) * 60 * 1000) {
    const at = Date.now();
    const result = fetch(PHONE_APP_URL, { method: "HEAD", redirect: "follow" })
      .then((response) => ({ url: PHONE_APP_URL, available: response.ok }))
      .catch(() => ({ url: PHONE_APP_URL, available: false }));
    phoneAppCheck = { at, result, available: false };
    result.then(({ available }) => {
      if (phoneAppCheck?.at === at) phoneAppCheck.available = available;
    });
  }
  return phoneAppCheck.result;
}

// Default update feed: the source repo's own releases (gilfila/anyBot is public
// since 2026-09-23). Builds before 0.3.23 read gilfila/anyBot-updates, which the
// publisher keeps mirroring so they can still reach this version.
// Override with ANYBOT_UPDATE_FEED_URL environment variable if needed.
const DEFAULT_UPDATE_FEED_URL = "https://github.com/gilfila/anyBot/releases/latest/download";
const UPDATE_FEED_URL = process.env.ANYBOT_UPDATE_FEED_URL || DEFAULT_UPDATE_FEED_URL;
// Updates ship only as the Windows NSIS installer. A copy run from source
// (`npm start`, any platform) updates with git, so the updater stays off and
// Settings says how.
const AUTO_UPDATE_SUPPORTED = app.isPackaged && process.platform === "win32";

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
// The owner asked for this check (Check now, Retry): its failures always show.
let manualCheck = false;
let stateBeforeCheck = UpdateState.IDLE;
let checkFailed = false;
let offlineRetry = null;
// "Install when idle": the downloaded update installs once no bot is working.
let installWhenIdle = false;
let installing = null;
const pending = new Map();
const readyWaiters = new Set();
let mobileGateway, mobileUrl, mobileError, phoneLink, phoneError, slackBridge, slackError;
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
  // The dialog blocks the main process (Slack, the phone link, every IPC
  // call), so it is only for failures before the window first loads. Later
  // ones stay in the log and in Settings → Diagnostics.
  if (quitting || windowLoaded) {
    notifyRenderer();
    return;
  }
  const message = `${label}: ${detail}\n\nSee ${startupLogPath()} for details.`;
  if (app.isReady()) dialog.showErrorBox("Any Bot could not start", message);
  else app.once("ready", () => dialog.showErrorBox("Any Bot could not start", message));
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
    throw new Error("No writable Any Bot user-data directory is available.");
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
  // A run from source would point Windows' login entry at the checkout's
  // electron.exe instead of the installed app; it only saves the choice.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: launchAtLogin });
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
    // The build is a full NSIS installer, never a web installer. This only
    // silences the download-time warning; installing is unchanged.
    electronAutoUpdater.disableWebInstaller = true;
    
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
      checkFailed = true;
      // An automatic check while offline (at login, after sleep) isn't a
      // problem: note it, keep what was showing, and try again soon.
      if (updateState === UpdateState.CHECKING && !manualCheck && isOfflineError(error)) {
        diagnostics?.record({
          level: "info",
          source: "updater",
          code: "update.offline",
          message: "Couldn't check for updates: this computer seems to be offline. Trying again in a few minutes.",
        });
        updateState = stateBeforeCheck;
        clearTimeout(offlineRetry);
        offlineRetry = setTimeout(() => {
          offlineRetry = null;
          checkForUpdates();
        }, OFFLINE_RETRY_MS);
        notifyRenderer();
        return;
      }
      if (installWhenIdle) cancelIdleInstall();
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
  if (window && !window.isDestroyed()) window.webContents.send("anybot:changed");
}

// Get the current update state for the renderer
function getUpdateState() {
  // Always include feedConfigured so the UI knows whether the feed is set up,
  // even when there's no pending update to display.
  const feedConfigured = !!UPDATE_FEED_URL && isValidUpdateFeedUrl(UPDATE_FEED_URL);
  const supported = AUTO_UPDATE_SUPPORTED;

  // If update is dismissed, hide it unless we're already downloading/downloaded
  if (
    updateInfo &&
    dismissedVersion &&
    compareVersions(updateInfo.version, dismissedVersion) <= 0 &&
    updateState === UpdateState.AVAILABLE
  ) {
    return { feedConfigured, supported };
  }

  if (!updateInfo && updateState === UpdateState.IDLE) {
    return { feedConfigured, supported };
  }

  return {
    state: updateState,
    version: updateInfo?.version || null,
    releaseNotes: updateInfo?.releaseNotes || "",
    releaseDate: updateInfo?.releaseDate || null,
    progress: updateProgress,
    error: updateError,
    feedConfigured,
    installWhenIdle,
    supported,
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

  stateBeforeCheck = updateState;
  checkFailed = false;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    // The error event already decided what to show (see its handler).
    if (!checkFailed) {
      updateState = UpdateState.ERROR;
      updateError = {
        message: error.message || "Failed to check for updates",
        code: error.code,
        retryable: true,
      };
      notifyRenderer();
    }
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

// Why the downloaded update can't be installed now, if it can't.
function installBlocker() {
  if (!autoUpdater) return "Auto-updater not configured";
  if (updateState !== UpdateState.DOWNLOADED) return "No downloaded update to install";
  return null;
}

// Install the downloaded update and restart
async function installUpdate() {
  const blocked = installBlocker();
  if (blocked) throw new Error(blocked);
  if (installing) return installing;
  installWhenIdle = false;
  installing = (async () => {
    // The installer ends Any Bot's processes about a second after it starts,
    // so the team is stopped first, the same way as quitting: running bots
    // are recorded as cut off and followed up at the next start.
    await shutdown.stop();
    // Silent install: isSilent=true runs the NSIS installer with /S flag,
    // which suppresses the Setup wizard UI entirely. isForceRunAfter=true
    // ensures the app restarts automatically after the silent install completes.
    // This requires the NSIS config to use oneClick=true (one-click installers
    // support silent mode natively). Per-user install (perMachine=false) avoids
    // UAC prompts since installation goes to %LOCALAPPDATA%\Programs.
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
    // The installer couldn't start (its error was recorded and the state is
    // now error), and the team is already stopped: start again on this
    // version rather than stay open with nothing running.
    if (updateState === UpdateState.ERROR) {
      app.relaunch();
      app.quit();
    }
  })();
  return installing;
}

// "Install when idle": nothing new starts (the coordinator holds queued work
// for after the restart), and the update installs once no bot is working.
function startIdleInstall() {
  const blocked = installBlocker();
  if (blocked) throw new Error(blocked);
  installWhenIdle = true;
  request("runtime.hold", { hold: true }).catch(() => {});
  notifyRenderer();
  checkIdleInstall();
  return getUpdateState();
}
function cancelIdleInstall() {
  installWhenIdle = false;
  request("runtime.hold", { hold: false }).catch(() => {});
  notifyRenderer();
  return getUpdateState();
}
// Runs on every coordinator change; one check at a time, plus one more when
// something changed meanwhile.
let idleCheck = null;
let idleAgain = false;
function checkIdleInstall() {
  if (!installWhenIdle || !ready) return;
  if (idleCheck) {
    idleAgain = true;
    return;
  }
  idleCheck = (async () => {
    do {
      idleAgain = false;
      const activity = await request("runtime.activity").catch((error) => {
        // A quit (or a cancel) meanwhile rejects the check ("Runtime
        // interrupted") and ends the wait on purpose: nothing failed.
        if (quitting || !installWhenIdle) return null;
        throw error;
      });
      if (!activity) return;
      if (installWhenIdle && activity.running === 0) {
        await installUpdate();
        return;
      }
    } while (idleAgain && installWhenIdle);
  })()
    .catch((error) =>
      diagnostics?.record({ level: "warn", source: "updater", code: "update.idle_install_failed", message: String(error.message).slice(0, 300) }),
    )
    .finally(() => {
      idleCheck = null;
    });
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
  if (!AUTO_UPDATE_SUPPORTED) return;
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
  clearTimeout(offlineRetry);
  offlineRetry = null;
}

// Some Windows hosts have a broken or unavailable GPU driver. Keep the
// local-first desktop shell usable by using Chromium's software compositor.
// On macOS this switch disables WebGL outright (no SwiftShader fallback), which
// leaves the 3D avatars on their static fallback icon.
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("in-process-gpu");
}
// A stale install can leave the default Chromium profile ACL-protected. Keep
// the desktop runtime startable and preserve the old profile for recovery.
ensureWritableUserData();
diagnostics = new DiagnosticsLog(app.getPath("userData"), { version: app.getVersion() });
const methods = new Set([
  "snapshot",
  "artifacts.preview",
  "artifacts.reveal",
  "harnesses.probe",
  "harnesses.models",
  "employees.create",
  "employees.update",
  "employees.setArchived",
  "conversations.create",
  "conversations.updateMembers",
  "conversations.updateSettings",
  "conversations.setArchived",
  "messages.send",
  "runs.cancel",
  "runs.dismiss",
  "runs.retry",
  "runs.terminal",
  "runs.stopConversation",
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
  "buzz.status",
  "buzz.set",
  "buzz.install",
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
  "approvals.decide",
  "memory.create",
  "memory.update",
  "memory.delete",
  "routines.create",
  "attachments.preview",
  "attachments.savePasted",
  "routines.setEnabled",
  "routines.update",
  "routines.delete",
  "routines.runNow",
  "runtime.pause",
  "runtime.resume",
  "runtime.stopAll",
  "runs.interrupt",
  "team.get",
  "team.set",
  "team.pause",
  "team.stop",
  "team.resume",
  "breaker.reset",
  "people.review",
  "people.run",
  "people.set",
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
        manualCheck = true;
        try {
          await checkForUpdates();
        } finally {
          manualCheck = false;
        }
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
      // { when: "idle" } waits until no bot is working; otherwise the team is
      // stopped (gracefully) and the update installs now.
      if (method === "update.install") {
        try {
          if (payload?.when === "idle") return { waiting: true, update: startIdleInstall() };
          const blocked = installBlocker();
          if (blocked) throw new Error(blocked);
          installUpdate().catch((error) =>
            diagnostics?.record({ level: "error", source: "updater", code: "update.failed", message: String(error.message).slice(0, 300) }),
          );
          return { installing: true };
        } catch (error) {
          return { error: error.message, update: getUpdateState() };
        }
      }
      if (method === "update.cancelInstall") return { update: cancelIdleInstall() };
      if (method === "update.retry") {
        manualCheck = true;
        try {
          await retryUpdate();
        } finally {
          manualCheck = false;
        }
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
      // Settings → Saved on this computer: the app's own data folder, never a
      // path from the renderer.
      if (method === "app.openDataFolder") {
        const failure = await shell.openPath(app.getPath("userData"));
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
      // Settings → Your phone (runtime/phone-link.mjs).
      if (method === "phone.status")
        return phoneLink ? phoneLink.status() : { connection: phoneError ? "error" : "starting", error: phoneError || null, devices: [] };
      if (method === "phone.app") return phoneAppDownload();
      // A bot's menu → Connect to Slack (runtime/slack-bridge.mjs).
      if (method.startsWith("slack.")) return slackRequest(method, payload || {});
      if (method === "phone.pair") {
        if (!phoneLink) throw new Error(phoneError || "Phone connections are still starting. Try again in a moment.");
        return phoneLink.createPairing();
      }
      if (method === "phone.cancelPairing") {
        phoneLink?.cancelPairing();
        return { cancelled: true };
      }
      if (method === "phone.remove") {
        if (!phoneLink) throw new Error("Phone connections are still starting.");
        return phoneLink.remove(String(payload?.id || ""));
      }
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
      // Settings → Quit: the same graceful shutdown as the tray's Quit
      // (before-quit), not a hard stop.
      if (method === "app.quit") {
        app.quit();
        return { quitting: true };
      }
      // File links in chat (desktop/file-access.cjs). The paths come from bot
      // output, so each action re-inspects from scratch and only a path of an
      // allowed type ever reaches shell.openPath.
      if (method === "files.check") return fileLinkService().check(payload);
      if (method === "files.preview") return fileAccess.readPreview(await fileTarget(payload, "preview"));
      if (method === "files.open") {
        const ref = await fileTarget(payload, "open");
        // A folder opens with a trailing separator. If it has been renamed
        // away since the check, "tools\" is simply not found, where "tools"
        // would let the shell try tools.exe, tools.cmd…; a file swapped in
        // under the same name only opens when its name could (policy()).
        const target = ref.state === "folder" && !ref.path.endsWith(path.sep) ? `${ref.path}${path.sep}` : ref.path;
        const failure = await shell.openPath(target);
        if (failure) {
          const scrubbed = [ref.path, ref.name.length >= 3 ? ref.name : ""]
            .filter(Boolean)
            .reduce((text, part) => text.split(part).join("<file>"), String(failure));
          diagnostics.record({
            level: "error",
            source: "app",
            code: "files.open_failed",
            message: "Windows couldn't open a file from chat.",
            detail: scrubbed.slice(0, 300),
            context: { ext: fileAccess.safeExtension(ref.name) || undefined },
          });
          notifyRenderer();
          throw new Error(`Couldn't open ${ref.name}: ${failure}`);
        }
        return { opened: true };
      }
      if (method === "files.reveal") {
        const ref = await fileTarget(payload, "reveal");
        shell.showItemInFolder(ref.path);
        return { revealed: true };
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
    ipcMain.handle("anybot:attachments", async (event, kind) => {
      validateSender(event);
      const result = await dialog.showOpenDialog(window, {
        title: kind === "folders" ? "Attach folders" : "Attach files",
        properties: [kind === "folders" ? "openDirectory" : "openFile", "multiSelections"],
      });
      return result.canceled ? [] : result.filePaths.slice(0, 20);
    });
    ipcMain.handle("anybot:listDirectory", async (event, dirPath) => {
      validateSender(event);
      fileAccess.ownerPath(dirPath);
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
    // Owner-chosen paths only (attachments, the rail explorer); file links in
    // chat never come here (tests/desktop-ipc.test.mjs).
    ipcMain.handle("anybot:revealPath", async (event, filePath) => {
      validateSender(event);
      shell.showItemInFolder(fileAccess.ownerPath(filePath));
      return { revealed: true };
    });
    // The context rail's Terminal: the owner's own commands, typed in the
    // app (never bot output). They run in the conversation's folder the
    // renderer names, else the owner's home; never in this app's data folder.
    ipcMain.handle("anybot:runCommand", async (event, { id, command, cwd }) => {
      validateSender(event);
      const { spawn } = require("node:child_process");
      const folder = commandDirectory(cwd, { home: os.homedir(), userData: app.getPath("userData") });
      const key = String(id || "").slice(0, 64);
      return new Promise((resolve) => {
        const isWindows = process.platform === "win32";
        const shell = isWindows ? "cmd.exe" : "/bin/sh";
        const shellArgs = isWindows ? ["/c", command] : ["-c", command];

        const child = spawn(shell, shellArgs, {
          cwd: folder,
          env: { ...process.env, FORCE_COLOR: "0" },
          // No input: a command that prompts ends instead of waiting.
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          // Its own process group, so Stop ends everything it started.
          detached: !isWindows,
        });
        let output = "";
        let stopped = false;
        const entry = {
          stop() {
            stopped = true;
            killTree(child);
          },
        };
        if (key) commands.set(key, entry);
        const send = (chunk) => {
          if (window && !window.isDestroyed()) window.webContents.send("anybot:commandOutput", { id, chunk });
        };

        child.stdout.on("data", (data) => {
          const chunk = data.toString();
          output += chunk;
          send(chunk);
        });

        child.stderr.on("data", (data) => {
          const chunk = data.toString();
          output += chunk;
          send(chunk);
        });

        const timeout = setTimeout(() => {
          if (child.exitCode === null && !child.killed) {
            entry.stop();
            resolve({ output: output + "\n[Command timed out after 60s]", exitCode: 124, cwd: folder });
          }
        }, 60000);

        child.on("close", (exitCode) => {
          clearTimeout(timeout);
          if (commands.get(key) === entry) commands.delete(key);
          resolve({ output: stopped ? `${output}\n[Stopped]` : output, exitCode: exitCode ?? (stopped ? 130 : 0), cwd: folder });
        });

        child.on("error", (error) => {
          clearTimeout(timeout);
          if (commands.get(key) === entry) commands.delete(key);
          resolve({ output: error.message, exitCode: 1, cwd: folder });
        });
      });
    });
    // The Terminal's Stop button: ends the command and everything it started.
    ipcMain.handle("anybot:stopCommand", async (event, id) => {
      validateSender(event);
      const entry = commands.get(String(id || "").slice(0, 64));
      entry?.stop();
      return { stopped: Boolean(entry) };
    });
    ipcMain.handle("anybot:openUrl", async (event, url) => {
      validateSender(event);
      if (!isExternalWebUrl(url)) throw new Error("Only http and https links can be opened");
      await shell.openExternal(url);
      return { opened: true };
    });
    // Slack starts when the coordinator first reports ready (ensureSlack).
    guardFileRequests();
    startWorker();
    startMobileAccess().catch((error) => {
      mobileError = String(error.message);
      // The QR phone link runs on the same gateway: say why it isn't
      // starting instead of showing "Starting…" forever.
      if (!phoneLink) phoneError = `Phone connections couldn't start: ${error.message}`;
      diagnostics.record({
        level: "error",
        source: "mobile",
        code: "mobile.start_failed",
        // The reason (it can name files) shows in Settings → Your phone.
        message: "The phone gateway couldn't start, so phones can't connect",
      });
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
    tray = new Tray(trayIcon(nativeImage));
    buildTrayMenu();
    refreshTray();
    tray.on("double-click", () => showWindow());
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
// The window loads only the app's own dist/ folder over file:. Anything else
// (a file://host request above all, which is SMB and sends the NTLM hash) is
// cancelled for every frame, the sandboxed previews included; bot HTML shown
// in chat can ask for one through CSS or SVG (window-shell.cjs). The first
// block of each kind per session goes to the diagnostics log, without the URL.
function guardFileRequests() {
  const root = path.join(__dirname, "../dist");
  const logged = new Set();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const blocked = fileRequestBlocked(details.url, root);
    callback({ cancel: blocked });
    if (!blocked) return;
    const kind = /^file:\/\/[^/]/i.test(details.url) ? "network" : "local";
    if (logged.has(kind)) return;
    logged.add(kind);
    diagnostics?.record({
      level: "warn",
      source: "app",
      code: "files.request_blocked",
      message: `The window tried to load a ${kind} file and was stopped.`,
      context: { kind },
    });
    notifyRenderer();
  });
}
// A message's folders come from the coordinator (files.context, main-only:
// it is not in the renderer's `methods` allowlist).
function fileLinkService() {
  fileLinks ??= fileAccess.createFileLinks({
    inspector: fileAccess.createInspector(),
    context: async (message) => {
      await waitForReady();
      return request("files.context", { message });
    },
  });
  return fileLinks;
}
// Re-inspects the raw path for an action and throws the owner-facing reason
// when it isn't allowed; opening a folder or showing a file in its folder
// also checks the folder Explorer will draw. Refusals are logged without the
// path or message.
async function fileTarget(payload, action) {
  const links = fileLinkService();
  const { raw, ref } = await links.resolve(payload);
  const problem = fileAccess.actionProblem(ref, action, raw) || (await links.explorerProblem(ref, action));
  if (!problem) return ref;
  if (problem.record) {
    diagnostics.record({
      level: "warn",
      source: "app",
      code: "files.refused",
      message: `A file link was refused (${problem.reason}).`,
      context: { action, reason: problem.reason, ext: problem.ext || undefined },
    });
    notifyRenderer();
  }
  throw new Error(problem.message);
}
// The tray menu: Open, the Team's switch, one-hour pause and kill switch
// (desktop/team-tray.cjs), the runtime pause, and Quit. Rebuilt when the
// Team's status changes (refreshTray, after the coordinator's changes).
let trayTeam = null;
let trayRefresh = null;
// A pause ends by the clock, with no change from the coordinator, so the
// tray looks again just after it ends (trayRefreshDelay).
let trayPauseEnd = null;
function buildTrayMenu() {
  if (!tray) return;
  const team = (method, payload) =>
    request(method, payload)
      .then(() => refreshTray())
      .catch(() => {});
  tray.setContextMenu(
    Menu.buildFromTemplate([
      // showWindow's argument is the renderer sandbox flag, not the menu item.
      { label: "Open Any Bot", click: () => showWindow() },
      { type: "separator" },
      ...teamTrayItems(trayTeam, team),
      { type: "separator" },
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
  tray.setToolTip(teamTrayTooltip(trayTeam));
}
function refreshTray() {
  if (!tray || !ready) return;
  clearTimeout(trayRefresh);
  trayRefresh = setTimeout(async () => {
    try {
      const team = await request("team.get");
      clearTimeout(trayPauseEnd);
      const delay = trayRefreshDelay(team);
      if (delay !== null) {
        trayPauseEnd = setTimeout(refreshTray, delay);
        trayPauseEnd.unref?.();
      }
      if (traySignature(team) === traySignature(trayTeam)) return;
      trayTeam = team;
      buildTrayMenu();
    } catch {
      // The tray catches up on the next change.
    }
  }, 400);
  trayRefresh.unref?.();
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
// A restart scheduled after the coordinator stopped unexpectedly; a quit or
// an update install cancels it (shutdown's before()).
let restartTimer = null;
function startWorker() {
  restartTimer = null;
  if (quitting) return;
  // A coordinator restarted while an update waits for the team starts
  // holding: its first dispatch runs before it's ready for runtime.hold.
  const child = utilityProcess.fork(
    path.join(__dirname, "../runtime/worker.mjs"),
    [app.getPath("userData"), ...(installWhenIdle ? ["--hold"] : [])],
    { serviceName: "Any Bot coordinator", stdio: "pipe" },
  );
  worker = child;
  // Why this child stopped before it was ready, if it said (runtime.uncaught).
  let childReady = false,
    startupReason = null;
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
      childReady = true;
      restarts.ready();
      settleReadyWaiters();
      notifyRenderer();
      ensureSlack();
      // A restarted coordinator forgets the hold an idle install asked for.
      if (installWhenIdle) request("runtime.hold", { hold: true }).catch(() => {});
      checkIdleInstall();
      refreshTray();
      return;
    }
    if (message.type === "changed") {
      notifyRenderer();
      slackBridge?.refresh();
      checkIdleInstall();
      refreshTray();
      return;
    }
    if (message.type === "attention") {
      // A bot is waiting on the owner (an approval). Say so when the window
      // isn't in front; clicking the notification brings it back, opened at
      // the conversation (and thread) that is waiting.
      if ((!window || !window.isFocused()) && Notification.isSupported()) {
        const notice = new Notification({
          title: String(message.notice?.title || "Any Bot").slice(0, 120),
          body: String(message.notice?.body || "").slice(0, 240),
        });
        const target = navigationTarget(message.notice?.target);
        notice.on("click", () => (target ? navigate(target) : showWindow()));
        notice.show();
      }
      window?.webContents.send("anybot:changed");
      return;
    }
    if (message.type === "diagnostic") {
      if (!childReady && startupReason === null && message.entry?.code === "runtime.uncaught")
        startupReason = String(message.entry.message || "").slice(0, 600) || null;
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
    if (worker === child) worker = null;
    ready = false;
    settleReadyWaiters(new Error("Runtime interrupted"));
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error("Runtime interrupted"));
    }
    pending.clear();
    if (quitting) return;
    // Restarts are limited per burst of crashes (createRestartBudget). One
    // that couldn't start for the same reason as the start before it (a
    // workspace that can't be backed up, say) isn't restarted again: the
    // dialog says why at once (createStartupFailures).
    const reason = childReady ? null : startupReason;
    const delay = startupFailures.repeated(reason) ? null : restarts.exited();
    diagnostics?.record({
      level: "error",
      source: "runtime",
      code: "runtime.exited",
      message: `The coordinator stopped unexpectedly (exit ${code})`,
      context: { exitCode: code, restarts: restarts.count, started: childReady },
    });
    if (delay !== null) {
      restartTimer = setTimeout(startWorker, delay);
      return;
    }
    // Not a blocking dialog: Slack and the phone link keep answering (with
    // "unavailable") while it is up.
    void dialog
      .showMessageBox({
        type: "error",
        title: "Any Bot runtime stopped",
        ...stoppedDialog(reason),
        buttons: ["Restart Any Bot", "Not now"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response !== 0) return;
        app.relaunch();
        app.quit();
      });
  });
}
// Brings the window forward and asks the renderer to open `target` (ids
// from navigationTarget); App resolves them against its snapshot.
function navigate(target) {
  showWindow();
  const contents = window?.webContents;
  if (!contents) return;
  const send = () => contents.send("anybot:navigate", target);
  if (contents.isLoading()) contents.once("did-finish-load", send);
  else send();
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
    title: DISPLAY_NAME,
    icon: path.join(BRAND_DIR, 'scout-256.png'),
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
  // Right-click: Cut, Copy, Paste and Select all in text fields, Copy on a
  // selection, and web links. The renderer's own menus (file links) call
  // preventDefault, so Electron doesn't ask for this one there.
  window.webContents.on("context-menu", (_event, params) => {
    const items = contextMenuItems(params, isExternalWebUrl);
    if (!items.length) return;
    const contents = window.webContents;
    // openExternal and (in Electron 44) clipboard writes return promises; a
    // rejection here must not reach the unhandled-rejection error dialog.
    const click = {
      replace: (word) => contents.replaceMisspelling(word),
      openLink: (url) => isExternalWebUrl(url) && Promise.resolve(shell.openExternal(url)).catch(() => {}),
      copyLink: (url) => Promise.resolve(clipboard.writeText(url)).catch(() => {}),
    };
    const template = items.map(({ action, value, ...item }) => (action ? { ...item, click: () => click[action](value) } : item));
    Menu.buildFromTemplate(template).popup({ window });
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    reportStartupFailure(
      `Renderer failed to load (${errorCode})`,
      new Error(`${errorDescription} — ${validatedURL}`),
    );
  });
  window.webContents.on("did-finish-load", () => {
    windowLoaded = true;
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (quitting) return;
    if (rendererSandbox && details.reason === "launch-failed") {
      window.destroy();
      window = null;
      setTimeout(() => showWindow(false), 0);
      return;
    }
    if (!windowLoaded) {
      reportStartupFailure("Renderer process stopped", new Error(`${details.reason} (exit ${details.exitCode})`));
      return;
    }
    // After startup the window reloads (the bots, Slack and the phone link
    // never stopped: they live outside the renderer), unless it keeps
    // crashing, which a reload wouldn't fix.
    const next = rendererCrashes.next();
    diagnostics?.record({
      level: "error",
      source: "app",
      code: "renderer.gone",
      message: `Renderer process stopped: ${details.reason} (exit ${details.exitCode})`,
      context: { reason: details.reason, exitCode: details.exitCode, reloaded: next === "reload" },
    });
    if (next === "reload") {
      window.webContents.reload();
      return;
    }
    void dialog
      .showMessageBox({
        type: "error",
        title: "Any Bot's window keeps crashing",
        message: "The window stopped several times in a row.",
        detail: "Your bots are still working in the background. Restart Any Bot to reopen the window.",
        buttons: ["Restart Any Bot", "Not now"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response !== 0) return;
        app.relaunch();
        app.quit();
      });
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
// Every way out goes through here: the tray's and Settings' Quit, closing the
// window without the tray, and installing an update (installUpdate waits for
// it before starting the installer). The coordinator stops its runs itself
// and records them for the next start (runtime/coordinator.mjs).
const shutdown = createShutdown({
  worker: () => worker,
  before: () => {
    quitting = true;
    installWhenIdle = false;
    clearTimeout(restartTimer);
    restartTimer = null;
    stopUpdateChecker();
    for (const command of commands.values()) command.stop();
    void mobileGateway?.close();
    phoneLink?.stop();
    slackBridge?.stop();
    ready = false;
  },
  timeoutMs: 10000,
});
app.on("before-quit", (event) => {
  if (shutdown.stopped) return;
  event.preventDefault();
  shutdown.stop().then(() => app.quit());
});
// Phones reach this computer two ways, through one gateway:
// - Settings → Your phone: paired by QR code, through the relay, end-to-end
//   encrypted (runtime/phone-link.mjs). Needs no setup.
// - mobile-access.json: a self-hosted HTTPS listener with a TLS certificate,
//   for advanced setups (docs/mobile.md).
async function startMobileAccess() {
  const { createMobileGateway } = await import("../runtime/mobile-gateway.mjs");
  const configPath = path.join(app.getPath("userData"), "mobile-access.json");
  let config = null;
  let url = null;
  let tls = null;
  // A broken mobile-access.json turns off only the HTTPS listener it
  // configures (fail closed) and says why; phones paired by QR code still
  // connect through the same gateway.
  try {
    config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : null;
    if (config?.enabled !== true) config = null;
    if (config) {
      url = new URL(config.publicUrl);
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
      tls = { cert: fs.readFileSync(config.certPath), key: fs.readFileSync(config.keyPath) };
    }
  } catch (error) {
    config = null;
    url = null;
    tls = null;
    mobileError = `mobile-access.json couldn't be used, so the HTTPS listener is off: ${error.message}`;
    diagnostics?.record({
      level: "warn",
      source: "mobile",
      code: "mobile.config_invalid",
      message: "mobile-access.json couldn't be used, so the HTTPS phone listener is off",
    });
  }
  const gateway = createMobileGateway({
    command: request,
    serve: Boolean(config),
    host: config?.host || "127.0.0.1",
    port: config?.port || 4319,
    tls,
    onDiagnostic: (entry) => diagnostics?.record(entry),
    origins: [
      "capacitor://localhost",
      "https://localhost",
      ...(Array.isArray(config?.webOrigins) ? config.webOrigins : []),
    ],
    members: Array.isArray(config?.members) ? config.members : [],
    membersPath: path.join(app.getPath("userData"), "mobile-members.json"),
    statePath: path.join(app.getPath("userData"), "mobile-membership.json"),
    auditPath: path.join(app.getPath("userData"), "mobile-audit.jsonl"),
  });
  startPhoneLink(gateway).catch((error) => {
    phoneError = String(error.message);
  });
  if (!config) return;
  await gateway.listen();
  mobileGateway = gateway;
  mobileUrl = url.origin;
}

// The relay only ever sees encrypted frames; see relay/README.md to run
// your own. ANYBOT_RELAY_URL overrides it (tests, self-hosting).
const DEFAULT_RELAY_URL = "https://anybot-relay.anybot-desktop.workers.dev";
// Secrets at rest use Windows' own per-user encryption when available.
const protectSecret = (text) =>
  safeStorage.isEncryptionAvailable() ? `os:${safeStorage.encryptString(text).toString("base64")}` : text;
const unprotectSecret = (text) =>
  text.startsWith("os:") ? safeStorage.decryptString(Buffer.from(text.slice(3), "base64")) : text;
function computerName() {
  const user = (os.userInfo().username || "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim();
  return user ? `${user[0].toUpperCase()}${user.slice(1)}'s computer` : os.hostname();
}
// Slack starts each time the coordinator reports ready until it is running,
// so a coordinator that crashed during startup doesn't leave it off.
let slackStarting = false;
function ensureSlack() {
  if (slackBridge || slackStarting || quitting) return;
  slackStarting = true;
  startSlack()
    .then(
      () => {
        slackError = null;
      },
      (error) => {
        slackError = String(error.message);
      },
    )
    .finally(() => {
      slackStarting = false;
    });
}
async function startSlack() {
  const { createSlackBridge } = await import("../runtime/slack-bridge.mjs");
  slackBridge = createSlackBridge({
    statePath: path.join(app.getPath("userData"), "slack.json"),
    request,
    protect: protectSecret,
    unprotect: unprotectSecret,
    onDiagnostic: (entry) => diagnostics?.record(entry),
  });
  slackBridge.start();
}
function slackRequest(method, payload) {
  if (method === "slack.overview") return slackBridge ? slackBridge.overview() : {};
  const employee = String(payload.employee || "").slice(0, 100);
  if (method === "slack.status")
    return slackBridge ? slackBridge.status(employee) : { connected: false, state: slackError ? "error" : "starting", error: slackError || null };
  if (!slackBridge) throw new Error(slackError || "Slack is still starting. Try again in a moment.");
  if (!employee) throw new Error("Choose a bot first.");
  if (method === "slack.connect")
    return slackBridge.connect(employee, { botToken: payload.botToken, appToken: payload.appToken });
  if (method === "slack.pair") return slackBridge.pair(employee);
  if (method === "slack.disconnect") return slackBridge.disconnect(employee);
  if (method === "slack.removeUser") return slackBridge.removeUser(employee, String(payload.user || ""));
  throw new Error("Operation not allowed");
}
async function startPhoneLink(gateway) {
  const { createPhoneLink } = await import("../runtime/phone-link.mjs");
  phoneLink = await createPhoneLink({
    statePath: path.join(app.getPath("userData"), "phone-link.json"),
    relay: process.env.ANYBOT_RELAY_URL || DEFAULT_RELAY_URL,
    gateway,
    name: computerName(),
    protect: protectSecret,
    unprotect: unprotectSecret,
  });
  phoneLink.start();
}
