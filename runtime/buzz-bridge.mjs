import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Buzz for any bot: Buzz Desktop runs a Buzz agent on anyBot through a custom
// ACP harness (runtime/anybot-acp.mjs). Each @mention reaches this loopback
// endpoint, goes into the bot's direct chat like a Slack message does
// (coordinator.bridgeSend), and the reply streams back for the harness to
// post in the Buzz thread. Buzz keeps the agent's keys and decides who may
// mention it; anyBot stores no Buzz credentials.
//
// Off by default. When on, it listens on 127.0.0.1 only and writes its URL
// and a random token to <userData>/buzz/endpoint.json. Anything that can read
// that file already runs as the owner's OS account.
const MAX_BODY = 64 * 1024;
const HEARTBEAT_MS = 20_000;
const POLL_MS = 1_000;
const LIVE = new Set(["queued", "running", "cancelling"]);

// Buzz spawns the harness outside app.asar.
const agentScript = () =>
  fileURLToPath(new URL("./anybot-acp.mjs", import.meta.url)).replace(/app\.asar([\\/])/, "app.asar.unpacked$1");

// Buzz Desktop's app data folder (Tauri app_data_dir for xyz.block.buzz.app).
export function buzzAppData(env = process.env, platform = process.platform) {
  if (env.ANYBOT_BUZZ_APP_DATA) return env.ANYBOT_BUZZ_APP_DATA;
  const base =
    platform === "win32"
      ? env.APPDATA || join(homedir(), "AppData", "Roaming")
      : platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "xyz.block.buzz.app");
}
export const buzzHarnessPath = (env, platform) => join(buzzAppData(env, platform), "custom_harnesses", "anybot.json");

