// Any Bot phone relay on Cloudflare Workers. Each desktop gets a Durable
// Object room; sockets use the hibernation API, so an idle room costs
// nothing while the desktop and phones stay connected. See relay/README.md.
import { admit, onClose, onMessage, onOpen, parseJoin } from "./room.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response("Any Bot relay\n", { headers: { "content-type": "text/plain" } });
    let join;
    try {
      join = parseJoin(request.url);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!join) return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(join.room)).fetch(request);
  },
};

const io = {
  send(ws, text) {
    try {
      ws.send(text);
    } catch {
      // The socket is already closing.
    }
  },
  close(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  },
};

export class Room {
  constructor(ctx) {
    this.ctx = ctx;
    // Keepalives are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  entries(except) {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws !== except)
      .map((ws) => ({ ws, ...ws.deserializeAttachment() }));
  }
  async fetch(request) {
    const join = parseJoin(request.url);
    const storage = { get: (key) => this.ctx.storage.get(key), put: (key, value) => this.ctx.storage.put(key, value) };
    const verdict = await admit(join, { storage, entries: this.entries() });
    if (!verdict.ok) return new Response(verdict.reason, { status: verdict.status });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const meta = { side: join.side, device: join.device || null };
    server.serializeAttachment(meta);
    onOpen({ ws: server, ...meta }, this.entries(), io);
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, message) {
    onMessage({ ws, ...ws.deserializeAttachment() }, typeof message === "string" ? message : null, this.entries(), io);
  }
  webSocketClose(ws) {
    onClose({ ws, ...ws.deserializeAttachment() }, this.entries(ws), io);
  }
  webSocketError(ws) {
    onClose({ ws, ...ws.deserializeAttachment() }, this.entries(ws), io);
  }
}
