import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Coordinator } from "../runtime/coordinator.mjs";
import { classifyRunError, isUnexpected } from "../runtime/diagnostics.mjs";
import { describeIssue, issueReport } from "../src/lib/diagnostics.js";
import { onRenderError, renderMarkdownInline } from "../src/lib/markdown.js";

const require = createRequire(import.meta.url);
const { DiagnosticsLog, checkPendingUpdate, rememberPendingUpdate } = require("../desktop/diagnostics.cjs");

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-diag-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const clock = (start = Date.parse("2026-09-23T10:00:00Z")) => {
  let now = start;
  const fn = () => new Date(now);
  fn.advance = (ms) => (now += ms);
  return fn;
};

test("the log writes JSON lines, redacts secrets, and groups repeats of one problem", async (t) => {
  const directory = await temp(t);
  const now = clock();
  const log = new DiagnosticsLog(directory, { version: "0.3.4", now });
  log.record({
    source: "harness",
    code: "harness.auth",
    message: "401 for run 3f2a1b4c-0000-4000-8000-000000000001 with key sk-abcdefghijklmnop1234",
    context: { employee: "Sol", nested: { dropped: true }, token: "Authorization: Bearer abc.def" },
  });
  // Same problem inside the burst window is written once.
  assert.equal(log.record({ source: "harness", code: "harness.auth", message: "401 for run 3f2a1b4c-0000-4000-8000-000000000001 with key sk-abcdefghijklmnop1234" }), null);
  now.advance(60_000);
  log.record({ source: "harness", code: "harness.auth", message: "401 for run 99999999-0000-4000-8000-000000000002 with key sk-zzzzzzzzzzzzzzzz9999" });
  log.record({ level: "warn", source: "actions", code: "actions.rejected", message: "task.update: Only assignees can move tasks" });
  log.record({ level: "info", source: "updater", code: "update.log", message: "Checking for update" });
  const lines = (await readFile(join(directory, "logs", "diagnostics.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 4);
  assert.doesNotMatch(lines[0].message, /sk-abc/);
  assert.match(lines[0].message, /\[redacted\]/);
  assert.deepEqual(lines[0].context, { employee: "Sol", token: "Authorization: Bearer [redacted]" });
  assert.equal(lines[0].version, "0.3.4");
  const groups = log.groups();
  assert.equal(groups.length, 2, "info lines are not issues; the two 401s are one problem");
  const auth = groups.find((group) => group.code === "harness.auth");
  assert.equal(auth.count, 2);
  assert.equal(auth.unseen, true);
  assert.deepEqual(log.summary(), { issues: 2, unseen: 2, errors: 1 });
  now.advance(1000);
  log.markSeen();
  assert.equal(log.summary().unseen, 0);
  now.advance(60_000);
  log.record({ source: "runtime", code: "runtime.exited", message: "The coordinator stopped unexpectedly (exit 1)" });
  assert.equal(log.summary().unseen, 1);
  // A fresh instance reads the files back, including the seen marker.
  const reopened = new DiagnosticsLog(directory, { version: "0.3.4", now });
  assert.deepEqual(reopened.summary(), { issues: 3, unseen: 1, errors: 2 });
  now.advance(1000);
  reopened.clear();
  assert.deepEqual(reopened.summary(), { issues: 0, unseen: 0, errors: 0 });
});

test("the log rotates at its size cap and keeps two older files", async (t) => {
  const directory = await temp(t);
  const now = clock();
  const log = new DiagnosticsLog(directory, { now, maxBytes: 600, burstMs: 0 });
  for (let i = 0; i < 30; i++) log.record({ source: "app", code: `test.${i}`, message: `problem ${"x".repeat(80)}` });
  assert.ok(existsSync(join(directory, "logs", "diagnostics.1.jsonl")));
  assert.ok(existsSync(join(directory, "logs", "diagnostics.2.jsonl")));
  assert.ok(!existsSync(join(directory, "logs", "diagnostics.3.jsonl")));
  const reopened = new DiagnosticsLog(directory, { now });
  const codes = reopened.entries().map((entry) => entry.code);
  assert.ok(codes.includes("test.29"));
  assert.ok(!codes.includes("test.0"), "the oldest file was dropped");
  assert.equal(new DiagnosticsLog(join(directory, "missing")).record({ message: "x" }) !== undefined, true);
});

test("an update that did not install is reported on the next start", async (t) => {
  const directory = await temp(t);
  assert.equal(checkPendingUpdate(directory, "0.3.3"), null);
  rememberPendingUpdate(directory, "0.3.3", "0.3.4");
  const failed = checkPendingUpdate(directory, "0.3.3");
  assert.equal(failed.code, "update.install_failed");
  assert.equal(failed.level, "error");
  assert.match(failed.message, /did not install/);
  assert.equal(checkPendingUpdate(directory, "0.3.3"), null, "the marker is consumed");
  rememberPendingUpdate(directory, "0.3.3", "0.3.4");
  const installed = checkPendingUpdate(directory, "0.3.4");
  assert.deepEqual([installed.code, installed.level], ["update.installed", "info"]);
  await writeFile(join(directory, "update-pending.json"), "{not json");
  assert.equal(checkPendingUpdate(directory, "0.3.4"), null);
});

test("harness errors are classified by cause", () => {
  const cases = {
    "Fable 5.1 requires usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage": "usage_limit",
    "Error: 429 Too Many Requests": "usage_limit",
    "codex is not installed or its launcher is unsupported. Open Harnesses for setup instructions.": "not_installed",
    "Run exceeded its configured 10-minute time limit": "timeout",
    "Not logged in. Please run /login": "auth",
    "Invalid API key provided": "auth",
    "Error: model 'gpt-9' not found": "model",
    "Harness exited without an assistant response. Check login and installed version.": "no_response",
    "spawn EACCES": "launch",
    "Harness exited with code 3": "exit",
  };
  for (const [message, expected] of Object.entries(cases)) assert.equal(classifyRunError(message), expected, message);
  assert.equal(isUnexpected(new TypeError("x is undefined")), true);
  assert.equal(isUnexpected(new Error("SQLITE_BUSY: database is locked")), true);
  assert.equal(isUnexpected(new Error("Title must contain 1–100 characters")), false);
  assert.equal(isUnexpected(null), false);
});

test("the coordinator reports failed runs, bad action blocks, and refused actions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-diag-"));
  let reply = () => "ok";
  const c = new Coordinator({
    directory,
    concurrency: 1,
    probe: async () => [],
    runner: async (options) => reply(options),
  });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  const seen = [];
  c.on("diagnostic", (entry) => seen.push(entry));
  await c.initialize();
  await c.command("employees.create", { name: "Sol", role: "Writer", harness: "claude", trusted: true });
  const sol = c.snapshot().employees[0];
  await c.command("conversations.create", { title: "Sol", members: [sol.id] });
  const chat = c.snapshot().conversations[0];
  const settled = async () => {
    const deadline = Date.now() + 5000;
    while (c.snapshot().runs.some((r) => ["running", "queued", "cancelling"].includes(r.status))) {
      if (Date.now() > deadline) throw new Error("Queue did not settle");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const send = async (body) => {
    await c.command("messages.send", { conversation: chat.id, body, recipients: [sol.id], requestId: crypto.randomUUID() });
    await settled();
  };
  reply = () => {
    throw new Error("Fable 5.1 requires usage credits. Switch to another model.");
  };
  await send("write");
  const failure = seen.find((entry) => entry.source === "harness");
  assert.equal(failure.code, "harness.usage_limit");
  assert.equal(failure.level, "error");
  assert.equal(failure.context.employee, "Sol");
  assert.equal(failure.context.harness, "claude");
  assert.equal(failure.context.employeeId, sol.id);
  reply = () => "Done.\n\n```anybot-actions\n[not json\n```";
  await send("update");
  assert.ok(seen.some((entry) => entry.code === "actions.invalid_block" && entry.level === "warn"));
  reply = () => 'Done.\n\n```anybot-actions\n[{"type":"memory.forget","id":"deadbeef"}]\n```';
  await send("forget");
  const refused = seen.find((entry) => entry.code === "actions.rejected");
  assert.match(refused.message, /^memory\.forget: /);
  // Cancelled runs are not problems.
  const before = seen.length;
  reply = ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Run cancelled"))));
  await c.command("messages.send", { conversation: chat.id, body: "long", recipients: [sol.id], requestId: crypto.randomUUID() });
  const run = c.snapshot().runs.find((r) => r.status === "running" || r.status === "queued");
  await c.command("runs.cancel", { id: run.id });
  await settled();
  assert.equal(seen.length, before);
});

test("issue descriptions, the copyable report, and the markdown fallback", () => {
  const issue = {
    code: "harness.usage_limit",
    level: "error",
    count: 3,
    last: "2026-09-23T10:00:00Z",
    version: "0.3.4",
    message: "Fable 5.1 requires usage credits.",
    context: { employee: "Sol", harness: "claude" },
    detail: "line 1\nline 2",
  };
  const info = describeIssue(issue);
  assert.equal(info.title, "Sol hit a usage limit on claude");
  assert.equal(info.action, "employee");
  assert.equal(describeIssue({ code: "task.settle_failed" }).bug, true);
  assert.equal(describeIssue({ code: "something.new" }).title, "something.new");
  const report = issueReport([issue], { version: "0.3.4" });
  assert.match(report, /\[error\] harness\.usage_limit x3/);
  assert.match(report, /employee=Sol harness=claude/);
  assert.match(issueReport([], { version: "0.3.4" }), /No problems recorded/);
  const errors = [];
  onRenderError((error) => errors.push(error));
  assert.equal(renderMarkdownInline("<b>ok</b> **bold**"), "&lt;b&gt;ok&lt;/b&gt; <strong>bold</strong>");
  // A value the renderer can't process falls back to escaped text and is reported.
  assert.equal(renderMarkdownInline(Symbol("odd")), "Symbol(odd)");
  assert.equal(errors.length, 1);
  onRenderError(null);
});
