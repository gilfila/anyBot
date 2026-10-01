// Headless integration test of the real Electron utility-process transport.
// It creates no window and invokes no provider; desktop interaction is tested
// separately with the Computer plugin.
const { app, utilityProcess } = require("electron");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, writeFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const profileRoot = path.join(__dirname, "../.anybot/test-profiles");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("in-process-gpu");
mkdirSync(profileRoot, { recursive: true });
app.setPath("userData", mkdtempSync(path.join(profileRoot, "electron-")));
app.disableHardwareAcceleration();
let child, directory;
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
  child?.kill();
  if (directory)
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  app.exit(code);
}
app
  .whenReady()
  .then(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "anybot-electron-test-"));
    child = utilityProcess.fork(
      path.join(__dirname, "../runtime/worker.mjs"),
      [directory],
      { serviceName: "anyBot runtime integration test", stdio: "pipe" },
    );
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    const timeout = setTimeout(() => {
      console.error("Runtime integration test timed out");
      void finish(1);
    }, 20000);
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    child.on("exit", (code) => {
      if (code !== 0) readyReject(new Error(`Runtime exited: ${code}`));
    });
    child.on("message", (message) => {
      if (message.type === "ready") {
        readyResolve();
        return;
      }
      const call = calls.get(message.id);
      if (!call) return;
      calls.delete(message.id);
      message.error
        ? call.reject(new Error(message.error))
        : call.resolve(message.result);
    });
    try {
      await ready;
      const initial = await request("snapshot");
      assert.equal(initial.employees.length, 0);
      assert.equal(initial.harnesses.length, 5);
      const created = await request("employees.create", {
        name: "Runtime test",
        role: "Test",
        harness: "codex",
        trusted: true,
      });
      assert.equal(created.employees.length, 1);
      // The always-on team is off in a new workspace, through the real transport.
      const team = await request("team.get");
      assert.equal(team.state, "off");
      assert.equal(team.enabled, false);
      assert.equal(team.settings.concurrency, 8);
      assert.deepEqual(team.breakers, []);
      assert.equal(created.team.state, "off", "the snapshot carries it too");
      await assert.rejects(request("not-an-operation"), /Unknown/);
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.postMessage({ type: "shutdown" });
      await stopped;
      // A coordinator that can't open its workspace reports why (without the
      // path) before it exits, so the desktop's diagnostics log has it.
      const blocked = path.join(directory, "not-a-folder");
      writeFileSync(blocked, "a file, not a folder");
      const broken = utilityProcess.fork(path.join(__dirname, "../runtime/worker.mjs"), [path.join(blocked, "data")], {
        serviceName: "anyBot runtime crash test",
        stdio: "pipe",
      });
      const reports = [];
      broken.on("message", (message) => message.type === "diagnostic" && reports.push(message.entry));
      const exitCode = await new Promise((resolve) => broken.once("exit", resolve));
      assert.notEqual(exitCode, 0);
      const crash = reports.find((entry) => entry.code === "runtime.uncaught");
      assert.ok(crash, "the crash was reported");
      assert.match(crash.message, /ENOTDIR|EEXIST|not a directory|already exists/i);
      assert.ok(!`${crash.message}${crash.detail}`.includes(directory), "without the path");
      // With the coordinator's crash handlers, a rejected promise nobody
      // handled is reported and the process keeps running (Electron's own
      // default); a throw stops new work, is reported, and exits.
      const probeFile = path.join(directory, "crash-probe.mjs");
      writeFileSync(
        probeFile,
        `import { installCrashHandlers } from ${JSON.stringify(pathToFileURL(path.join(__dirname, "../runtime/diagnostics.mjs")).href)};
const port = process.parentPort;
installCrashHandlers(process, {
  report: (entry) => port.postMessage({ type: "diagnostic", entry }),
  stop: () => port.postMessage({ type: "stopped" }),
  exit: (code) => setTimeout(() => process.exit(code), 200),
});
port.on("message", ({ data }) => {
  if (data === "reject") Promise.reject(new Error("nobody waited for this"));
  if (data === "ping") port.postMessage({ type: "pong" });
  if (data === "throw") setTimeout(() => { throw new Error("thrown on purpose"); });
});
port.postMessage({ type: "ready" });
`,
      );
      const probe = utilityProcess.fork(probeFile, [], { serviceName: "anyBot crash handler test", stdio: "pipe" });
      const seen = [];
      const next = (type) =>
        new Promise((resolve) => {
          const check = () => {
            const index = seen.findIndex((m) => m.type === type);
            if (index < 0) return setTimeout(check, 20);
            resolve(seen.splice(index, 1)[0]);
          };
          check();
        });
      probe.on("message", (message) => seen.push(message));
      const probeExit = new Promise((resolve) => probe.once("exit", resolve));
      await next("ready");
      probe.postMessage("reject");
      const rejection = await next("diagnostic");
      assert.equal(rejection.entry.code, "runtime.unhandled_rejection");
      await new Promise((resolve) => setTimeout(resolve, 500));
      probe.postMessage("ping");
      await next("pong");
      probe.postMessage("throw");
      await next("stopped");
      const thrown = await next("diagnostic");
      assert.equal(thrown.entry.code, "runtime.uncaught");
      assert.equal(await probeExit, 1);
      clearTimeout(timeout);
      console.log(
        "PASS: Electron utility process startup, SQLite, harness detection, IPC creation, rejection, shutdown, crash report and unhandled rejections",
      );
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
