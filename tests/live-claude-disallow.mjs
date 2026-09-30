// Explicit opt-in provider check for the always-on team (0.3.38), not part of
// npm test: it runs the installed Claude Code with its existing sign-in.
// Run: node tests/live-claude-disallow.mjs [model]   (default: haiku)
//
// It starts a tiny local MCP server ("smoke", tools send_note and read_note)
// and checks what unattended runs rely on:
//   A. --disallowedTools with an exact tool name removes that one tool;
//   B. --disallowedTools with a server name (mcp__smoke) removes all of its tools;
//   C. a disallowed tool can't be called even when the prompt asks for it;
//   D. ENABLE_CLAUDEAI_MCP_SERVERS=false: the claude.ai connectors the run
//      would otherwise load (the init event's MCP server list, printed).
// Each run prints its init event's tool list. Nothing leaves this computer
// except the prompts, which name no data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveExecutable } from "../runtime/adapters.mjs";

const model = process.argv[2] || "haiku";
const base = resolve(".anybot/live-tests");
await mkdir(base, { recursive: true });
const directory = await mkdtemp(join(base, "claude-disallow-"));
const server = join(directory, "smoke-mcp.mjs");
await writeFile(
  server,
  `import { createInterface } from "node:readline";
const tools = [
  { name: "send_note", description: "Sends a note (a stand-in for an outward tool).", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  { name: "read_note", description: "Reads the note.", inputSchema: { type: "object", properties: {} } },
];
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "initialize") reply(message.id, { protocolVersion: message.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "smoke", version: "1.0.0" } });
  else if (message.method === "tools/list") reply(message.id, { tools });
  else if (message.method === "tools/call") reply(message.id, { content: [{ type: "text", text: message.params?.name === "send_note" ? "SENT" : "NOTE" }] });
  else if (message.id !== undefined) reply(message.id, {});
});
`,
);
const config = join(directory, "mcp.json");
await writeFile(config, JSON.stringify({ mcpServers: { smoke: { command: process.execPath, args: [server] } } }));
const executable = await resolveExecutable("claude");
assert.ok(executable, "Claude Code is installed");

function claude(args, prompt, env = {}) {
  return new Promise((done, fail) => {
    const child = spawn(executable.file, [...executable.prefix, "-p", "--output-format", "stream-json", "--verbose", "--model", model, "--max-turns", "3", ...args], {
      cwd: directory,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", fail);
    child.on("close", () => {
      const events = out
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      done(events);
    });
    child.stdin.end(prompt);
  });
}
const init = (events) => events.find((e) => e.type === "system" && e.subtype === "init") || {};
// A run that failed before the model answered (for example an expired
// sign-in) proves nothing about what the model could call.
const failedRun = (events) => {
  const result = events.find((e) => e.type === "result");
  return result?.is_error ? String(result.result || "failed").slice(0, 160) : "";
};
const inconclusive = [];
const smokeTools = (events) => (init(events).tools || []).filter((name) => String(name).startsWith("mcp__smoke"));
const LIST = "Do not call any tool. Reply with the word DONE.";
const strict = ["--mcp-config", config, "--strict-mcp-config"];

const plain = await claude(strict, LIST);
console.log("Without a block, smoke tools:", smokeTools(plain));
assert.deepEqual(smokeTools(plain).sort(), ["mcp__smoke__read_note", "mcp__smoke__send_note"], "the smoke server loaded");

const exact = await claude([...strict, "--disallowedTools", "mcp__smoke__send_note"], LIST);
console.log("A. Blocking mcp__smoke__send_note, smoke tools:", smokeTools(exact));
assert.deepEqual(smokeTools(exact), ["mcp__smoke__read_note"], "an exact-name block removes only that tool");

const whole = await claude([...strict, "--disallowedTools", "mcp__smoke"], LIST);
console.log("B. Blocking mcp__smoke, smoke tools:", smokeTools(whole));
assert.deepEqual(smokeTools(whole), [], "a server-level block removes all of its tools");

const asked = await claude(
  [...strict, "--disallowedTools", "mcp__smoke__send_note", "--permission-mode", "default"],
  "Call the tool mcp__smoke__send_note with text 'hi', then reply with what it returned, or NOT AVAILABLE if you can't.",
);
const sent = asked.some((e) => e.type === "user" && JSON.stringify(e).includes("SENT"));
if (failedRun(asked)) {
  inconclusive.push("C");
  console.log("C. INCONCLUSIVE: the run failed before the model answered:", failedRun(asked));
} else {
  console.log("C. Asked to call the blocked tool; it ran:", sent, "| reply:", String(asked.find((e) => e.type === "result")?.result || "").slice(0, 120));
  assert.equal(sent, false, "the blocked tool never ran");
}

const connectors = await claude([], LIST, { ENABLE_CLAUDEAI_MCP_SERVERS: "false" });
const loaded = await claude([], LIST);
const servers = (events) => (init(events).mcp_servers || []).map((s) => `${s.name} (${s.status})`);
console.log("D. MCP servers with ENABLE_CLAUDEAI_MCP_SERVERS=false:", servers(connectors));
console.log("   MCP servers by default:", servers(loaded));
console.log("   Tools by default:", (init(loaded).tools || []).filter((name) => String(name).startsWith("mcp__")).length, "MCP tools");
if (failedRun(loaded)) {
  inconclusive.push("D");
  console.log("D. INCONCLUSIVE: claude.ai connectors load only for a signed-in run, and this one failed:", failedRun(loaded));
}
console.log(
  inconclusive.length
    ? `PASS for A and B (exact-name and server-level --disallowedTools); ${inconclusive.join(" and ")} inconclusive, see above. Sign in to Claude Code (claude /login) and run again.`
    : "PASS: exact-name and server-level --disallowedTools work, a blocked tool can't be called; see D for the claude.ai connector switch.",
);
