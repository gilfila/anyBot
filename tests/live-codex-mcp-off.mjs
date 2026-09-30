// Explicit opt-in provider check for the always-on team (0.3.38), not part of
// npm test: it runs the installed Codex CLI with its existing sign-in.
// Run: node tests/live-codex-mcp-off.mjs [model]
//
// MCP servers run outside Codex's sandbox, so with Team on, Any Bot refuses
// unattended Codex runs (CODEX_MCP_OFF_VERIFIED in runtime/budget.mjs) until
// it can prove they are switched off. This runs Codex twice, with and without
// `-c mcp_servers.<name>.enabled=false` for every server in ~/.codex/config.toml
// (what unattended runs pass), and asks it to name the tools it has from
// those servers. Before flipping CODEX_MCP_OFF_VERIFIED, also check Codex
// plugins (for example a mail plugin), which are not MCP servers and aren't
// switched off by this.
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
      `List the exact names of every tool you can call that comes from an MCP server named ${names.join(" or ")}, one per line. If there are none, reply NONE. Do not call any tool.`,
    );
  });
}
const text = (out) =>
  out
    .split(/\r?\n/)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((e) => e?.type === "item.completed" && e.item?.type === "agent_message")
    .map((e) => e.item.text)
    .join("\n");
const on = text(await codex([]));
const off = text(await codex(names));
console.log("With the servers on:\n", on);
console.log("With them switched off:\n", off);
const mentions = (reply) => names.filter((name) => reply.toLowerCase().includes(name.toLowerCase()));
assert.ok(mentions(on).length, "with them on, Codex names their tools (otherwise this check proves nothing)");
assert.deepEqual(mentions(off), [], "with them off, none are left");
console.log("PASS: every configured MCP server was switched off. Check Codex plugins before flipping CODEX_MCP_OFF_VERIFIED.");
