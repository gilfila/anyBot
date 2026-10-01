// Slack for one bot at a time: each connected bot has its own Slack app,
// reached over Socket Mode (outbound WebSocket, nothing exposed). A DM to the
// app, or an @mention in a channel, becomes a message in that bot's direct
// chat; the bot's reply goes back to the same DM or thread. Approvals the run
// waits on are posted with Approve / Deny buttons.
//
// Only people paired with the bot can give it work: the owner shows a code in
// Any Bot (Connect to Slack) and DMs it to the app. Runs in the main process
// (desktop/main.cjs), which owns the OS keystore; tokens never reach the
// renderer or the coordinator.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomInt } from "node:crypto";
import { fromSlackText, slackChunks, toSlackText } from "./slack-format.mjs";

const API = "https://slack.com/api/";
const PAIRING_MS = 10 * 60_000;
const PENDING_MS = 24 * 3600_000;
const REFUSAL_MS = 3600_000;
const MAX_MISSES = 5;
// Network failures before the request reached Slack, so retrying is safe.
const UNSENT = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"]);
// Errors that new tokens fix; retrying them only spams Slack.
const FATAL = new Set(["invalid_auth", "not_authed", "account_inactive", "token_revoked", "token_expired", "not_allowed_token_type", "missing_scope"]);
const MESSAGES = {
  invalid_auth: "Slack didn't accept that token. Copy it again from your Slack app's settings.",
  not_authed: "Slack didn't accept that token. Copy it again from your Slack app's settings.",
  token_revoked: "That token was revoked in Slack. Reinstall the app and copy the new tokens.",
  account_inactive: "That Slack app or workspace is no longer active.",
  not_allowed_token_type: "That's the wrong kind of token. The bot token starts with xoxb-, the app token with xapp-.",
  missing_scope: "The Slack app is missing a permission. Create it again from the manifest Any Bot gives you.",
  channel_not_found: "Slack couldn't find that conversation.",
  not_in_channel: "The app isn't in that channel. Invite it with /invite first.",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (value) => String(value || "The run failed.").split("\n")[0].slice(0, 500);

export function createSlackBridge({
  statePath,
  request,
  protect = (value) => value,
  unprotect = (value) => value,
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  clock = Date.now,
  onChange = () => {},
  onDiagnostic = () => {},
  retryMs = [1000, 2000, 5000, 15000, 30000],
  pollMs = 5000,
}) {
  let state = load();
  const links = new Map();
  const pairings = new Map();
  const refused = new Map();
  const sending = new Set();
  let running = false;
  let poll = null;
  let refreshing = null;
  let again = false;

  function load() {
    try {
      const saved = JSON.parse(readFileSync(statePath, "utf8"));
      if (saved?.v === 1 && saved.bots && typeof saved.bots === "object") return saved;
    } catch {
      // No file yet, or unreadable: start empty.
    }
    return { v: 1, bots: {} };
  }
  function save() {
    mkdirSync(dirname(statePath), { recursive: true });
    const temporary = `${statePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(temporary, statePath);
  }
  function report(error, context) {
    // "fetch failed" alone says nothing; the cause says why (a timeout, DNS...).
    const cause = error?.cause?.code || error?.cause?.message;
    const message = `${error?.message || error}${cause ? ` (${cause})` : ""}`;
    onDiagnostic({ level: "warn", source: "slack", code: "slack.error", message: message.slice(0, 300), context });
  }

  async function api(token, method, args = {}) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(args))
      if (value !== undefined && value !== null) body.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetchImpl(API + method, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
      } catch (error) {
        // A connection that never opened: nothing reached Slack, so try again.
        if (!UNSENT.has(error.cause?.code) || attempt === 2) throw error;
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (response.status === 429) {
        await sleep(Math.min(30, Number(response.headers?.get?.("retry-after")) || 1) * 1000);
        continue;
      }
      const data = await response.json();
      if (!data.ok) {
        const error = new Error(MESSAGES[data.error] || `Slack said: ${data.error || "unknown error"}`);
        error.code = data.error;
        throw error;
      }
      return data;
    }
    throw new Error("Slack is rate limiting this app. Try again in a minute.");
  }
  const botApi = (employee, method, args) => api(unprotect(state.bots[employee].botToken), method, args);

  // One Socket Mode connection, reopened with backoff until it's closed.
  function startLink(employee) {
    links.get(employee)?.close();
    const link = { status: "connecting", error: null, socket: null, attempts: 0, retry: null, closed: false };
    links.set(employee, link);
    const reconnect = () => {
      if (link.closed) return;
      clearTimeout(link.retry);
      link.retry = setTimeout(open, retryMs[Math.min(link.attempts++, retryMs.length - 1)]);
    };
    async function open() {
      if (link.closed || !state.bots[employee]) return;
      if (link.status !== "error") link.status = "connecting";
      onChange();
      try {
        const { url } = await api(unprotect(state.bots[employee].appToken), "apps.connections.open");
        if (link.closed) return;
        const socket = new WebSocketImpl(url);
        link.socket = socket;
        socket.onmessage = (event) => frame(employee, link, socket, event.data);
        socket.onclose = () => {
          if (link.socket !== socket) return;
          link.socket = null;
          if (link.status === "online") link.status = "connecting";
          onChange();
          reconnect();
        };
        socket.onerror = () => {};
      } catch (error) {
        link.status = "error";
        link.error = error.message;
        onChange();
        if (!FATAL.has(error.code)) reconnect();
      }
    }
    link.close = () => {
      link.closed = true;
      clearTimeout(link.retry);
      const socket = link.socket;
      link.socket = null;
      try {
        socket?.close();
      } catch {
        // Already closed.
      }
    };
    open();
    return link;
  }

  function frame(employee, link, socket, data) {
    let envelope;
    try {
      envelope = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
    } catch {
      return;
    }
    if (envelope.type === "hello") {
      link.status = "online";
      link.error = null;
      link.attempts = 0;
      onChange();
      return;
    }
    if (envelope.type === "disconnect") {
      // Slack rotates Socket Mode connections; onclose opens the next one.
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      return;
    }
    // Acknowledge first: Slack retries anything not acked within 3 seconds.
    if (envelope.envelope_id) socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    if (envelope.type === "events_api")
      onEvent(employee, envelope.payload?.event).catch((error) => report(error, { employee, step: "event" }));
    if (envelope.type === "interactive")
      onAction(employee, envelope.payload).catch((error) => report(error, { employee, step: "action" }));
  }

  async function post(employee, where, text, blocks) {
    const chunks = blocks ? [text] : slackChunks(text);
    for (const chunk of chunks)
      await botApi(employee, "chat.postMessage", {
        channel: where.channel,
        text: chunk,
        blocks,
        thread_ts: where.thread || undefined,
        unfurl_links: false,
      });
  }
  const react = (employee, where, name, add) =>
    botApi(employee, add ? "reactions.add" : "reactions.remove", { channel: where.channel, timestamp: where.ts, name }).catch(() => {});

  async function onEvent(employee, event) {
    const bot = state.bots[employee];
    // New messages only: a message with a file (file_share) or a thread reply
    // also sent to the conversation (thread_broadcast) counts; edits,
    // deletions and other system messages don't.
    const subtype = !event?.subtype || ["file_share", "thread_broadcast"].includes(event.subtype);
    if (!bot || !event || !event.user || event.bot_id || !subtype || event.user === bot.botUser) return;
    const dm = event.type === "message" && event.channel_type === "im";
    if (!dm && event.type !== "app_mention") return;
    const body = fromSlackText(event.text, bot.botUser);
    const where = { channel: event.channel, ts: event.ts, thread: dm ? event.thread_ts || null : event.thread_ts || event.ts };
    if (!bot.users.some((u) => u.id === event.user)) return stranger(employee, event.user, body, where, dm);
    // Files from Slack aren't passed on yet (the app can't download them).
    // Say so, and send whatever text came with them.
    const files = Array.isArray(event.files) ? event.files.map((f) => String(f?.name || f?.title || "a file").slice(0, 120)) : [];
    if (!body && !files.length) return;
    const requestId = `slack:${bot.team}:${event.channel}:${event.ts}`;
    // Slack redelivers an event it thinks was missed, sometimes while the
    // first delivery is still being sent.
    if (sending.has(requestId) || bot.pending.some((p) => p.requestId === requestId)) return;
    sending.add(requestId);
    let sent;
    try {
      if (files.length)
        await post(
          employee,
          where,
          body
            ? "I can't open files from Slack yet, so I only got your text. Paste what I need from the file, or put it in a folder I can reach and tell me where."
            : "I can't open files from Slack yet. Paste what I need from the file, or put it in a folder I can reach and tell me where.",
        ).catch((error) => report(error, { employee, step: "files" }));
      if (!body) return;
      const note = files.length ? `\n\n[Attached in Slack but not delivered: ${files.join(", ")}]` : "";
      sent = await request("bridge.send", {
        employee,
        body: `${dm ? "[Slack DM]" : "[Slack channel]"} ${body}${note}`,
        requestId,
        // Ids only: who sent it and where (runtime/origin.mjs).
        origin: { via: "slack", team: bot.team, user: event.user, channel: event.channel },
      });
    } catch (error) {
      await post(employee, where, `I couldn't take that on: ${error.message}`);
      return;
    } finally {
      sending.delete(requestId);
    }
    if (state.bots[employee] !== bot) return;
    bot.pending.push({ requestId, message: sent.message, ...where, at: clock(), announced: [], handed: [] });
    save();
    react(employee, where, "eyes", true);
    refresh();
  }

  // Someone who isn't paired: a valid code (by DM only) pairs them, anything
  // else gets one polite refusal an hour.
  async function stranger(employee, user, body, where, dm) {
    const bot = state.bots[employee];
    const pairing = pairings.get(employee);
    // Compare digits only: a pasted code arrives as "*123 456*" when Slack
    // keeps the bold from Any Bot's panel.
    const typed = body.length <= 40 ? body.replace(/\D/g, "") : "";
    const live = pairing && pairing.expires > clock();
    if (dm && live && typed === pairing.code) {
      pairings.delete(employee);
      let name = user;
      try {
        const info = await botApi(employee, "users.info", { user });
        name = info.user?.profile?.display_name || info.user?.real_name || info.user?.name || user;
      } catch {
        // users:read is optional for pairing; the id still works.
      }
      bot.users.push({ id: user, name: String(name).slice(0, 80) });
      save();
      onChange();
      await post(employee, where, "You're paired. Send me work here, or @mention me in a channel I'm in.");
      return;
    }
    // Something that looks like a code always gets an answer, so a wrong or
    // expired one isn't met with silence. Five wrong guesses cancel the code.
    if (dm && typed.length === 6) {
      if (live && ++pairing.misses >= MAX_MISSES) {
        pairings.delete(employee);
        onChange();
      }
      await post(
        employee,
        where,
        live && pairings.has(employee)
          ? "That isn't the pairing code Any Bot is showing. Check it and send it again."
          : "That pairing code has expired or was already used. In Any Bot, open Connect to Slack in my menu, get a new code, and send it within 10 minutes.",
      );
      return;
    }
    const key = `${employee}:${user}`;
    if (clock() - (refused.get(key) || 0) < REFUSAL_MS) return;
    refused.set(key, clock());
    try {
      await post(employee, where, "I only take work from people paired with me in Any Bot. If that's you, open Any Bot, choose Connect to Slack in my menu, and DM me the pairing code.");
    } catch (error) {
      // A refusal lost to the network must not mute the next hour.
      refused.delete(key);
      throw error;
    }
  }

  async function onAction(employee, payload) {
    const bot = state.bots[employee];
    if (!bot || payload?.type !== "block_actions") return;
    const action = payload.actions?.[0];
    if (!action || !/^anybot\.(approve|deny)$/.test(action.action_id)) return;
    const person = bot.users.find((u) => u.id === payload.user?.id);
    if (!person) return;
    const allow = action.action_id === "anybot.approve";
    let outcome;
    try {
      await request("approvals.decide", { id: action.value, decision: allow ? "allow" : "deny" });
      outcome = `${allow ? "Approved" : "Denied"} by ${person.name}.`;
    } catch (error) {
      outcome = `Couldn't ${allow ? "approve" : "deny"} it: ${error.message}`;
    }
    const channel = payload.channel?.id || payload.container?.channel_id;
    const ts = payload.message?.ts || payload.container?.message_ts;
    const original = payload.message?.blocks?.[0]?.text?.text || payload.message?.text || "";
    if (channel && ts)
      await botApi(employee, "chat.update", {
        channel,
        ts,
        text: `${original}\n${outcome}`.trim(),
        blocks: [{ type: "section", text: { type: "mrkdwn", text: `${original}\n_${outcome}_`.trim() } }],
      });
  }

  async function announceApproval(employee, where, approval) {
    const bot = state.bots[employee];
    const text = `*${toSlackText(bot.botName)} needs your OK to use ${toSlackText(approval.tool)}*\n${toSlackText(approval.summary || "")}`.slice(0, 2900);
    await post(employee, where, text, [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "actions",
        elements: [
          { type: "button", style: "primary", text: { type: "plain_text", text: "Approve" }, action_id: "anybot.approve", value: approval.id },
          { type: "button", style: "danger", text: { type: "plain_text", text: "Deny" }, action_id: "anybot.deny", value: approval.id },
        ],
      },
    ]);
  }

  // Follow every message still waiting on its bot: post approvals once, then
  // the reply (or the error) when the run ends.
  function refresh() {
    if (!running) return Promise.resolve();
    if (refreshing) {
      again = true;
      return refreshing;
    }
    refreshing = (async () => {
      do {
        again = false;
        await refreshOnce();
      } while (again && running);
    })()
      .catch((error) => report(error, { step: "refresh" }))
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }
  async function refreshOnce() {
    const waiting = Object.entries(state.bots).flatMap(([employee, bot]) => bot.pending.map((entry) => ({ employee, bot, entry })));
    if (!waiting.length) return;
    const { items } = await request("bridge.updates", { messages: waiting.map((w) => w.entry.message) });
    const byMessage = new Map(items.map((item) => [item.message, item]));
    let changed = false;
    for (const { employee, bot, entry } of waiting) {
      const item = byMessage.get(entry.message);
      if (!item || state.bots[employee] !== bot) continue;
      for (const approval of item.approvals || [])
        if (!entry.announced.includes(approval.id)) {
          entry.announced.push(approval.id);
          changed = true;
          await announceApproval(employee, entry, approval).catch((error) => report(error, { employee, step: "approval" }));
        }
      // Work handed to another bot: say so once, since the answer comes
      // when that work is back.
      for (const handoff of item.handoffs || []) {
        entry.handed ||= [];
        if (entry.handed.includes(handoff.id)) continue;
        entry.handed.push(handoff.id);
        changed = true;
        if (!["queued", "running", "cancelling"].includes(item.status)) continue;
        await post(employee, entry, `Handed to ${toSlackText(handoff.to)}. I'll post the result here when it's back.`).catch((error) =>
          report(error, { employee, step: "handoff" }),
        );
      }
      const expired = clock() - entry.at > PENDING_MS;
      if (!["succeeded", "failed", "cancelled", "interrupted", "unknown"].includes(item.status) && !expired) continue;
      bot.pending = bot.pending.filter((p) => p !== entry);
      changed = true;
      const text =
        item.status === "succeeded"
          ? toSlackText(item.reply || "Done.")
          : item.status === "failed"
            ? `I couldn't finish that: ${toSlackText(firstLine(item.error))}`
            : item.status === "cancelled"
              ? "That was stopped in Any Bot."
              : item.status === "interrupted"
                ? "Any Bot stopped before I finished (it quit, updated, or restarted), so this may be partly done. Ask again to pick it up."
                : expired
                  ? "I lost track of that request. Check Any Bot for my reply."
                  : null;
      if (text) await post(employee, entry, text).catch((error) => report(error, { employee, step: "reply" }));
      react(employee, entry, "eyes", false);
    }
    if (changed) save();
  }

  function status(employee) {
    const bot = state.bots[employee];
    if (!bot) return { connected: false };
    const link = links.get(employee);
    const pairing = pairings.get(employee);
    return {
      connected: true,
      state: link?.status || "off",
      error: link?.error || null,
      team: bot.teamName,
      botName: bot.botName,
      users: bot.users.map((u) => ({ id: u.id, name: u.name })),
      waiting: bot.pending.length,
      pairing: pairing && pairing.expires > clock() ? { code: pairing.code, expires: new Date(pairing.expires).toISOString() } : null,
    };
  }

  return {
    start() {
      running = true;
      for (const employee of Object.keys(state.bots)) startLink(employee);
      poll = setInterval(() => refresh(), pollMs);
      poll.unref?.();
      refresh();
    },
    stop() {
      running = false;
      clearInterval(poll);
      for (const link of links.values()) link.close();
      links.clear();
    },
    refresh,
    status,
    // Which bots have Slack, for badges: { [employee]: "online" | ... }.
    overview() {
      return Object.fromEntries(Object.keys(state.bots).map((employee) => [employee, links.get(employee)?.status || "off"]));
    },
    async connect(employee, { botToken, appToken } = {}) {
      const bot = String(botToken || "").trim();
      const app = String(appToken || "").trim();
      if (!/^xoxb-[\w-]+$/.test(bot)) throw new Error("The bot token starts with xoxb-. Find it under OAuth & Permissions.");
      if (!/^xapp-[\w-]+$/.test(app)) throw new Error("The app token starts with xapp-. Create it under Basic Information → App-Level Tokens.");
      const auth = await api(bot, "auth.test");
      await api(app, "apps.connections.open");
      const other = Object.entries(state.bots).find(([id, b]) => id !== employee && b.botUser === auth.user_id);
      if (other) throw new Error("This Slack app is already connected to another bot. Create a separate app for each bot.");
      const previous = state.bots[employee];
      const same = previous?.team === auth.team_id;
      state.bots[employee] = {
        botToken: protect(bot),
        appToken: protect(app),
        team: auth.team_id,
        teamName: String(auth.team || "").slice(0, 100),
        botUser: auth.user_id,
        botName: String(auth.user || "").slice(0, 80),
        users: same ? previous.users : [],
        pending: same ? previous.pending : [],
        connected: new Date(clock()).toISOString(),
      };
      save();
      if (!state.bots[employee].users.length) this.pair(employee);
      if (running) startLink(employee);
      onChange();
      return status(employee);
    },
    disconnect(employee) {
      links.get(employee)?.close();
      links.delete(employee);
      pairings.delete(employee);
      delete state.bots[employee];
      save();
      onChange();
      return status(employee);
    },
    pair(employee) {
      if (!state.bots[employee]) throw new Error("Connect this bot to Slack first.");
      pairings.set(employee, { code: String(randomInt(0, 1_000_000)).padStart(6, "0"), expires: clock() + PAIRING_MS, misses: 0 });
      onChange();
      return status(employee);
    },
    removeUser(employee, user) {
      const bot = state.bots[employee];
      if (bot) {
        bot.users = bot.users.filter((u) => u.id !== user);
        save();
        onChange();
      }
      return status(employee);
    },
  };
}
