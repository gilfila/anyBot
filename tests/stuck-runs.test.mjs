import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { runHarness } from "../runtime/adapters.mjs";

// Seen with Codex on Windows: the harness started a helper process that
// inherited its output pipe, then exited. The helper kept the pipe open, the
// runner waited for it forever, and the bot sat on "Waiting for the harness"
// (and, once stopped, on "cancelling") until the helper was killed by hand.
test("a helper process that outlives the harness can't hold its run open", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "anybot-orphan-"));
  const pidFile = join(workspace, "helper.pid");
  const script = join(workspace, "provider.cjs");
  await writeFile(
    script,
    `const { spawn } = require("node:child_process");
    // Detached, like the Codex helper: it outlives the harness and keeps the pipes.
    const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"], detached: true });
    helper.unref();
    require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(helper.pid));
    process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }) + "\\n");
    process.exit(0);`,
  );
  t.after(async () => {
    try {
      process.kill(Number(await readFile(pidFile, "utf8")));
    } catch {
      // Already gone.
    }
    await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const started = Date.now();
  const result = await runHarness(
    { harness: "codex", workspace, prompt: "go", signal: new AbortController().signal, onText: () => {} },
    { resolve: async () => ({ file: process.execPath, prefix: [script] }), pipeGraceMs: 200 },
  );
  assert.equal(result, "done");
  assert.ok(Date.now() - started < 5000, "the run settles once the harness exits");
});

test("a stopped run whose harness never exits is released after the grace period", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-stuck-"));
  let calls = 0;
  const c = new Coordinator({
    directory,
    probe: async () => [],
    concurrency: 1,
    stuckCancelMs: 150,
    // The first run ignores cancellation completely; later runs finish.
    runner: async () => (++calls === 1 ? new Promise(() => {}) : "Second run finished"),
  });
  t.after(async () => {
    await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  await c.command("employees.create", { name: "Altman", role: "Engineer", harness: "codex", trusted: true });
  const [bot] = c.snapshot().employees;
  await c.command("conversations.create", { title: "Altman", members: [bot.id] });
  const [chat] = c.snapshot().conversations;
  const send = (body) => c.command("messages.send", { conversation: chat.id, body, recipients: [bot.id], requestId: crypto.randomUUID() });
  const until = async (check, what) => {
    const deadline = Date.now() + 5000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  await send("Start");
  await until(() => c.snapshot().runs[0]?.status === "running", "the run to start");
  await c.command("runs.cancel", { id: c.snapshot().runs[0].id });
  assert.equal(c.snapshot().runs[0].status, "cancelling");
  await until(() => c.snapshot().runs[0].status === "cancelled", "the stuck run to be released");
  assert.match(c.snapshot().runs[0].error, /didn't exit/);
  // The bot and its workspace are free again.
  await send("Again");
  await until(() => c.snapshot().runs.some((r) => r.status === "succeeded"), "the next run to finish");
});
