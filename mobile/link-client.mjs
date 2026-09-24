// Phone side of the phone link: pair by scanning the desktop's QR code, then
// reach the desktop through the relay, end-to-end encrypted
// (runtime/link-protocol.mjs). Offers the same request() as client.mjs, so
// the app does not care which way it is connected.
import {
  LINK_VERSION,
  createCipher,
  deriveSession,
  exportPublic,
  generateKeys,
  pairingProof,
  parseLink,
  randomToken,
  relaySocketUrl,
} from "../runtime/link-protocol.mjs";

const KEEPALIVE_MS = 30 * 1000;

// The pairing survives app restarts. The phone's private key is created
// non-extractable, so even this app's own code can't read it back out.
export function indexedDbStore(name = "anybot-link") {
  const open = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("pairing");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const run = async (mode, job) => {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("pairing", mode);
        const request = job(tx.objectStore("pairing"));
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    get: () => run("readonly", (s) => s.get("current")),
    put: (value) => run("readwrite", (s) => s.put(value, "current")),
    clear: () => run("readwrite", (s) => s.delete("current")),
  };
}
export function memoryStore() {
  let value;
  return { get: async () => value, put: async (next) => void (value = next), clear: async () => void (value = undefined) };
}

export class LinkError extends Error {
  constructor(message, reason) {
    super(message);
    this.reason = reason;
  }
}

// Scan → paired. Resolves once the desktop has accepted this phone and
// proven it holds the key in the code; only then is the pairing saved.
export async function pairWithLink(text, { store, name = "Phone", WebSocketImpl, timeoutMs } = {}) {
  const link = parseLink(text);
  const keys = await generateKeys(false);
  const saved = {
    v: LINK_VERSION,
    relay: link.relay,
    room: link.room,
    desktopKey: link.key,
    desktopName: link.name,
    device: randomToken(16),
    name: String(name).slice(0, 60),
    keys,
    key: await exportPublic(keys.publicKey),
  };
  const client = createLinkClient(saved, { WebSocketImpl, pairingCode: link.code, timeoutMs });
  try {
    await client.ready();
    // The first request confirms the pairing on the desktop.
    await client.request("/overview");
  } catch (error) {
    client.close();
    throw error;
  }
  await store.put(saved);
  return client;
}

export async function resumeLink({ store, WebSocketImpl, timeoutMs, onStatus } = {}) {
  const saved = await store.get();
  if (!saved || saved.v !== LINK_VERSION) return null;
  return createLinkClient(saved, { WebSocketImpl, timeoutMs, onStatus });
}

