import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Coordinator } from "../runtime/coordinator.mjs";
import { createAgent, messageFor, parsePrompt } from "../runtime/anybot-acp.mjs";

const CHANNEL = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EVENT = "a".repeat(64);
const EVENT2 = "b".repeat(64);
const ROOT = "c".repeat(64);
const section = (tag, content, attrs = "") => `<${tag}${attrs}>\n${content}\n</${tag}>`;
const eventBlock = (id, content, from = "Tony") =>
  `Event ID: ${id}\nChannel: launch (#${CHANNEL})\nKind: 9\nFrom: ${from} (npub: npub1xyz, hex: ${"d".repeat(64)})\nTime: 2026-09-28T10:00:00Z\nContent: ${content}\nTags: [["p","${"e".repeat(64)}"]]`;

// The shape buzz-acp builds (crates/buzz-acp/src/queue.rs).
const channelPrompt = [
  {
    type: "text",
    text: section(
      "context",
      `Scope: channel\nSession scope: channel\nChannel: launch (#${CHANNEL})\nHint: Use \`buzz messages get --channel ${CHANNEL}\` for recent messages if needed.\nIMPORTANT: This is a new top-level message. For ordinary replies in this turn, use \`--reply-to ${EVENT}\` on \`buzz messages send\`.`,
    ),
  },
  { type: "text", text: section("buzz-event", eventBlock(EVENT, "@Sol plan the launch\nTags: in my text too"), ' type="@mention"') },
];

test("parsePrompt reads the channel, reply target and message from a buzz-acp prompt", () => {
  const parsed = parsePrompt(channelPrompt.map((b) => b.text).join("\n"));
  assert.equal(parsed.channel, CHANNEL);
  assert.equal(parsed.channelName, "launch");
  assert.equal(parsed.replyTo, EVENT);
  assert.equal(parsed.events.length, 1);
  assert.deepEqual(parsed.events[0], { id: EVENT, channel: `launch (#${CHANNEL})`, from: "Tony", content: "@Sol plan the launch\nTags: in my text too" });
  const body = messageFor(parsed, "");
  assert.match(body, /^Tony: @Sol plan the launch/);
  assert.match(body, /Tony: @Sol plan the launch/);
  assert.doesNotMatch(body, /buzz messages send/);
});

test("in a thread, replies go to the thread root; batched events are all kept", () => {
  const text = [
    section("context", `Scope: thread\nChannel: launch (#${CHANNEL})\nThread root: ${ROOT}`),
    section("thread-context", "Tony: kickoff"),
    section(
      "buzz-events",
      `--- Event 1 (@mention) ---\n${eventBlock(EVENT, "first")}\n--- Event 2 (@mention) ---\n${eventBlock(EVENT2, "second", "Ana")}`,
      ' count="2"',
    ),
  ].join("\n");
  const parsed = parsePrompt(text);
  assert.equal(parsed.replyTo, ROOT);
  assert.deepEqual(parsed.events.map((e) => [e.from, e.content]), [["Tony", "first"], ["Ana", "second"]]);
  assert.match(messageFor(parsed, text), /Earlier in the thread:\nTony: kickoff/);
});

function harness(options) {
  const lines = [];
  const agent = createAgent({ write: (line) => lines.push(JSON.parse(line)), ...options });
  const call = async (id, method, params) => {
    await agent.handle({ jsonrpc: "2.0", id, method, params });
    return lines.find((l) => l.id === id);
  };
  return { agent, lines, call };
}

test("the ACP handshake and a prompt: reply posted to the thread, turn ends", async () => {
  const posts = [];
  const asks = [];
  const { lines, call } = harness({
    env: { BUZZ_ACP_DISPLAY_NAME: "Sol" },
    ask: async (body, { onEvent }) => {
      asks.push(body);
      onEvent({ type: "approval", tool: "Bash", summary: "rm -rf build" });
      return { type: "result", status: "succeeded", reply: "Plan attached.", error: "" };
    },
    post: async (message) => posts.push(message),
  });
  const init = await call(0, "initialize", { protocolVersion: 2, clientCapabilities: {} });
  assert.equal(init.result.protocolVersion, 2);
  const { result: session } = await call(1, "session/new", { cwd: "C:/", mcpServers: [] });
  assert.equal(typeof session.sessionId, "string");
  const done = await call(2, "session/prompt", { sessionId: session.sessionId, prompt: channelPrompt });
  assert.deepEqual(done.result, { stopReason: "end_turn" });
  assert.equal(asks[0].employee, "Sol");
  assert.equal(asks[0].channel, "#launch");
  assert.match(asks[0].requestId, /^[0-9a-f]{40}$/);
  // The approval notice names no command; the reply goes to the event.
  assert.deepEqual(posts, [
    { channel: CHANNEL, replyTo: EVENT, content: "Waiting for my owner to approve a step before I continue." },
    { channel: CHANNEL, replyTo: EVENT, content: "Plan attached." },
  ]);
  assert.ok(lines.some((l) => l.method === "session/update" && l.params.update.sessionUpdate === "keepalive"));
  assert.equal((await call(3, "fs/read_text_file", {})).error.code, -32601);
});

