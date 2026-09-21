// Headless integration test of the real Electron utility-process transport.
// It creates no window and invokes no provider; desktop interaction is tested
// separately with the Computer plugin.
const { app, utilityProcess } = require("electron");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync } = require("node:fs");
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
      await assert.rejects(request("not-an-operation"), /Unknown/);
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.postMessage({ type: "shutdown" });
      await stopped;
      clearTimeout(timeout);
      console.log(
        "PASS: Electron utility process startup, SQLite, harness detection, IPC creation, rejection and shutdown",
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
