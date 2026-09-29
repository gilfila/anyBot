// anyBot as a Buzz agent runtime.
//
// Buzz Desktop registers this file as a custom ACP harness. buzz-acp spawns it
// with the Buzz agent's identity in the environment and sends each @mention
// as an ACP `session/prompt`. We hand the message to an anyBot employee over
// the local bridge (runtime/bridge.mjs), wait for the run, and post the reply
// to the Buzz thread with the `buzz` CLI (which signs as the Buzz agent).
//
// Runs outside app.asar with ELECTRON_RUN_AS_NODE=1, so Node built-ins only.
// stdout carries JSON-RPC only; diagnostics go to stderr (Buzz's agent log).
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const KEEPALIVE_MS = 30_000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HEX_ID = /\b[0-9a-f]{64}\b/i;

const log = (...args) => process.stderr.write(`[anybot-acp] ${args.join(" ")}\n`);

// ---------- Prompt parsing (buzz-acp queue.rs format) ----------

// A tagged section: <tag attrs>\ncontent\n</tag>
function sections(text, tag) {
  const found = [];
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>\\n([\\s\\S]*?)\\n</${tag}>`, "g");
  for (const match of text.matchAll(pattern)) found.push(match[1]);
  return found;
}

function field(block, name) {
  return new RegExp(`^${name}: (.*)$`, "m").exec(block)?.[1]?.trim() || "";
}

// One event block: header lines, then raw (possibly multi-line) content,
// then Tags/Parsed lines appended by buzz-acp.
function parseEvent(block) {
  const start = block.indexOf("\nContent: ");
  let content = start >= 0 ? block.slice(start + "\nContent: ".length) : "";
  for (const marker of ["\nParsed: ", "\nTags: ["]) {
    const at = content.lastIndexOf(marker);
    if (at >= 0) content = content.slice(0, at);
  }
  const from = field(block, "From");
  return {
    id: HEX_ID.exec(field(block, "Event ID"))?.[0] || "",
    channel: field(block, "Channel"),
    from: from.replace(/\s*\((?:npub|hex):[^)]*\)\s*$/, "") || from,
    content: content.trim(),
  };
}

export function parsePrompt(text) {
  const context = sections(text, "context")[0] || "";
  const eventText = [...sections(text, "buzz-event"), ...sections(text, "buzz-events")].join("\n");
  const blocks = eventText.includes("--- Event ")
    ? eventText.split(/^--- Event \d+[^\n]*---$/m).filter((b) => b.includes("Event ID:"))
    : eventText
      ? [eventText]
      : [];
  const events = blocks.map(parseEvent).filter((e) => e.id);
  const channelLine = field(context, "Channel") || events.at(-1)?.channel || "";
  const channel = UUID.exec(channelLine)?.[0] || "";
  const channelName = channelLine.replace(/\s*\(#?[0-9a-f-]{36}\)\s*$/i, "").trim();
  const replyLine = /--reply-to[^0-9a-f]*([0-9a-f]{64})/i.exec(context)?.[1];
  const replyTo = replyLine || HEX_ID.exec(field(context, "Thread root"))?.[0] || events.at(-1)?.id || "";
  const thread = sections(text, "thread-context")[0] || sections(text, "conversation-context")[0] || "";
  return { channel, channelName, replyTo, events, thread, scope: field(context, "Scope") };
}

// What the anyBot employee sees: the people and their words, not Buzz's
// instructions for CLI agents (the bridge posts the reply).
export function messageFor(parsed, rawText) {
  if (!parsed.events.length) return rawText.trim();
  const lines = parsed.events.map((e) => `${e.from || "Someone"}: ${e.content}`);
  const history = parsed.thread ? `Earlier in the thread:\n${parsed.thread.slice(0, 8000)}\n\n` : "";
  return `${history}${lines.join("\n\n")}`.slice(0, 20000);
}

// ---------- anyBot bridge ----------

function dataDirectory() {
  if (process.env.ANYBOT_DATA) return process.env.ANYBOT_DATA;
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "anybot-desktop");
}

function endpoint() {
  const path = join(dataDirectory(), "buzz", "endpoint.json");
  if (!existsSync(path)) throw new Error("Any Bot isn't running, or its Buzz connection is off (in Any Bot: the bot's menu → Connect to Buzz).");
  const { url, token } = JSON.parse(readFileSync(path, "utf8"));
  return { url, token };
}

async function askAnyBot(body, { signal, onEvent }) {
  const { url, token } = endpoint();
  let response;
  try {
    response = await fetch(`${url}ask`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("Any Bot isn't reachable. Is it running, with its Buzz connection on?");
  }
  if (response.status !== 200) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `anyBot refused the request (${response.status}).`);
  }
  let buffer = "";
  let result = null;
  for await (const chunk of response.body) {
    buffer += Buffer.from(chunk).toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const event = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (event.type === "result") result = event;
      else onEvent(event);
    }
  }
  if (!result) throw new Error("anyBot closed the connection before the run finished.");
  return result;
}

// ---------- Buzz CLI ----------

function buzzCommand() {
  if (process.env.ANYBOT_BUZZ_CLI) return process.env.ANYBOT_BUZZ_CLI;
  if (process.platform === "win32") {
    const installed = join(process.env.LOCALAPPDATA || "", "Buzz", "buzz.exe");
    if (process.env.LOCALAPPDATA && existsSync(installed)) return installed;
  }
  return "buzz";
}

function postToBuzz({ channel, replyTo, content }) {
  if (!channel) return Promise.reject(new Error("The Buzz prompt had no channel to reply in."));
  // ANYBOT_BUZZ_CLI_ARGS: one leading argument (a script, when the CLI is an interpreter).
  const args = [...(process.env.ANYBOT_BUZZ_CLI_ARGS ? [process.env.ANYBOT_BUZZ_CLI_ARGS] : []), "messages", "send", "--channel", channel, "--content", "-"];
  if (replyTo) args.push("--reply-to", replyTo);
  return new Promise((resolve, reject) => {
    // Inherits BUZZ_PRIVATE_KEY / BUZZ_RELAY_URL / BUZZ_AUTH_TAG from buzz-acp.
    const child = spawn(buzzCommand(), args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`buzz exited ${code}: ${stderr.trim().slice(0, 300)}`))));
    child.stdin.end(content);
  });
}

// ---------- ACP agent ----------

export function createAgent({ write, ask = askAnyBot, post = postToBuzz, env = process.env } = {}) {
  const sessions = new Map(); // sessionId -> { controller }
  const employee = env.ANYBOT_EMPLOYEE || env.BUZZ_ACP_DISPLAY_NAME || "";
  const send = (message) => write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const update = (sessionId, value) => send({ method: "session/update", params: { sessionId, update: value } });

  async function prompt(params) {
    const session = sessions.get(params.sessionId);
    if (!session) throw Object.assign(new Error("Unknown session"), { code: -32602 });
    const text = (params.prompt || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const parsed = parsePrompt(text);
    const controller = new AbortController();
    session.controller = controller;
    const keepalive = setInterval(() => update(params.sessionId, { sessionUpdate: "keepalive" }), KEEPALIVE_MS);
    const say = (content) =>
      post({ channel: parsed.channel, replyTo: parsed.replyTo, content }).catch((error) => log("post failed:", error.message));
    try {
      const ids = parsed.events.map((e) => e.id).join(",") || createHash("sha256").update(text).digest("hex");
      const requestId = createHash("sha256").update(ids).digest("hex").slice(0, 40);
      const result = await ask(
        {
          requestId,
          employee,
          body: messageFor(parsed, text),
          channel: parsed.channelName ? `#${parsed.channelName.replace(/^#/, "")}` : parsed.scope === "dm" ? "DM" : "",
        },
        {
          signal: controller.signal,
          onEvent: (event) => {
            update(params.sessionId, { sessionUpdate: "keepalive" });
            // The step itself (a command, a path) stays in anyBot, not the channel.
            if (event.type === "approval") say("Waiting for my owner to approve a step before I continue.");
          },
        },
      );
      if (result.status === "succeeded") {
        if (result.reply) await say(result.reply);
        update(params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: result.reply || "(no reply)" } });
      } else await say(`⚠️ The anyBot run ${result.status}: ${result.error || "no details"}`);
      return { stopReason: "end_turn" };
    } catch (error) {
      if (controller.signal.aborted) return { stopReason: "cancelled" };
      log(error.message);
      // A notice instead of a JSON-RPC error: buzz-acp would retry the batch.
      await say(`⚠️ ${error.message}`);
      return { stopReason: "end_turn" };
    } finally {
      clearInterval(keepalive);
      session.controller = null;
    }
  }

  async function handle(message) {
    const { id, method, params = {} } = message;
    if (method === undefined) return; // a response to something we never send
    const respond = (result) => id !== undefined && send({ id, result });
    const fail = (code, text) => id !== undefined && send({ id, error: { code, message: text } });
    try {
      switch (method) {
        case "initialize":
          return respond({
            protocolVersion: 2,
            agentCapabilities: {},
            agentInfo: { name: "anybot", title: "Any Bot", version: env.ANYBOT_VERSION || "" },
            authMethods: [],
          });
        case "session/new": {
          const sessionId = randomUUID();
          sessions.set(sessionId, { controller: null });
          return respond({ sessionId });
        }
        case "session/prompt":
          return respond(await prompt(params));
        case "session/cancel":
          sessions.get(params.sessionId)?.controller?.abort();
          return;
        default:
          return fail(-32601, `Method not found: ${method}`);
      }
    } catch (error) {
      return fail(error.code || -32603, error.message);
    }
  }
  return { handle, sessions, employee };
}

function main() {
  const agent = createAgent({ write: (line) => process.stdout.write(line) });
  if (!agent.employee) log("No employee set: add ANYBOT_EMPLOYEE to the Buzz agent's environment, or name the Buzz agent after the employee.");
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return log("ignored a line that is not JSON");
    }
    agent.handle(message).catch((error) => log(error.message));
  });
  lines.on("close", () => process.exit(0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
