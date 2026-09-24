// Phone link: end-to-end encryption between the desktop and a paired phone.
//
// Both ends run this file: the desktop with Node's WebCrypto, the phone with
// its WebView's. The relay between them only ever carries what seal()
// produces, so it can neither read nor alter the traffic.
//
// Trust comes from the QR code. It carries the desktop's public key and a
// one-time pairing secret. The phone proves it scanned the code (HMAC over
// its own public key), and the desktop proves it holds the key in the code
// (only it can produce the confirm box). Each connection mixes fresh
// ephemeral keys with the long-term ones, so old traffic stays private even
// if a device key later leaks, and a replayed frame is rejected.

export const LINK_VERSION = 1;
const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" };
// Room and device ids, and base64url fields generally.
export const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export const b64u = {
  encode(bytes) {
    const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    let text = "";
    for (const byte of view) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text) {
    if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("Invalid encoding");
    const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  },
};
export const randomToken = (bytes = 16) => b64u.encode(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));

// --- Keys -----------------------------------------------------------------
export const generateKeys = (extractable = false) => subtle.generateKey(ECDH, extractable, ["deriveBits"]);
export const exportPublic = async (key) => b64u.encode(await subtle.exportKey("raw", key));
export async function importPublic(text) {
  const raw = b64u.decode(text);
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("Invalid public key");
  return subtle.importKey("raw", raw, ECDH, true, []);
}
export const exportPrivate = (key) => subtle.exportKey("jwk", key);
export const importPrivate = (jwk) => subtle.importKey("jwk", jwk, ECDH, false, ["deriveBits"]);

const dh = async (privateKey, publicKey) => new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

// Two directional AES-GCM keys for one connection. `transcript` names both
// parties' long-term and ephemeral public keys and both nonces, in a fixed
// order, so both sides derive the same keys only if they saw the same hello.
export async function deriveSession({ role, staticPrivate, ephemeralPrivate, peerStatic, peerEphemeral, transcript }) {
  const ee = await dh(ephemeralPrivate, await importPublic(peerEphemeral));
  const ss = await dh(staticPrivate, await importPublic(peerStatic));
  const ikm = await subtle.importKey("raw", concat(ee, ss), "HKDF", false, ["deriveBits"]);
  const info = encoder.encode(`anybot-link/${LINK_VERSION}|${transcript.join("|")}`);
  const bits = new Uint8Array(
    await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info }, ikm, 512),
  );
  const key = (bytes) => subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  const toDesktop = await key(bits.slice(0, 32));
  const toPhone = await key(bits.slice(32));
  return role === "desktop" ? { send: toPhone, receive: toDesktop } : { send: toDesktop, receive: toPhone };
}

// Frames carry an 8-byte counter that doubles as the GCM nonce; a receiver
// only accepts counters above the last one it opened. Each direction runs
// one operation at a time, so frames are sealed (and must be sent) in call
// order and opened in arrival order.
export function createCipher({ send, receive }) {
  let sent = 0n;
  let seen = 0n;
  let sealing = Promise.resolve();
  let opening = Promise.resolve();
  const nonce = (counter) => {
    const iv = new Uint8Array(12);
    new DataView(iv.buffer).setBigUint64(4, counter);
    return iv;
  };
  const queue = (tail, job) => {
    const run = tail.then(job);
    return [run, run.catch(() => {})];
  };
  return {
    seal(value) {
      const [run, next] = queue(sealing, async () => {
        sent += 1n;
        const iv = nonce(sent);
        const box = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, send, encoder.encode(JSON.stringify(value))));
        return b64u.encode(concat(iv.slice(4), box));
      });
      sealing = next;
      return run;
    },
    open(text) {
      const [run, next] = queue(opening, async () => {
        const bytes = b64u.decode(text);
        if (bytes.length < 8 + 16 || bytes.length > 1 << 20) throw new Error("Invalid frame");
        const counter = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0);
        if (counter <= seen) throw new Error("Replayed frame");
        const plain = await subtle.decrypt({ name: "AES-GCM", iv: nonce(counter) }, receive, bytes.slice(8));
        seen = counter;
        return JSON.parse(decoder.decode(plain));
      });
      opening = next;
      return run;
    },
  };
}

// The phone's proof that it scanned this desktop's current QR code.
export async function pairingProof(secret, phoneKey, device) {
  const key = await subtle.importKey("raw", b64u.decode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u.encode(await subtle.sign("HMAC", key, encoder.encode(`anybot-pair/${LINK_VERSION}|${device}|${phoneKey}`)));
}
export function sameText(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- The QR code ----------------------------------------------------------
// anybot://link?v=1&relay=<https origin>&room=<id>&key=<desktop key>&code=<secret>&name=<desktop name>
export function buildLink({ relay, room, key, code, name }) {
  const params = new URLSearchParams({ v: String(LINK_VERSION), relay, room, key, code, name: String(name || "").slice(0, 40) });
  return `anybot://link?${params}`;
}
export function parseLink(text) {
  const value = String(text || "").trim();
  const match = value.match(/^anybot:\/\/link\?(.+)$/);
  if (!match) throw new Error("That isn't an Any Bot code. On your computer, open Any Bot → Settings → Your phone.");
  const params = new URLSearchParams(match[1]);
  if (params.get("v") !== String(LINK_VERSION)) throw new Error("This code is from a different version of Any Bot. Update both apps.");
  const relay = relayOrigin(params.get("relay"));
  const link = { relay, room: params.get("room"), key: params.get("key"), code: params.get("code"), name: (params.get("name") || "Your computer").slice(0, 40) };
  if (!TOKEN.test(link.room || "") || !TOKEN.test(link.code || "") || !/^[A-Za-z0-9_-]{80,100}$/.test(link.key || ""))
    throw new Error("This code is incomplete. Try scanning it again.");
  return link;
}
// Relays are addressed by an https origin (http only on this machine, for tests).
export function relayOrigin(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("The relay address is invalid");
  }
  const local = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !local) || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("The relay must be an https:// origin");
  return url.origin;
}
export const relaySocketUrl = (relay, room, query) =>
  `${relay.replace(/^http/, "ws")}/v1/rooms/${room}?${new URLSearchParams(query)}`;
