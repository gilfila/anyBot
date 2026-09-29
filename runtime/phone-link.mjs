// Desktop side of the phone link (Settings → Your phone).
//
// Keeps this computer's link identity, holds one outbound connection to the
// relay, pairs phones that scanned the QR code, and answers their encrypted
// requests through the mobile gateway's handle(). Nothing listens on a port
// and no certificate is involved: the phone and the desktop both dial out.
// The protocol is described in runtime/link-protocol.mjs.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  LINK_VERSION,
  TOKEN,
  buildLink,
  createCipher,
  deriveSession,
  exportPrivate,
  exportPublic,
  generateKeys,
  importPrivate,
  pairingProof,
  randomToken,
  relayOrigin,
  relaySocketUrl,
  sameText,
} from "./link-protocol.mjs";

export const PAIRING_MS = 10 * 60 * 1000;
export const MAX_DEVICES = 16;
const KEEPALIVE_MS = 30 * 1000;
const MAX_BODY = 32 * 1024;
const methods = new Set(["GET", "POST", "DELETE"]);
const clean = (value, fallback) => String(value || fallback).replace(/[\u0000-\u001f]/g, "").slice(0, 60) || fallback;

// The relay drops the desktop's connection when a frame passes 64 KB
// (MAX_FRAME in relay/room.mjs), which knocks every phone offline. A sealed
// reply is base64 of its JSON plus a little framing, so the JSON gets about
// three quarters of a frame.
export const RELAY_MAX_FRAME = 64 * 1024;
const REPLY_BUDGET = Math.floor(((RELAY_MAX_FRAME - 1024) * 3) / 4);
const MIN_TEXT = 200;
const SHORTENED = "… [shortened for the phone]";
const bytes = (value) => Buffer.byteLength(JSON.stringify(value) ?? "");
function capText(value, max) {
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}${SHORTENED}` : value;
  if (Array.isArray(value)) return value.map((item) => capText(item, max));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, capText(item, max)]));
  return value;
}
function longestText(value) {
  if (typeof value === "string") return value.length;
  if (value && typeof value === "object") return Math.max(0, ...Object.values(value).map(longestText));
  return 0;
}
function largestList(value) {
  let best = null;
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item) && item.length > 1 && (!best || bytes(item) > bytes(best))) best = item;
    Object.values(item).forEach(visit);
  };
  visit(value);
  return best;
}
// A reply cut down to `limit` bytes of JSON: first every long text is
// shortened (the longest ones, as little as possible), and when even short
// texts don't fit, lists lose their oldest half at a time (lists run oldest
// to newest). Null when nothing fits.
export function fitReply(value, limit = REPLY_BUDGET) {
  if (bytes(value) <= limit) return value;
  const current = capText(value, Infinity);
  while (bytes(capText(current, MIN_TEXT)) > limit) {
    const list = largestList(current);
    if (!list) return null;
    list.splice(0, Math.ceil(list.length / 2));
  }
  let [low, high] = [MIN_TEXT, longestText(current)];
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (bytes(capText(current, middle)) <= limit) low = middle;
    else high = middle - 1;
  }
  return capText(current, low);
}
// fitReply for a conversation page: when its oldest messages had to go, the
// page's cursor moves to the oldest one kept, so paging back shows them
// instead of skipping them.
export function fitPage(value, limit = REPLY_BUDGET) {
  const fitted = fitReply(value, limit);
  if (
    fitted &&
    fitted !== value &&
    Array.isArray(value?.messages) &&
    "olderCursor" in value &&
    fitted.messages?.length < value.messages.length
  )
    fitted.olderCursor = fitted.messages[0]?.id ?? value.olderCursor;
  return fitted;
}

// `protect`/`unprotect` wrap secrets at rest (Electron's safeStorage on the
// desktop); tests pass identity functions.
export async function createPhoneLink({
  statePath,
  relay = "",
  gateway,
  name = "Your computer",
  protect = (text) => text,
  unprotect = (text) => text,
  WebSocketImpl = globalThis.WebSocket,
  clock = Date.now,
  onChange = () => {},
}) {
  relay = relay ? relayOrigin(relay) : "";
  let state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
  if (!state || state.v !== 1 || !TOKEN.test(state.room || "") || !Array.isArray(state.devices)) {
    const keys = await generateKeys(true);
    state = {
      v: 1,
      room: randomToken(16),
      secret: protect(randomToken(32)),
      identity: {
        publicKey: await exportPublic(keys.publicKey),
        privateKey: protect(JSON.stringify(await exportPrivate(keys.privateKey))),
      },
      devices: [],
    };
  }
  const save = () => {
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(`${statePath}.tmp`, statePath);
  };
  save();
  const identity = {
    publicKey: state.identity.publicKey,
    privateKey: await importPrivate(JSON.parse(unprotect(state.identity.privateKey))),
  };

  let socket = null;
  let connection = relay ? "offline" : "unconfigured";
  let stopped = true;
  let retry = 0;
  let timer = null;
  let keepalive = null;
  let pairing = null;
  let pairedJustNow = null;
  let seenSaved = 0;
  const sessions = new Map();

  const changed = () => {
    try {
      onChange();
    } catch {
      // Listeners must not break the link.
    }
  };
  const device = (id) => state.devices.find((d) => d.id === id);
  const sendTo = (id, frame) => {
    if (socket?.readyState === 1) socket.send(JSON.stringify({ to: id, data: JSON.stringify(frame) }));
  };
  const touch = (known) => {
    known.seen = clock();
    // Last-seen times are for display; write them at most once a minute.
    if (clock() - seenSaved > 60000) {
      seenSaved = clock();
      save();
    }
  };

  async function hello(id, frame) {
    if (frame.v !== LINK_VERSION || typeof frame.key !== "string" || typeof frame.eph !== "string" || !TOKEN.test(frame.nonce || ""))
      return sendTo(id, { t: "denied", reason: "update", message: "Update Any Bot on this phone and your computer." });
    let known = device(id);
    if (known && !sameText(known.key, frame.key)) known = null;
    if (!known) {
      const fresh = pairing && pairing.expiresAt > clock();
      const proof = fresh && typeof frame.proof === "string" ? await pairingProof(pairing.code, frame.key, id) : null;
      if (!proof || !sameText(proof, frame.proof))
        return sendTo(id, {
          t: "denied",
          reason: frame.proof ? "expired" : "unpaired",
          message: frame.proof
            ? "That code has expired or was already used. Show a new code on your computer."
            : "This phone isn't connected to that computer anymore. Scan a new code to reconnect.",
        });
      if (state.devices.length >= MAX_DEVICES)
        return sendTo(id, { t: "denied", reason: "full", message: "Remove a phone on your computer before adding another." });
      // Pending until the phone's first encrypted request: a phone that gave
      // up halfway (or rejected this desktop) never shows up as paired.
      known = { id, name: clean(frame.name, "Phone"), key: frame.key, role: pairing.role, memberId: pairing.memberId, paired: clock(), seen: clock(), pending: true };
      pairing = null; // one phone per code
      state.devices.push(known);
      save();
      changed();
    }
    const ephemeral = await generateKeys(false);
    const ephemeralKey = await exportPublic(ephemeral.publicKey);
    const nonce = randomToken(16);
    const keys = await deriveSession({
      role: "desktop",
      staticPrivate: identity.privateKey,
      ephemeralPrivate: ephemeral.privateKey,
      peerStatic: frame.key,
      peerEphemeral: frame.eph,
      transcript: [state.room, id, identity.publicKey, frame.key, ephemeralKey, frame.eph, frame.nonce, nonce],
    });
    const cipher = createCipher(keys);
    sessions.set(id, cipher);
    touch(known);
    sendTo(id, { t: "welcome", v: LINK_VERSION, eph: ephemeralKey, nonce, box: await cipher.seal({ t: "confirm", name }) });
    changed();
  }

  async function request(id, frame) {
    const cipher = sessions.get(id);
    const known = device(id);
    if (!known) return sendTo(id, { t: "denied", reason: "unpaired", message: "This phone isn't connected to that computer anymore. Scan a new code to reconnect." });
    if (!cipher || typeof frame.box !== "string") return sendTo(id, { t: "retry" });
    let ask;
    try {
      ask = await cipher.open(frame.box);
    } catch {
      return; // Tampered, replayed, or from an old session: drop it.
    }
    if (known.pending) {
      delete known.pending;
      pairedJustNow = known.id;
      save();
      changed();
    }
    touch(known);
    // Never more than the relay passes in one frame (see fitReply).
    const answer = async (status, value) => {
      const fitted = fitPage(value);
      let box = await cipher.seal(fitted === null ? { id: ask?.id, status: 413, value: { error: "That is too much to send to the phone at once." } } : { id: ask?.id, status, value: fitted });
      if (JSON.stringify({ to: id, data: JSON.stringify({ t: "res", box }) }).length > RELAY_MAX_FRAME)
        box = await cipher.seal({ id: ask?.id, status: 413, value: { error: "That is too much to send to the phone at once." } });
      sendTo(id, { t: "res", box });
    };
    if (
      !ask ||
      typeof ask.id !== "string" ||
      ask.id.length > 64 ||
      !methods.has(ask.method) ||
      typeof ask.path !== "string" ||
      !ask.path.startsWith("/v1/") ||
      ask.path.length > 2048
    )
      return answer(400, { error: "Invalid request" });
    const session = gateway.linkedSession({
      id: known.id,
      name: known.name,
      role: known.role,
      memberId: known.memberId,
      active: () => Boolean(device(known.id)),
      disconnect: () => remove(known.id),
    });
    let out;
    try {
      out = await gateway.handle({
        method: ask.method,
        url: new URL(ask.path, "https://link.invalid"),
        remote: `phone:${known.id}`,
        readBody: async () => {
          const value = ask.body;
          if (!value || Array.isArray(value) || typeof value !== "object" || JSON.stringify(value).length > MAX_BODY)
            throw new Error("Invalid request");
          return value;
        },
        linked: session,
      });
    } catch {
      out = { status: 400, value: { error: "Request could not be completed. Check its fields and runtime connection." } };
    }
    return answer(out.status, out.value);
  }

  function receive(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return; // "pong" and anything else that isn't ours
    }
    if (message?.relay) {
      if (["left", "gone"].includes(message.relay) && typeof message.device === "string") {
        sessions.delete(message.device);
        changed();
      }
      return;
    }
    if (typeof message?.from !== "string" || !TOKEN.test(message.from) || typeof message.data !== "string") return;
    let frame;
    try {
      frame = JSON.parse(message.data);
    } catch {
      return;
    }
    const work = frame?.t === "hello" ? hello(message.from, frame) : frame?.t === "req" ? request(message.from, frame) : null;
    work?.catch(() => {});
  }

  function connect() {
    if (stopped || !relay) return;
    connection = "connecting";
    changed();
    const ws = new WebSocketImpl(relaySocketUrl(relay, state.room, { side: "desktop", secret: unprotect(state.secret) }));
    socket = ws;
    ws.onopen = () => {
      retry = 0;
      connection = "online";
      clearInterval(keepalive);
      keepalive = setInterval(() => ws.readyState === 1 && ws.send("ping"), KEEPALIVE_MS);
      changed();
    };
    ws.onmessage = (event) => receive(typeof event.data === "string" ? event.data : "");
    ws.onerror = () => {};
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      clearInterval(keepalive);
      sessions.clear();
      connection = "offline";
      changed();
      if (!stopped) timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
    };
  }

  function remove(id) {
    const before = state.devices.length;
    state.devices = state.devices.filter((d) => d.id !== id);
    sessions.delete(id);
    if (socket?.readyState === 1) socket.send(JSON.stringify({ close: id }));
    if (state.devices.length !== before) {
      save();
      changed();
    }
    return { removed: state.devices.length !== before };
  }

  return {
    start() {
      stopped = false;
      if (!socket) connect();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(keepalive);
      const ws = socket;
      socket = null;
      sessions.clear();
      ws?.close();
    },
    status() {
      const justPaired = pairedJustNow;
      const stale = state.devices.filter((d) => d.pending && d.paired < clock() - PAIRING_MS);
      if (stale.length) {
        state.devices = state.devices.filter((d) => !stale.includes(d));
        save();
      }
      return {
        connection,
        relay: relay || null,
        name,
        pairing: pairing && pairing.expiresAt > clock() ? { expiresAt: pairing.expiresAt } : null,
        justPaired,
        devices: state.devices
          .filter((d) => !d.pending)
          .map(({ id, name, role, paired, seen }) => ({ id, name, role, paired, seen, connected: sessions.has(id) })),
      };
    },
    // A fresh QR code. Only the newest code works, for one phone, for ten minutes.
    createPairing({ role = "operator", memberId = "owner" } = {}) {
      if (!relay) throw new Error("Phone connections aren't set up in this version of Any Bot yet.");
      gateway.linkedSession({ id: "check", role, memberId, active: () => false, disconnect: () => {} });
      pairing = { code: randomToken(16), expiresAt: clock() + PAIRING_MS, role, memberId };
      pairedJustNow = null;
      changed();
      return {
        link: buildLink({ relay, room: state.room, key: identity.publicKey, code: pairing.code, name }),
        expiresAt: pairing.expiresAt,
      };
    },
    cancelPairing() {
      pairing = null;
      changed();
    },
    remove,
  };
}