export class BuzzBridge {
  constructor(coordinator, directory) {
    this.coordinator = coordinator;
    this.store = coordinator.store;
    this.dataDirectory = directory;
    this.directory = join(directory, "buzz");
    this.endpointPath = join(this.directory, "endpoint.json");
    this.server = null;
    this.token = "";
    this.url = "";
    this.error = "";
    this.recent = new Map(); // employee id -> { at, channel, status }
    this.open = new Set(); // live responses, ended on stop
  }
  get enabled() {
    return this.store.one("SELECT value FROM metadata WHERE key='buzz'")?.value === "on";
  }
  async sync() {
    try {
      if (this.enabled) await this.start();
      else await this.stop();
      this.error = "";
    } catch (error) {
      this.error = error.message;
      this.coordinator.diagnostic({ level: "error", source: "buzz", code: "buzz.start", message: error.message });
    }
  }
  async setEnabled(enabled) {
    this.store.run("INSERT INTO metadata VALUES ('buzz', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", enabled ? "on" : "off");
    await this.sync();
  }
  // Everything the setup panel needs, for one bot or none.
  status(employeeId = "") {
    const harnessPath = buzzHarnessPath();
    let harness = null;
    try {
      harness = JSON.parse(readFileSync(harnessPath, "utf8"));
    } catch {
      // Not added yet.
    }
    return {
      enabled: this.enabled,
      listening: Boolean(this.server),
      error: this.error,
      buzzFound: existsSync(buzzAppData()),
      harness: harness
        ? { path: harnessPath, current: harness.command === process.execPath && harness.args?.[0] === agentScript() }
        : null,
      recent: employeeId ? this.recent.get(employeeId) || null : null,
    };
  }
  // Registers anyBot as a runtime in Buzz Desktop (a tier-3 custom harness).
  // Buzz reads the folder at startup, so Buzz Desktop needs a restart.
  install({ execPath = process.execPath, version = "" } = {}) {
    if (!existsSync(buzzAppData())) throw new Error("Buzz Desktop isn't installed on this computer (or hasn't been opened yet).");
    const harness = {
      id: "anybot",
      label: "Any Bot",
      command: execPath,
      args: [agentScript()],
      env: { ELECTRON_RUN_AS_NODE: "1", ANYBOT_DATA: this.dataDirectory, ANYBOT_VERSION: version },
      installHint: "Install Any Bot and turn on Connect to Buzz for a bot.",
    };
    // Buzz passes args comma-joined, so a comma would split the path.
    if (harness.args.some((arg) => arg.includes(","))) throw new Error("anyBot's install folder has a comma in it, which Buzz can't handle.");
    const path = buzzHarnessPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(harness, null, 2)}\n`);
    return path;
  }
  async start() {
    if (this.server) return;
    mkdirSync(this.directory, { recursive: true });
    const server = createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    server.unref();
    this.server = server;
    this.token = randomBytes(32).toString("hex");
    this.url = `http://127.0.0.1:${server.address().port}/`;
    writeFileSync(this.endpointPath, JSON.stringify({ url: this.url, token: this.token, pid: process.pid }), { mode: 0o600 });
  }
  async stop() {
    rmSync(this.endpointPath, { force: true });
    const server = this.server;
    this.server = null;
    this.token = "";
    for (const res of this.open) res.destroy();
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  }
  handle(req, res) {
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || "")?.[1];
    if (!this.token || token !== this.token) {
      req.resume();
      return reply(403, { error: "Not authorized" });
    }
    if (req.method !== "POST" || req.url !== "/ask") {
      req.resume();
      return reply(404, { error: "Not found" });
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
      let ask;
      try {
        ask = this.accept(JSON.parse(body));
      } catch (error) {
        return reply(400, { error: error instanceof SyntaxError ? "Unreadable request" : error.message });
      }
      this.stream(ask, res);
    });
  }
  // An id, or a name (case-insensitive) that matches exactly one active bot.
  resolveEmployee(value) {
    const wanted = String(value || "").trim();
    if (!wanted) throw new Error("This Buzz agent isn't linked to an anyBot bot. Set ANYBOT_EMPLOYEE in its environment.");
    const active = this.store.all("SELECT id,name FROM employees WHERE archived=0 ORDER BY created");
    const byId = active.find((e) => e.id === wanted);
    if (byId) return byId;
    const matches = active.filter((e) => e.name.toLowerCase() === wanted.toLowerCase());
    if (matches.length === 1) return matches[0];
    throw new Error(
      matches.length
        ? `More than one anyBot bot is named "${wanted}". Set ANYBOT_EMPLOYEE to the bot's id instead.`
        : `anyBot has no bot named "${wanted}". Check ANYBOT_EMPLOYEE in the Buzz agent's environment.`,
    );
  }
  accept(payload) {
    const requestId = String(payload.requestId || "").trim();
    if (!requestId || requestId.length > 90) throw new Error("Request ID is required");
    const employee = this.resolveEmployee(payload.employee);
    const where = String(payload.channel || "").replace(/[\r\n[\]]/g, "").slice(0, 80);
    const text = String(payload.body || "").trim();
    if (!text) throw new Error("Message is required");
    const { message } = this.coordinator.bridgeSend({
      employee: employee.id,
      requestId: `buzz:${requestId}`,
      body: `[Buzz${where ? ` ${where}` : ""}] ${text}`,
      origin: { via: "buzz", channel: where },
    });
    this.recent.set(employee.id, { at: new Date().toISOString(), channel: where, status: "running" });
    this.coordinator.notify();
    this.coordinator.dispatch();
    return { message, employee };
  }
  // Newline-delimited JSON: accepted, working heartbeats, approval notices,
  // then the result.
  stream({ message, employee }, res) {
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
    this.open.add(res);
    const write = (event) => res.write(`${JSON.stringify(event)}\n`);
    write({ type: "accepted", employee: employee.name });
    const announced = new Set();
    let done = false;
    let lastBeat = Date.now();
    const check = () => {
      if (done) return;
      let item;
      try {
        item = this.coordinator.bridgeUpdates({ messages: [message] }).items[0];
      } catch {
        return; // The store is closing.
      }
      for (const approval of item.approvals || []) {
        if (announced.has(approval.id)) continue;
        announced.add(approval.id);
        write({ type: "approval", tool: approval.tool, summary: approval.summary });
      }
      if (item.status === "unknown" || LIVE.has(item.status)) {
        if (Date.now() - lastBeat >= HEARTBEAT_MS) {
          lastBeat = Date.now();
          write({ type: "working" });
        }
        return;
      }
      finish();
      const recent = this.recent.get(employee.id);
      if (recent) recent.status = item.status;
      write({ type: "result", status: item.status, reply: item.reply || "", error: item.error || "" });
      res.end();
      this.coordinator.notify();
    };
    const timer = setInterval(check, POLL_MS);
    timer.unref?.();
    const finish = () => {
      done = true;
      clearInterval(timer);
      this.coordinator.off("changed", check);
      this.open.delete(res);
    };
    this.coordinator.on("changed", check);
    res.on("close", () => {
      if (done) return;
      // The caller stopped waiting (Buzz !cancel, a newer mention, harness
      // exit): stop the work too.
      finish();
      const item = this.coordinator.bridgeUpdates({ messages: [message] }).items[0];
      if (item.run && LIVE.has(item.status)) this.coordinator.cancel(item.run).catch(() => {});
    });
    check();
  }
}
