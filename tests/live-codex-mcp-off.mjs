// Explicit opt-in provider check for the always-on team (0.3.38), not part of
// npm test: it runs the installed Codex CLI with its existing sign-in.
// Run: node tests/live-codex-mcp-off.mjs [model]
//
// MCP servers run outside Codex's sandbox, so with Team on, Any Bot refuses
// unattended Codex runs (CODEX_MCP_OFF_VERIFIED in runtime/budget.mjs) until
// it can prove they are switched off. This runs Codex twice, with and without
// `-c mcp_servers.<name>.enabled=false` for every server in ~/.codex/config.toml
// (what unattended runs pass), and asks it to call one harmless tool from
// each of those servers. The verdict comes from Codex's own --json events
// (`mcp_tool_call` items and the server each one went to), never from what
// the model says about its tools. Before flipping CODEX_MCP_OFF_VERIFIED,
// also check Codex plugins (for example a mail plugin), which are not MCP
// servers and aren't switched off by this.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { codexMcpServerNames, invocation, resolveExecutable } from "../runtime/adapters.mjs";

const model = process.argv[2];
const base = resolve(".anybot/live-tests");
await mkdir(base, { recursive: true });
const directory = await mkdtemp(join(base, "codex-mcp-off-"));
const executable = await resolveExecutable("codex");
assert.ok(executable, "Codex is installed");
const { names, skipped } = await codexMcpServerNames();
console.log("Configured MCP servers:", names, skipped.length ? `(can't be switched off by name: ${skipped.join(", ")})` : "");
assert.ok(names.length, "at least one MCP server is configured to check");

function codex(mcpOff) {
  const args = invocation("codex", model || "", "ask", undefined, { mcpOff });
  return new Promise((done, fail) => {
    const child = spawn(executable.file, [...executable.prefix, ...args], { cwd: directory, windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", fail);
    child.on("close", () => done(out));
    child.stdin.end(
      `For each of these MCP servers: ${names.join(", ")}, call exactly one of its tools that only reads or computes something harmless (for node_repl, evaluate 1+1). Don't write files or use the network. If you have no tool from a server, skip it and say so.`,
    );
  });
}
// The MCP servers Codex actually called, from its --json item events.
const called = (out) => {
  const servers = new Set();
  for (const line of out.split(/\r?\n/)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (/^item\./.test(event?.type || "") && event.item?.type === "mcp_tool_call") servers.add(String(event.item.server || "?"));
  }
  return [...servers];
};
const on = called(await codex([]));
const off = called(await codex(names));
console.log("MCP servers called with them on:", on);
console.log("MCP servers called with them switched off:", off);
assert.ok(
  on.some((server) => names.includes(server)),
  "with them on, Codex called a tool on at least one of them (otherwise this check proves nothing; run it again)",
);
assert.deepEqual(
  off.filter((server) => names.includes(server) || server === "?"),
  [],
  "with them off, no tool call reached any of them",
);
console.log("PASS: every configured MCP server was switched off. Check Codex plugins before flipping CODEX_MCP_OFF_VERIFIED.");
