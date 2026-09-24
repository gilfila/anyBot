// One room per desktop. The desktop and its paired phones meet here and the
// room passes their frames along. Frames are end-to-end encrypted
// (runtime/link-protocol.mjs), so the room never sees keys or content; it
// only knows which phone a frame came from or goes to.
//
// Used by both the Cloudflare Worker (relay/worker.mjs) and the local Node
// relay (relay/node-server.mjs). An entry is { ws, side, device }; `io`
// sends text to a socket or closes it.

export const ID = /^[A-Za-z0-9_-]{16,128}$/;
export const MAX_FRAME = 64 * 1024;
export const MAX_PHONES = 16;

export function parseJoin(href) {
  const url = new URL(href);
  const match = url.pathname.match(/^\/v1\/rooms\/([A-Za-z0-9_-]{16,128})$/);
  if (!match) return null;
  const side = url.searchParams.get("side");
  if (side === "desktop") {
    const secret = url.searchParams.get("secret") || "";
    if (!ID.test(secret)) throw new Error("Invalid desktop credentials");
    return { room: match[1], side, secret };
  }
  if (side === "phone") {
    const device = url.searchParams.get("device") || "";
    if (!ID.test(device)) throw new Error("Invalid device id");
    return { room: match[1], side, device };
  }
  throw new Error("Unknown side");
}

const digest = async (text) => {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

// The first desktop to open a room owns it (its secret's hash is kept);
// after that only the same secret may connect as the desktop.
export async function admit(join, { storage, entries }) {
  if (join.side === "desktop") {
    const hash = await digest(join.secret);
    const owner = await storage.get("desktop");
    if (!owner) await storage.put("desktop", hash);
    else if (owner !== hash) return { ok: false, status: 403, reason: "This room belongs to another desktop" };
    return { ok: true };
  }
  const phones = entries.filter((e) => e.side === "phone" && e.device !== join.device);
  if (phones.length >= MAX_PHONES) return { ok: false, status: 429, reason: "Too many phones in this room" };
  return { ok: true };
}

const note = (value) => JSON.stringify({ relay: value.relay, ...(value.device ? { device: value.device } : {}) });
// A socket that is closing (readyState 2) or closed (3) no longer counts, such
// as a connection a newer one replaced. It can linger here until its peer
// answers the close, which a peer that went away without closing never does.
const closing = (entry) => entry.ws.readyState >= 2;
const desktopOf = (entries) => entries.find((e) => e.side === "desktop" && !closing(e));

export function onOpen(entry, entries, io) {
  // A newer connection from the same desktop or phone replaces the old one.
  for (const other of entries)
    if (other.ws !== entry.ws && other.side === entry.side && (entry.side === "desktop" || other.device === entry.device))
      io.close(other.ws, 4000, "Replaced by a newer connection");
  if (entry.side === "desktop") {
    for (const phone of entries) if (phone.side === "phone") io.send(phone.ws, note({ relay: "online" }));
  } else io.send(entry.ws, note({ relay: desktopOf(entries) ? "online" : "offline" }));
}

export function onMessage(entry, text, entries, io) {
  if (typeof text !== "string" || text.length > MAX_FRAME) return io.close(entry.ws, 1009, "Frame too large");
  // Keepalive (on Cloudflare, answered by setWebSocketAutoResponse instead).
  if (text === "ping") return io.send(entry.ws, "pong");
  if (entry.side === "phone") {
    const desktop = desktopOf(entries);
    if (!desktop) return io.send(entry.ws, note({ relay: "offline" }));
    return io.send(desktop.ws, JSON.stringify({ from: entry.device, data: text }));
  }
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (typeof message?.close === "string") {
    for (const phone of entries) if (phone.side === "phone" && phone.device === message.close) io.close(phone.ws, 4001, "Removed by the desktop");
    return;
  }
  if (typeof message?.to !== "string" || typeof message.data !== "string") return;
  const phone = entries.find((e) => e.side === "phone" && e.device === message.to);
  if (phone) io.send(phone.ws, message.data);
  else io.send(entry.ws, note({ relay: "gone", device: message.to }));
}

export function onClose(entry, entries, io) {
  const others = entries.filter((e) => e.ws !== entry.ws);
  if (entry.side === "desktop") {
    if (!desktopOf(others)) for (const phone of others) if (phone.side === "phone") io.send(phone.ws, note({ relay: "offline" }));
  } else {
    const desktop = desktopOf(others);
    // A replaced connection closing late: the phone is still here on its newer one.
    const stillHere = others.some((e) => e.side === "phone" && e.device === entry.device && !closing(e));
    if (desktop && !stillHere) io.send(desktop.ws, note({ relay: "left", device: entry.device }));
  }
}
