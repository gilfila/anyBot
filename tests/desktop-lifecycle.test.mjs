import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  createShutdown,
  createCrashTracker,
  createRestartBudget,
  createStartupFailures,
  stoppedDialog,
  isOfflineError,
} = require("../desktop/lifecycle.cjs");
const { commandDirectory } = require("../desktop/shell-command.cjs");

// A stand-in for the coordinator's utility process.
function fakeWorker({ exits = true } = {}) {
  const worker = new EventEmitter();
  worker.messages = [];
  worker.killed = false;
  worker.postMessage = (message) => {
    worker.messages.push(message);
    if (exits && message.type === "shutdown") setTimeout(() => worker.emit("exit", 0), 5);
  };
  worker.kill = () => {
    worker.killed = true;
  };
  return worker;
}

test("every way out shuts the coordinator down once and waits for it to exit", async () => {
  const worker = fakeWorker();
  const order = [];
  const shutdown = createShutdown({ worker: () => worker, before: () => order.push("gateways stopped"), timeoutMs: 1000 });
  assert.equal(shutdown.stopped, false);
  const first = shutdown.stop();
  const second = shutdown.stop();
  assert.equal(first, second, "a second quit path joins the first");
  await first;
  order.push("installer");
  assert.deepEqual(worker.messages, [{ type: "shutdown" }], "the coordinator is asked once");
  assert.deepEqual(order, ["gateways stopped", "installer"], "the installer only starts after the coordinator exited");
  assert.equal(shutdown.stopped, true);
  assert.equal(worker.killed, false);
});

test("a coordinator that doesn't exit is killed after the timeout", async () => {
  const worker = fakeWorker({ exits: false });
  const shutdown = createShutdown({ worker: () => worker, timeoutMs: 20 });
  await shutdown.stop();
  assert.equal(worker.killed, true);
  assert.equal(shutdown.stopped, true);
  // No coordinator at all: nothing to wait for.
  const none = createShutdown({ worker: () => null });
  await none.stop();
  assert.equal(none.stopped, true);
});

test("a crashing window is reloaded, but not in an endless loop", () => {
  let now = 0;
  const crashes = createCrashTracker({ limit: 3, windowMs: 60_000, now: () => now });
  assert.equal(crashes.next(), "reload");
  now += 1000;
  assert.equal(crashes.next(), "reload");
  now += 1000;
  assert.equal(crashes.next(), "reload");
  now += 1000;
  assert.equal(crashes.next(), "give-up", "the fourth crash within a minute stops reloading");
  now += 120_000;
  assert.equal(crashes.next(), "reload", "an old crash no longer counts");
});

test("coordinator restarts are limited per burst; a stable run resets the count", () => {
  let now = 0;
  const budget = createRestartBudget({ limit: 3, stableMs: 600_000, now: () => now });
  budget.ready();
  assert.deepEqual([budget.exited(), budget.exited(), budget.exited(), budget.exited()], [1000, 2000, 3000, null]);
  const later = createRestartBudget({ limit: 3, stableMs: 600_000, now: () => now });
  for (let day = 0; day < 5; day++) {
    later.ready();
    now += 24 * 3600_000;
    assert.equal(later.exited(), 1000, "a crash days apart is a first crash again");
  }
});

test("a coordinator that can't start for the same reason twice isn't restarted again, and the dialog says why", () => {
  const failures = createStartupFailures();
  const reason =
    "Any Bot couldn't back up this workspace before upgrading it (schema 18 to 19), so it left it unchanged. Check that the disk has free space and Any Bot's data folder can be written to, then start Any Bot again. (disk full)";
  assert.equal(failures.repeated(reason), false, "the first failure is retried");
  assert.equal(failures.repeated(reason), true, "the same reason again stops the restarts");
  assert.equal(failures.repeated(null), false, "one that was running and then crashed restarts as before");
  assert.equal(failures.repeated(null), false);
  assert.equal(failures.repeated("Unsupported workspace schema. Use the matching Any Bot version."), false);
  assert.equal(failures.repeated("Something else went wrong"), false, "a different reason is retried");
  const dialog = stoppedDialog(reason);
  assert.match(dialog.message, /couldn't start/);
  assert.match(dialog.detail, /couldn't back up this workspace/);
  assert.match(dialog.detail, /Settings → Diagnostics/);
  assert.match(stoppedDialog(null).message, /failed repeatedly/);
  assert.match(stoppedDialog(null).detail, /Settings → Diagnostics/);
});

test("offline update checks are told apart from real update failures", () => {
  for (const message of ["net::ERR_INTERNET_DISCONNECTED", "net::ERR_NAME_NOT_RESOLVED", "getaddrinfo ENOTFOUND github.com", "connect ETIMEDOUT 140.82.112.3:443", "net::ERR_NETWORK_CHANGED"])
    assert.equal(isOfflineError(new Error(message)), true, message);
  assert.equal(isOfflineError({ code: "EAI_AGAIN", message: "" }), true);
  for (const message of ["sha512 checksum mismatch", "Cannot find latest.yml in the latest release artifacts", "HttpError: 404"])
    assert.equal(isOfflineError(new Error(message)), false, message);
});

test("the Terminal runs in the conversation's folder, else home, never in Any Bot's data folder", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "anybot-terminal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const userData = path.join(root, "anybot-desktop");
  await mkdir(project);
  await mkdir(path.join(userData, "logs"), { recursive: true });
  await mkdir(path.join(userData, "workspaces", "bot-1"), { recursive: true });
  const options = { home: homedir(), userData };
  assert.equal(commandDirectory(project, options), project);
  // A bot's default workspace lives in the data folder, and is fine.
  assert.equal(commandDirectory(path.join(userData, "workspaces", "bot-1"), options), path.join(userData, "workspaces", "bot-1"));
  assert.equal(commandDirectory("", options), homedir());
  assert.equal(commandDirectory("relative/path", options), homedir());
  assert.equal(commandDirectory(path.join(root, "missing"), options), homedir());
  assert.equal(commandDirectory(userData, options), homedir());
  assert.equal(commandDirectory(path.join(userData, "logs"), options), homedir());
  if (process.platform === "win32") assert.equal(commandDirectory(userData.toUpperCase(), options), homedir());
  assert.equal(commandDirectory(path.join(project, "..", "anybot-desktop"), options), homedir());
  // main.cjs spawns with it and never with userData.
  const main = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  const handler = main.slice(main.indexOf('"anybot:runCommand"'), main.indexOf('"anybot:stopCommand"'));
  assert.ok(handler.includes("commandDirectory("), "runCommand resolves its folder with commandDirectory");
  assert.ok(!/cwd:\s*app\.getPath\("userData"\)/.test(handler), "never the data folder");
});

test("installing an update and Settings Quit go through the graceful shutdown", async () => {
  const main = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  const install = main.slice(main.indexOf("async function installUpdate"), main.indexOf("function dismissUpdate"));
  assert.ok(install.includes("await shutdown.stop()"), "installUpdate waits for the coordinator");
  assert.ok(install.indexOf("await shutdown.stop()") < install.indexOf("quitAndInstall(true, true)"), "before the installer starts");
  const quit = main.slice(main.indexOf('method === "app.quit"'), main.indexOf('method === "app.quit"') + 300);
  assert.ok(!/quitting = true/.test(quit), "Settings Quit doesn't skip the shutdown");
  const beforeQuit = main.slice(main.indexOf('app.on("before-quit"'), main.indexOf('app.on("before-quit"') + 400);
  assert.ok(beforeQuit.includes("shutdown.stop()"), "before-quit shuts down the same way");
});
