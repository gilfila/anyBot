// End-to-end thread collaboration on the real Electron utility process, with
// a fake harness (harnesses.json) instead of a provider CLI:
//   the owner asks Alex in a project → Alex @mentions Morgan → Morgan works in
//   the same thread and its (lean) prompt carries the thread and the mention.
//   npm run test:e2e
const { app, utilityProcess } = require("electron");
const { mkdtemp, rm, writeFile, readFile } = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
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

// The fake CLI: reads the prompt on stdin, keeps a copy per bot, and replies
// as that bot. Alex hands off to Morgan with an @mention.
const FAKE = `
let prompt = "";
process.stdin.on("data", (c) => (prompt += c));
process.stdin.on("end", () => {
  const name = /You are working in Any Bot as ([^.]+)\\./.exec(prompt)?.[1] || "unknown";
  require("node:fs").appendFileSync(require("node:path").join(__dirname, name + ".prompts"), prompt + "\\n=====\\n");
  process.stdout.write(name === "Alex" ? "Plan is ready. @Morgan please build the page from it." : "Built the page from Alex's plan.");
});
`;

function nodeExecutable() {
  if (process.env.npm_node_execpath) return process.env.npm_node_execpath;
  const finder = process.platform === "win32" ? "where" : "which";
  return execFileSync(finder, ["node"], { encoding: "utf8" }).split(/\r?\n/)[0].trim();
}

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
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  app.exit(code);
}
async function until(check, label) {
  for (let i = 0; i < 300; i++) {
    const snapshot = await request("snapshot");
    if (check(snapshot)) return snapshot;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

app
  .whenReady()
  .then(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "anybot-e2e-threads-"));
    const script = path.join(directory, "fake-cli.cjs");
    await writeFile(script, FAKE);
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
      console.error("Thread e2e timed out");
      void finish(1);
    }, 60000);
    const ready = new Promise((resolve, reject) => {
      child.on("exit", (code) => code !== 0 && reject(new Error(`Runtime exited: ${code}`)));
      child.on("message", (message) => {
        if (message.type === "ready") return resolve();
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
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.postMessage({ type: "shutdown" });
      await stopped;
      clearTimeout(timeout);
      console.log("PASS: project thread collaboration end to end (Electron utility process, fake harness, @mention hand-off)");
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