export function createLinkClient(saved, { WebSocketImpl = globalThis.WebSocket, pairingCode = null, timeoutMs = 12000, onStatus = () => {} } = {}) {
  let ws = null;
  let cipher = null;
  let pendingHello = null;
  let closed = false;
  let retry = 0;
  let timer = null;
  let keepalive = null;
  let status = "connecting";
  let failure = null;
  const waiters = new Map();
  let readyWaiters = [];

  const setStatus = (next, error = null) => {
    status = next;
    failure = error;
    if (next === "online" || error) {
      for (const waiter of readyWaiters) (error ? waiter.reject(error) : waiter.resolve());
      readyWaiters = [];
    }
    onStatus(next, error);
  };
  const failAll = (error) => {
    for (const waiter of waiters.values()) waiter.reject(error);
    waiters.clear();
  };
  const offline = () => new LinkError(`${saved.desktopName} is offline. Open Any Bot on your computer and keep it running.`, "offline");

  async function sayHello() {
    const ephemeral = await generateKeys(false);
    pendingHello = { ephemeral, key: await exportPublic(ephemeral.publicKey), nonce: randomToken(16) };
    ws?.readyState === 1 &&
      ws.send(
        JSON.stringify({
          t: "hello",
          v: LINK_VERSION,
          name: saved.name,
          key: saved.key,
          eph: pendingHello.key,
          nonce: pendingHello.nonce,
          ...(pairingCode ? { proof: await pairingProof(pairingCode, saved.key, saved.device) } : {}),
        }),
      );
  }

  async function welcome(message) {
    if (!pendingHello || message.v !== LINK_VERSION) return;
    const hello = pendingHello;
    pendingHello = null;
    const keys = await deriveSession({
      role: "phone",
      staticPrivate: saved.keys.privateKey,
      ephemeralPrivate: hello.ephemeral.privateKey,
      peerStatic: saved.desktopKey,
      peerEphemeral: message.eph,
      transcript: [saved.room, saved.device, saved.desktopKey, saved.key, message.eph, hello.key, hello.nonce, message.nonce],
    });
    const next = createCipher(keys);
    let confirm = null;
    try {
      confirm = await next.open(message.box);
    } catch {
      // Not the computer from the QR code: refuse to talk to it.
    }
    if (confirm?.t !== "confirm") {
      setStatus("denied", new LinkError("Couldn't verify your computer. Scan the code again.", "verify"));
      return shut();
    }
    cipher = next;
    pairingCode = null;
    retry = 0;
    setStatus("online");
  }

  async function onMessage(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return; // "pong"
    }
    if (message.relay === "online") {
      cipher = null;
      return sayHello();
    }
    if (message.relay === "offline") {
      cipher = null;
      failAll(offline());
      return setStatus("offline", pairingCode ? offline() : null);
    }
    if (message.t === "welcome") return welcome(message);
    if (message.t === "retry") {
      cipher = null;
      failAll(new LinkError("Reconnecting…", "retry"));
      return sayHello();
    }
    if (message.t === "denied") {
      const error = new LinkError(message.message || "Your computer refused this phone.", message.reason);
      failAll(error);
      setStatus("denied", error);
      return shut();
    }
    if (message.t === "res" && cipher) {
      let out;
      try {
        out = await cipher.open(message.box);
      } catch {
        return;
      }
      const waiter = waiters.get(out.id);
      if (!waiter) return;
      waiters.delete(out.id);
      if (out.status >= 400) {
        const error = new Error(out.value?.error || "Request failed");
        error.status = out.status;
        waiter.reject(error);
      } else waiter.resolve(out.value);
    }
  }

  function connect() {
    if (closed) return;
    const socket = new WebSocketImpl(relaySocketUrl(saved.relay, saved.room, { side: "phone", device: saved.device }));
    ws = socket;
    socket.onopen = () => {
      clearInterval(keepalive);
      keepalive = setInterval(() => socket.readyState === 1 && socket.send("ping"), KEEPALIVE_MS);
    };
    // Say hello once the relay says whether the desktop is there.
    socket.onmessage = (event) => onMessage(typeof event.data === "string" ? event.data : "").catch(() => {});
    socket.onerror = () => {};
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      cipher = null;
      clearInterval(keepalive);
      failAll(new LinkError("Connection lost. Reconnecting…", "network"));
      if (closed) return;
      if (status !== "denied") setStatus("connecting");
      timer = setTimeout(connect, Math.min(15000, 500 * 2 ** retry++));
    };
  }
  function shut() {
    closed = true;
    clearTimeout(timer);
    clearInterval(keepalive);
    const socket = ws;
    ws = null;
    socket?.close();
  }
  connect();

  return {
    origin: `Linked to ${saved.desktopName}`,
    linked: true,
    desktopName: saved.desktopName,
    get status() {
      return status;
    },
    ready() {
      if (status === "online") return Promise.resolve();
      if (failure && status === "denied") return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        readyWaiters.push(waiter);
        setTimeout(() => {
          readyWaiters = readyWaiters.filter((w) => w !== waiter);
          reject(status === "offline" ? offline() : new LinkError("Couldn't reach your computer. Check this phone's internet connection.", "timeout"));
        }, timeoutMs);
      });
    },
    async request(path, { method = "GET", body } = {}) {
      await this.ready();
      if (!cipher) throw new LinkError("Reconnecting…", "retry");
      const id = randomToken(9);
      const result = new Promise((resolve, reject) => {
        waiters.set(id, { resolve, reject });
        setTimeout(() => {
          if (waiters.delete(id)) reject(new LinkError("Your computer didn't answer in time.", "timeout"));
        }, timeoutMs);
      });
      const box = await cipher.seal({ id, method, path: `/v1${path}`, ...(body ? { body } : {}) });
      ws?.readyState === 1 ? ws.send(JSON.stringify({ t: "req", box })) : failAll(new LinkError("Reconnecting…", "network"));
      return result;
    },
    close: shut,
  };
}
