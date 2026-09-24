// The same relay as relay/worker.mjs, on plain Node, for tests and for
// self-hosting (put it behind a TLS proxy; phones only connect over wss).
//   node relay/node-server.mjs --port 8787
import http from "node:http";
import { WebSocketServer } from "ws";
import { MAX_FRAME, admit, onClose, onMessage, onOpen, parseJoin } from "./room.mjs";

const io = {
  send(ws, text) {
    if (ws.readyState === 1) ws.send(text);
  },
  close(ws, code, reason) {
    ws.close(code, reason);
  },
};

export async function startRelay({ port = 0, host = "127.0.0.1" } = {}) {
  const rooms = new Map();
  const roomFor = (id) => {
    if (!rooms.has(id)) {
      const values = new Map();
      rooms.set(id, {
        entries: new Set(),
        storage: { get: async (key) => values.get(key), put: async (key, value) => void values.set(key, value) },
      });
    }
    return rooms.get(id);
  };
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === "/" ? 200 : 404, { "content-type": "text/plain" });
    res.end(req.url === "/" ? "Any Bot relay\n" : "Not found\n");
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME + 1024 });
  const refuse = (socket, status, reason) => {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  server.on("upgrade", async (req, socket, head) => {
    let join;
    try {
      join = parseJoin(`http://relay${req.url}`);
    } catch {
      return refuse(socket, 400, "Bad Request");
    }
    if (!join) return refuse(socket, 404, "Not Found");
    const room = roomFor(join.room);
    const verdict = await admit(join, { storage: room.storage, entries: [...room.entries] });
    if (!verdict.ok) return refuse(socket, verdict.status, verdict.reason);
    wss.handleUpgrade(req, socket, head, (ws) => {
      const entry = { ws, side: join.side, device: join.device || null };
      room.entries.add(entry);
      onOpen(entry, [...room.entries], io);
      ws.on("message", (data, binary) => onMessage(entry, binary ? null : data.toString(), [...room.entries], io));
      // Oversized frames surface here; ws then closes the socket with 1009.
      ws.on("error", () => {});
      ws.on("close", () => {
        room.entries.delete(entry);
        onClose(entry, [...room.entries, entry], io);
      });
    });
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  return {
    url: `http://${host}:${address.port}`,
    rooms,
    close() {
      for (const room of rooms.values()) for (const entry of room.entries) entry.ws.terminate();
      wss.close();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("node-server.mjs")) {
  const at = process.argv.indexOf("--port");
  const relay = await startRelay({ port: at > 0 ? Number(process.argv[at + 1]) : 8787, host: process.env.HOST || "127.0.0.1" });
  console.log(`Any Bot relay listening on ${relay.url}`);
}
