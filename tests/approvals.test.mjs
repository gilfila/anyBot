import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { Coordinator } from "../runtime/coordinator.mjs";
import { SCHEMA_VERSION, Store } from "../runtime/store.mjs";
import { summarize } from "../runtime/approvals.mjs";

// What the bridge does: POST the request with the run's token, wait.
async function ask(configPath, body, token) {
  const config = JSON.parse(await readFile(configPath, "utf8")).mcpServers.anybot;
  const response = await fetch(`${config.env.ANYBOT_APPROVAL_URL}approve`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token ?? config.env.ANYBOT_APPROVAL_TOKEN}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, answer: await response.json() };
}

async function fixture(t, runner) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-approvals-"));
  const c = new Coordinator({ directory, concurrency: 1, probe: async () => [], runner });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  await c.command("employees.create", { name: "Sol", role: "Writer", harness: "claude", trusted: true });
  const sol = c.snapshot().employees[0];
  await c.command("conversations.create", { title: "Sol", members: [sol.id] });
  const chat = c.snapshot().conversations[0];
  const send = (body) =>
    c.command("messages.send", { conversation: chat.id, body, recipients: [sol.id], requestId: crypto.randomUUID() });
  const until = async (check, what) => {
    const deadline = Date.now() + 30000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  return { c, sol, chat, send, until, directory };
}

test("a Claude run waits on the owner's answer, and the chat records it", async (t) => {
  const answers = [];
  let options;
  const { c, sol, chat, send, until } = await fixture(t, async (opts) => {
    options = opts;
    // A forged token is refused outright.
    const forged = await ask(opts.approvals.configPath, { tool_name: "Bash", input: { command: "ls" } }, "0".repeat(64));
    answers.push(forged.status);
    const first = await ask(opts.approvals.configPath, { tool_name: "Bash", input: { command: "rm -rf build", description: "clean" } });
    const second = await ask(opts.approvals.configPath, { tool_name: "Write", input: { file_path: "C:/outside/notes.md", content: "x" } });
    answers.push(first.answer, second.answer);
    return "Done.";
  });
  const attention = [];
  c.on("attention", (notice) => attention.push(notice));
  await send("Clean the build folder");
  await until(() => c.snapshot().approvals.some((a) => a.status === "pending"), "the first request");
  // The run got an approval bridge and auto mode.
  assert.equal(options.permissionMode, "auto");
  const config = JSON.parse(await readFile(options.approvals.configPath, "utf8")).mcpServers.anybot;
  assert.equal(config.env.ELECTRON_RUN_AS_NODE, "1");
  assert.match(config.args[0], /approval-mcp\.mjs$/);
  assert.match(config.env.ANYBOT_APPROVAL_TOKEN, /^[0-9a-f]{64}$/);
  const pending = c.snapshot().approvals.find((a) => a.status === "pending");
  assert.deepEqual([pending.tool, pending.summary, pending.employee, pending.conversation], ["Bash", "rm -rf build", sol.id, chat.id]);
  assert.deepEqual(attention, [{ title: "Sol needs your approval", body: "Bash: rm -rf build" }]);
  await c.command("approvals.decide", { id: pending.id, decision: "allow" });
  await until(() => c.snapshot().approvals.filter((a) => a.status === "pending").length === 1 && c.snapshot().approvals.length === 2, "the second request");
  const second = c.snapshot().approvals.find((a) => a.status === "pending");
  await c.command("approvals.decide", { id: second.id, decision: "deny" });
  await until(() => c.snapshot().runs.every((r) => r.status === "succeeded"), "the run");
  assert.deepEqual(answers, [403, { behavior: "allow" }, { behavior: "deny", message: "The owner declined this action." }]);
  const notices = c.snapshot().messages.filter((m) => m.kind === "notice").map((m) => m.body);
  assert.ok(notices.includes("You approved Sol's request (Bash: rm -rf build)."));
  assert.ok(notices.includes("You declined Sol's request (Write: C:/outside/notes.md)."));
  await assert.rejects(c.command("approvals.decide", { id: second.id, decision: "allow" }), /already answered/);
  await assert.rejects(c.command("approvals.decide", { id: "nope", decision: "allow" }), /not found/);
  // The token died with the run, and its config file is gone.
  assert.equal(existsSync(options.approvals.configPath), false);
});

test("requests are declined when nobody answers or the run ends", async (t) => {
  let release;
  const outcomes = [];
  const { c, send, until } = await fixture(t, async (opts) => {
    c.approvals.timeoutMs = 60;
    outcomes.push((await ask(opts.approvals.configPath, { tool_name: "Bash", input: { command: "git push --force" } })).answer);
    // Now wait for a request the run will abandon.
    const abandoned = ask(opts.approvals.configPath, { tool_name: "Bash", input: { command: "del *.log" } });
    c.approvals.timeoutMs = 60_000;
    await new Promise((resolve) => (release = resolve));
    return "Stopped.";
  });
  await send("Push it");
  await until(() => release, "the run to park");
  assert.deepEqual(outcomes, [{ behavior: "deny", message: "Nobody answered in time." }]);
  await until(() => c.snapshot().approvals.some((a) => a.status === "pending"), "the second request");
  release();
  await until(() => c.snapshot().runs.every((r) => r.status === "succeeded"), "the run");
  const statuses = c.snapshot().approvals.map((a) => a.status);
  assert.deepEqual(statuses, ["expired", "cancelled"]);
  const notices = c.snapshot().messages.filter((m) => m.kind === "notice").map((m) => m.body);
  assert.ok(notices.some((body) => /expired without an answer/.test(body)));
  assert.ok(notices.some((body) => /withdrawn when the run ended/.test(body)));
});