test("failures become a notice in Buzz, not a JSON-RPC error buzz-acp would retry", async () => {
  const posts = [];
  const { call } = harness({
    env: { ANYBOT_EMPLOYEE: "Sol" },
    ask: async () => {
      throw new Error("anyBot isn't running, or its Buzz bridge is off (Settings → Buzz bridge).");
    },
    post: async (message) => posts.push(message),
  });
  const { result } = await call(1, "session/new", {});
  const done = await call(2, "session/prompt", { sessionId: result.sessionId, prompt: channelPrompt });
  assert.deepEqual(done.result, { stopReason: "end_turn" });
  assert.match(posts[0].content, /^⚠️ anyBot isn't running/);
});

test("session/cancel stops the wait and the turn ends cancelled", async () => {
  const posts = [];
  let aborted = false;
  const { agent, lines } = harness({
    env: { ANYBOT_EMPLOYEE: "Sol" },
    ask: (body, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        }),
      ),
    post: async (message) => posts.push(message),
  });
  await agent.handle({ id: 1, method: "session/new", params: {} });
  const sessionId = lines[0].result.sessionId;
  const turn = agent.handle({ id: 2, method: "session/prompt", params: { sessionId, prompt: channelPrompt } });
  await agent.handle({ method: "session/cancel", params: { sessionId } });
  await turn;
  assert.equal(aborted, true);
  assert.deepEqual(lines.find((l) => l.id === 2).result, { stopReason: "cancelled" });
  assert.deepEqual(posts, []);
});

test("end to end: anybot-acp over stdio asks a real anyBot bridge", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-acp-"));
  const c = new Coordinator({ directory, concurrency: 1, probe: async () => [], runner: async (opts) => `Echo: ${opts.prompt.includes("plan the launch")}` });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  await c.command("employees.create", { name: "Sol", role: "Writer", harness: "claude", trusted: true });
  await c.command("buzz.set", { enabled: true });
  // A fake `buzz` CLI: records what would be posted.
  const posted = join(directory, "posted.txt");
  // Spawned without a shell, so node itself is the CLI and the script its first arg.
  const script = join(directory, "buzz.mjs");
  await writeFile(
    script,
    `import { appendFileSync } from "node:fs"; let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>appendFileSync(${JSON.stringify(posted)}, JSON.stringify({args:process.argv.slice(2),content:s})+"\\n"));`,
  );
  const child = spawn(process.execPath, [fileURLToPath(new URL("../runtime/anybot-acp.mjs", import.meta.url))], {
    env: { ...process.env, ANYBOT_DATA: directory, ANYBOT_EMPLOYEE: "Sol", ANYBOT_BUZZ_CLI: process.execPath, ANYBOT_BUZZ_CLI_ARGS: script },
    stdio: ["pipe", "pipe", "inherit"],
  });
  t.after(() => child.kill());
  const responses = new Map();
  const waiting = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id === undefined) return;
    responses.set(message.id, message);
    waiting.get(message.id)?.(message);
  });
  const call = (id, method, params) =>
    new Promise((resolve) => {
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  assert.equal((await call(0, "initialize", { protocolVersion: 2 })).result.protocolVersion, 2);
  const { result } = await call(1, "session/new", { cwd: directory, mcpServers: [] });
  const done = await call(2, "session/prompt", { sessionId: result.sessionId, prompt: channelPrompt });
  assert.deepEqual(done.result, { stopReason: "end_turn" });
  const post = JSON.parse((await readFile(posted, "utf8")).trim());
  assert.deepEqual(post.args, ["messages", "send", "--channel", CHANNEL, "--content", "-", "--reply-to", EVENT]);
  assert.equal(post.content, "Echo: true");
  assert.ok(c.snapshot().messages.some((m) => m.body.startsWith("[Buzz #launch] Tony: @Sol plan the launch")));
});
