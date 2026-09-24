// What a bot's harness CLI is doing, as a terminal would show it: the
// command, each tool call and its output, the model's text, stderr, and the
// exit. One append-only log file per run under <workspace>/terminal/, read
// by the Activity page in chunks from a byte offset (runs.terminal).
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 4 * 1024 * 1024;
const READ_BYTES = 256 * 1024;
const KEEP_LOGS = 300;

export class TerminalLog {
  constructor(directory) {
    this.dir = join(directory, "terminal");
    mkdirSync(this.dir, { recursive: true });
    this.sizes = new Map();
  }
  file(runId) {
    if (!/^[\w-]{1,100}$/.test(String(runId))) throw new Error("Invalid run ID");
    return join(this.dir, `${runId}.log`);
  }
  size(runId) {
    if (!this.sizes.has(runId)) {
      const file = this.file(runId);
      this.sizes.set(runId, existsSync(file) ? statSync(file).size : 0);
    }
    return this.sizes.get(runId);
  }
  append(runId, text) {
    if (!text) return;
    const size = this.size(runId);
    if (size >= MAX_BYTES) return;
    let chunk = Buffer.from(String(text), "utf8");
    if (size + chunk.length > MAX_BYTES)
      chunk = Buffer.concat([chunk.subarray(0, Math.max(0, MAX_BYTES - size - 64)), Buffer.from("\n[terminal log limit reached]\n")]);
    appendFileSync(this.file(runId), chunk);
    this.sizes.set(runId, size + chunk.length);
  }
  // From `offset` on, at most READ_BYTES. A first read (offset 0) of a long
  // log starts at its tail, on a line boundary.
  read(runId, offset = 0) {
    const file = this.file(runId);
    if (!existsSync(file)) return { text: "", offset: 0, size: 0, skipped: 0 };
    const size = statSync(file).size;
    let start = Number.isInteger(offset) && offset >= 0 && offset <= size ? offset : 0;
    let skipped = 0;
    if (start === 0 && size > READ_BYTES) skipped = start = size - READ_BYTES;
    const end = Math.min(size, start + READ_BYTES);
    const buffer = Buffer.alloc(end - start);
    const fd = openSync(file, "r");
    try {
      readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      closeSync(fd);
    }
    let text = buffer.toString("utf8");
    if (skipped) text = text.slice(text.indexOf("\n") + 1);
    return { text, offset: end, size, skipped };
  }
  // Keep the newest logs only.
  prune(keep = KEEP_LOGS) {
    const logs = readdirSync(this.dir)
      .filter((name) => name.endsWith(".log"))
      .map((name) => ({ name, time: statSync(join(this.dir, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const { name } of logs.slice(keep)) {
      try {
        unlinkSync(join(this.dir, name));
      } catch {
        // A log still being written is kept.
      }
    }
  }
}

const clip = (text, max = 200) => {
  const value = String(text ?? "").replace(/\s+$/, "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
// Tool output: the first few lines, indented under the call.
const output = (text, lines = 6) => {
  const all = String(text ?? "").replace(/\r/g, "").split("\n").filter((line, i, list) => line || i < list.length - 1);
  if (!all.length || (all.length === 1 && !all[0])) return "  ⎿ (no output)\n";
  const shown = all.slice(0, lines).map((line, i) => `${i ? "    " : "  ⎿ "}${clip(line)}`);
  if (all.length > lines) shown.push(`    … +${all.length - lines} lines`);
  return `${shown.join("\n")}\n`;
};
const resultText = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("\n")
      : "";
// The one argument that says what a tool call is about.
function toolSummary(name, input = {}) {
  const pick =
    input.command ?? input.cmd ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt;
  const value = pick !== undefined ? (Array.isArray(pick) ? pick.join(" ") : pick) : JSON.stringify(input);
  return `⏺ ${name}(${clip(value, 160)})\n`;
}
const tokens = (usage = {}) => {
  const input = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  const out = usage.output_tokens || 0;
  return input || out ? ` · ${input.toLocaleString("en-US")} in / ${out.toLocaleString("en-US")} out tokens` : "";
};
const seconds = (ms) => (ms ? ` · ${Math.round(ms / 100) / 10}s` : "");

// One structured harness event as terminal text ("" when it's noise).
export function formatEvent(harness, event) {
  if (!event || typeof event !== "object") return "";
  if (harness === "claude" || harness === "cursor") {
    if (event.type === "system" && event.subtype === "init")
      return `● Session started${event.model ? ` · ${event.model}` : ""}${event.cwd ? ` · ${event.cwd}` : ""}\n`;
    if (event.type === "assistant")
      return (event.message?.content || [])
        .map((part) =>
          part.type === "text" && part.text?.trim()
            ? `${part.text.trim()}\n`
            : part.type === "tool_use"
              ? toolSummary(part.name, part.input)
              : part.type === "thinking"
                ? "✻ Thinking…\n"
                : "",
        )
        .join("");
    if (event.type === "user")
      return (event.message?.content || [])
        .filter((part) => part.type === "tool_result")
        .map((part) => (part.is_error ? output(`Error: ${resultText(part.content)}`) : output(resultText(part.content))))
        .join("");
    if (event.type === "tool_call" && event.subtype === "started") {
      const [name, call] = Object.entries(event.tool_call || {})[0] || [];
      return name ? toolSummary(name.replace(/ToolCall$/, ""), call?.args) : "";
    }
    if (event.type === "result")
      return `${event.is_error ? "✖ Failed" : "✔ Done"}${event.num_turns ? ` · ${event.num_turns} turns` : ""}${seconds(event.duration_ms)}${event.total_cost_usd ? ` · $${event.total_cost_usd.toFixed(2)}` : ""}${tokens(event.usage)}\n`;
    return "";
  }
  if (harness === "codex") {
    const item = event.item || {};
    if (event.type === "thread.started") return `● Session started${event.thread_id ? ` · ${event.thread_id}` : ""}\n`;
    if (event.type === "item.started" && item.type === "command_execution") return `⏺ Shell(${clip(item.command, 160)})\n`;
    if (event.type === "item.completed") {
      if (item.type === "command_execution")
        return `${output(item.aggregated_output)}${item.exit_code ? `    exit ${item.exit_code}\n` : ""}`;
      if (item.type === "agent_message") return `${String(item.text || "").trim()}\n`;
      if (item.type === "reasoning") return "✻ Thinking…\n";
      if (item.type === "file_change")
        return (item.changes || []).map((change) => `⏺ ${change.kind === "add" ? "Create" : change.kind === "delete" ? "Delete" : "Edit"}(${change.path})\n`).join("");
      if (item.type === "mcp_tool_call") return `⏺ ${item.server || "mcp"}.${item.tool || "tool"}\n`;
      if (item.type === "web_search") return `⏺ WebSearch(${clip(item.query, 160)})\n`;
      // Before the turn these are warnings; a failure ends with turn.failed.
      if (item.type === "error") return `⚠ ${item.message || "Warning"}\n`;
    }
    if (event.type === "turn.completed") return `✔ Turn done${tokens(event.usage)}\n`;
    if (event.type === "turn.failed" || event.type === "error") return `✖ ${event.error?.message || event.message || "Failed"}\n`;
    return "";
  }
  if (harness === "gemini") {
    if (event.type === "init") return `● Session started${event.model ? ` · ${event.model}` : ""}\n`;
    if (event.type === "message" && event.role === "assistant")
      return event.delta ? String(event.content || "") : `${String(event.content || "").trim()}\n`;
    if (event.type === "tool_use") return toolSummary(event.tool_name || "tool", event.parameters);
    if (event.type === "tool_result") return output(event.output ?? event.error?.message ?? "");
    if (event.type === "result")
      return `${event.status === "error" ? "✖ Failed" : "✔ Done"}${seconds(event.stats?.duration_ms)}${tokens({ input_tokens: event.stats?.input_tokens, output_tokens: event.stats?.output_tokens })}\n`;
    return "";
  }
  return "";
}
