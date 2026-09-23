import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { id, now } from "./store.mjs";

// Owner approvals for risky harness actions.
//
// Claude Code bots run headless, so their permission prompts can't render.
// Each Claude run gets a token and an MCP config that points Claude at
// runtime/approval-mcp.mjs, which calls back here over loopback HTTP. The
// request waits in the chat until the owner approves or declines it, the
// run ends, or it times out (then it is declined).
const MAX_BODY = 64 * 1024;
const MAX_PENDING_PER_RUN = 20;

// The bridge runs as a child of the harness, outside app.asar.
const bridgeScript = () =>
  fileURLToPath(new URL("./approval-mcp.mjs", import.meta.url)).replace(/app\.asar([\\/])/, "app.asar.unpacked$1");

// One line a person can judge quickly: the command, the file, or the URL.
export function summarize(tool, input = {}) {
  const pick = (...keys) => keys.map((key) => input[key]).find((value) => typeof value === "string" && value.trim());
  const text =
    pick("command", "script") ||
    pick("file_path", "notebook_path", "path") ||
    pick("url") ||
    pick("pattern", "query") ||
    JSON.stringify(input);
  return String(text).replace(/\s+/g, " ").trim().slice(0, 400);
}

export class Approvals {
  constructor(store, directory, { timeoutMs = 15 * 60_000, onRequest = () => {}, onSettled = () => {} } = {}) {
    this.store = store;
    this.directory = join(directory, "approvals");
    this.timeoutMs = timeoutMs;
    this.onRequest = onRequest;
    this.onSettled = onSettled;
    this.tokens = new Map(); // token -> run
    this.waiting = new Map(); // approval id -> { resolve, timer, run }
    this.server = null;
    this.url = "";
    // Requests left over from a previous session can no longer be answered.
    this.store.run("UPDATE approvals SET status='expired', decided=? WHERE status='pending'", now());
  }
  start() {
    this.starting ??= this.listen();
    return this.starting;
  }
  async listen() {
    mkdirSync(this.directory, { recursive: true });
    const server = createServer((req, res) => this.handle(req, res));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.server = server;
    // Never the reason a process stays alive; the coordinator's lifetime is.
    this.server.unref();
    this.url = `http://127.0.0.1:${this.server.address().port}/`;
  }
  // A token and an MCP config file for one run. The harness reads the file;
  // nothing secret goes on a command line.
  register(run, { execPath = process.execPath } = {}) {
    if (!this.server) return null;
    const token = randomBytes(32).toString("hex");
    this.tokens.set(token, run);
    const configPath = join(this.directory, `${run.id}.json`);
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          anybot: {
            command: execPath,
            args: [bridgeScript()],
            env: { ANYBOT_APPROVAL_URL: this.url, ANYBOT_APPROVAL_TOKEN: token, ELECTRON_RUN_AS_NODE: "1" },
          },
        },
      }),
      { mode: 0o600 },
    );
    return { configPath, token };
  }
  // The run ended: anything still waiting is declined and the token dies.
  release(runId) {
    for (const [token, run] of this.tokens) if (run.id === runId) this.tokens.delete(token);
    for (const [approvalId, wait] of this.waiting) if (wait.run.id === runId) this.settle(approvalId, "cancelled", "The run ended before the owner answered.");
    rmSync(join(this.directory, `${runId}.json`), { force: true });
  }
  handle(req, res) {
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || "")?.[1];
    const run = token && this.tokens.get(token);
    if (req.method !== "POST" || req.url !== "/approve" || !run) {
      req.resume();
      return reply(403, { behavior: "deny", message: "Not authorized" });
    }
    let size = 0;
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) req.destroy();
      else body += chunk;
    });
    req.on("end", () => {
      let request;
      try {
        request = JSON.parse(body);
      } catch {
        return reply(400, { behavior: "deny", message: "Unreadable approval request" });
      }
      const pending = [...this.waiting.values()].filter((wait) => wait.run.id === run.id).length;
      if (pending >= MAX_PENDING_PER_RUN) return reply(429, { behavior: "deny", message: "Too many approval requests" });
      const approvalId = this.create(run, request);
      const timer = setTimeout(() => this.settle(approvalId, "expired", "Nobody answered in time."), this.timeoutMs);
      timer.unref?.();
      this.waiting.set(approvalId, {
        run,
        timer,
        resolve: (answer) => reply(200, answer),
      });
      res.on("close", () => {
        // The harness went away (cancelled, crashed): nothing to answer.
        if (this.waiting.has(approvalId) && !res.writableEnded) this.settle(approvalId, "cancelled", "The run stopped waiting.");
      });
    });
  }
  create(run, request) {
    const tool = String(request.tool_name || "tool").slice(0, 80);
    const input = request.input && typeof request.input === "object" ? request.input : {};
    const approvalId = id();
    this.store.run(
      "INSERT INTO approvals(id,run,conversation,employee,tool,summary,detail,status,created) VALUES (?,?,?,?,?,?,?,'pending',?)",
      approvalId,
      run.id,
      run.conversation,
      run.employee,
      tool,
      summarize(tool, input),
      JSON.stringify(input).slice(0, 4000),
      now(),
    );
    this.onRequest(this.get(approvalId));
    return approvalId;
  }
  get(approvalId) {
    return this.store.one("SELECT * FROM approvals WHERE id=?", approvalId);
  }
  decide({ id: approvalId, decision }) {
    const approval = this.get(String(approvalId || ""));
    if (!approval) throw new Error("Approval not found");
    if (approval.status !== "pending") throw new Error("This request was already answered");
    if (decision !== "allow" && decision !== "deny") throw new Error("Choose allow or deny");
    this.settle(approval.id, decision === "allow" ? "approved" : "denied", "The owner declined this action.");
  }
  settle(approvalId, status, message) {
    const wait = this.waiting.get(approvalId);
    this.store.run("UPDATE approvals SET status=?, decided=? WHERE id=? AND status='pending'", status, now(), approvalId);
    if (wait) {
      clearTimeout(wait.timer);
      this.waiting.delete(approvalId);
      wait.resolve(status === "approved" ? { behavior: "allow" } : { behavior: "deny", message });
    }
    this.onSettled(this.get(approvalId));
  }
  // Pending requests plus the latest answers, for the snapshot.
  list() {
    return this.store.all(
      "SELECT id,run,conversation,employee,tool,summary,status,created,decided FROM approvals WHERE status='pending' OR created >= ? ORDER BY created",
      new Date(Date.now() - 24 * 3600_000).toISOString(),
    );
  }
  async close() {
    await this.starting?.catch(() => {});
    for (const approvalId of [...this.waiting.keys()]) this.settle(approvalId, "cancelled", "anyBot is shutting down.");
    await new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }
}