test("other harnesses get no approval bridge", async (t) => {
  const seen = [];
  const { c, chat, send, until } = await fixture(t, async (opts) => {
    seen.push([opts.harness, Boolean(opts.approvals)]);
    return "ok";
  });
  await c.command("employees.create", { name: "Cody", role: "Engineer", harness: "codex", trusted: true });
  const cody = c.snapshot().employees.find((e) => e.name === "Cody");
  await c.command("conversations.create", { title: "Cody", members: [cody.id] });
  const codyChat = c.snapshot().conversations.find((x) => x.id !== chat.id);
  await c.command("messages.send", { conversation: codyChat.id, body: "hi", recipients: [cody.id], requestId: crypto.randomUUID() });
  await send("hi");
  await until(() => seen.length === 2 && c.snapshot().runs.every((r) => r.status === "succeeded"), "both runs");
  assert.deepEqual(seen.sort(), [["claude", true], ["codex", false]]);
});

test("the bridge speaks MCP over stdio and forwards to the approval URL", async (t) => {
  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ auth: req.headers.authorization, body: JSON.parse(body) });
      res.end(JSON.stringify(received.length === 1 ? { behavior: "allow" } : { behavior: "deny", message: "No." }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const child = spawn(process.execPath, ["runtime/approval-mcp.mjs"], {
    env: { ...process.env, ANYBOT_APPROVAL_URL: `http://127.0.0.1:${server.address().port}/`, ANYBOT_APPROVAL_TOKEN: "t0ken" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  const replies = [];
  lines.on("line", (line) => replies.push(JSON.parse(line)));
  const call = async (message) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    const deadline = Date.now() + 30000;
    while (!replies.some((reply) => reply.id === message.id)) {
      if (Date.now() > deadline) throw new Error(`No reply to ${message.method}`);
      await new Promise((r) => setTimeout(r, 10));
    }
    return replies.find((reply) => reply.id === message.id);
  };
  const init = await call({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.result.serverInfo.name, "anybot");
  assert.equal(init.result.protocolVersion, "2025-06-18");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const tools = await call({ id: 2, method: "tools/list" });
  assert.deepEqual(tools.result.tools.map((tool) => tool.name), ["approve"]);
  const allowed = await call({ id: 3, method: "tools/call", params: { name: "approve", arguments: { tool_name: "Bash", input: { command: "ls" } } } });
  assert.deepEqual(JSON.parse(allowed.result.content[0].text), { behavior: "allow", updatedInput: { command: "ls" } });
  const denied = await call({ id: 4, method: "tools/call", params: { name: "approve", arguments: { tool_name: "Bash", input: { command: "rm x" } } } });
  assert.deepEqual(JSON.parse(denied.result.content[0].text), { behavior: "deny", message: "No." });
  assert.deepEqual(received.map((r) => [r.auth, r.body.tool_name]), [["Bearer t0ken", "Bash"], ["Bearer t0ken", "Bash"]]);
  const unknown = await call({ id: 5, method: "tools/call", params: { name: "other", arguments: {} } });
  assert.match(unknown.error.message, /Unknown tool/);
});

test("summaries show the command, file, or address", () => {
  assert.equal(summarize("Bash", { command: "rm   -rf\n build", description: "x" }), "rm -rf build");
  assert.equal(summarize("Write", { file_path: "C:/a/b.md", content: "..." }), "C:/a/b.md");
  assert.equal(summarize("WebFetch", { url: "https://example.com", prompt: "read" }), "https://example.com");
  assert.equal(summarize("mcp__x__y", { a: 1 }), '{"a":1}');
});

test("schema 12 moves bots that could only be denied to auto mode", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-approvals-migrate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = new Store(directory);
  first.run("UPDATE metadata SET value='11' WHERE key='schema'");
  first.db.exec("DROP TABLE approvals");
  first.run(
    "INSERT INTO employees(id,name,role,harness,instructions,workspace,trusted,created,permissionMode) VALUES ('a','A','r','claude','i','w',1,'2026-09-23','ask'),('b','B','r','claude','i','w',1,'2026-09-23','dontAsk')",
  );
  first.close();
  const store = new Store(directory);
  assert.deepEqual(store.all("SELECT id,permissionMode FROM employees ORDER BY id").map((e) => [e.id, e.permissionMode]), [
    ["a", "auto"],
    ["b", "dontAsk"],
  ]);
  assert.equal(store.one("SELECT value FROM metadata WHERE key='schema'").value, String(SCHEMA_VERSION));
  store.close();
  void DatabaseSync;
});
