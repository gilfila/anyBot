import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../relay/node-server.mjs";
import { createMobileGateway } from "../runtime/mobile-gateway.mjs";
import { createPhoneLink } from "../runtime/phone-link.mjs";
import { buildLink, createCipher, deriveSession, exportPublic, generateKeys, parseLink, randomToken } from "../runtime/link-protocol.mjs";
import { memoryStore, pairWithLink, resumeLink } from "../mobile/link-client.mjs";

// ANYBOT_TEST_RELAY runs these against another relay, such as the Cloudflare
// Worker under `wrangler dev` (see relay/README.md); by default, the Node one.
const relayFor = async () =>
  process.env.ANYBOT_TEST_RELAY ? { url: process.env.ANYBOT_TEST_RELAY, close: async () => {} } : startRelay();
const until = async (check, what, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

// A coordinator stand-in: enough state for the gateway's routes.
function workspace() {
  const state = {
    employees: [{ id: "e1", name: "Sol", role: "Writer", harness: "claude", archived: 0 }],
    conversations: [{ id: "c1", title: "Launch", members: ["e1"] }],
    messages: [],
    runs: [],
    runtime: { paused: false, active: 0, version: "test" },
  };
  const calls = [];
  const command = async (method, payload) => {
    calls.push([method, payload]);
    if (method === "messages.send") state.messages.push({ id: randomToken(8), conversation: payload.conversation, body: payload.body, author: "human" });
    return structuredClone(state);
  };
  return { state, calls, command };
}

async function setup(t, { relayUp = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "anybot-link-"));
  const relay = await relayFor();
  const ws = workspace();
  const gateway = createMobileGateway({ command: ws.command, serve: false });
  const open = async () => {
    const link = await createPhoneLink({ statePath: join(dir, "phone-link.json"), relay: relay.url, gateway, name: "Test PC" });
    if (relayUp) {
      link.start();
      await until(() => link.status().connection === "online", "desktop online");
    }
    return link;
  };
  const clients = [];
  const track = (client) => (clients.push(client), client);
  const link = await open();
  const all = { links: [link] };
  t.after(async () => {
    for (const c of clients) c.close();
    for (const l of all.links) l.stop();
    await relay.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, relay, ws, gateway, link, open: async () => (all.links.push(await open()), all.links.at(-1)), track };
}

test("a phone pairs from the QR code and reaches the desktop, end to end", async (t) => {
  const { link, ws, track } = await setup(t);
  const { link: code, expiresAt } = link.createPairing();
  assert.ok(expiresAt > Date.now());
  assert.equal(parseLink(code).name, "Test PC");
  const store = memoryStore();
  const phone = track(await pairWithLink(code, { store, name: "Pixel 8" }));
  assert.equal(phone.status, "online");
  const overview = await phone.request("/overview");
  assert.deepEqual(overview.employees.map((e) => e.name), ["Sol"]);
  assert.equal(overview.deviceRole, "operator");
  assert.equal(overview.memberRole, "owner");
  await phone.request("/conversations/c1/messages", { method: "POST", body: { body: "Draft the launch post", recipients: ["e1"], requestId: "r1" } });
  assert.deepEqual(ws.calls.find(([m]) => m === "messages.send")[1], { body: "Draft the launch post", recipients: ["e1"], requestId: "r1", conversation: "c1" });
  // Errors come back as errors, with the gateway's status.
  await assert.rejects(phone.request("/conversations/nope"), (e) => e.status === 404);
  const status = link.status();
  assert.deepEqual(status.devices.map((d) => [d.name, d.connected]), [["Pixel 8", true]]);
  assert.equal(status.pairing, null, "a code works once");
  assert.ok((await store.get()).keys.privateKey, "the pairing is saved for next time");
});

test("a used, expired, or tampered code pairs nothing", async (t) => {
  const { link, track } = await setup(t);
  const { link: code } = link.createPairing();
  track(await pairWithLink(code, { store: memoryStore(), name: "First" }));
  await assert.rejects(pairWithLink(code, { store: memoryStore(), name: "Second" }), (e) => e.reason === "expired");
  // A code whose key was swapped (someone else's "desktop" in the middle):
  // the phone refuses because the desktop can't prove it holds that key.
  const fresh = parseLink(link.createPairing().link);
  const other = await exportPublic((await generateKeys()).publicKey);
  const store = memoryStore();
  await assert.rejects(pairWithLink(buildLink({ ...fresh, key: other }), { store }), (e) => e.reason === "verify");
  assert.equal(await store.get(), undefined, "nothing saved");
  assert.deepEqual(link.status().devices.map((d) => d.name), ["First"], "a phone that rejected the desktop never shows as paired");
  assert.throws(() => parseLink("https://example.com"), /isn't an Any Bot code/);
});

test("the pairing survives restarts on both ends, and removal on the desktop ends it", async (t) => {
  const env = await setup(t);
  const store = memoryStore();
  const first = await pairWithLink(env.link.createPairing().link, { store, name: "Pixel" });
  first.close();
  // Phone app restart.
  const resumed = env.track(await resumeLink({ store }));
  assert.equal((await resumed.request("/overview")).employees.length, 1);
  // Desktop restart: same identity and devices from disk.
  env.link.stop();
  const again = await env.open();
  await until(() => again.status().devices[0]?.connected, "phone reconnected after desktop restart");
  assert.equal((await resumed.request("/overview")).employees.length, 1);
  // Removed on the desktop: the phone is cut off and told why.
  const [phone] = again.status().devices;
  again.remove(phone.id);
  await until(() => resumed.status === "denied", "phone told it was removed", 8000);
  await assert.rejects(resumed.request("/overview"), (e) => e.reason === "unpaired");
});

test("pairing with the desktop offline says so", async (t) => {
  const { link } = await setup(t, { relayUp: false });
  const code = link.createPairing().link;
  await assert.rejects(pairWithLink(code, { store: memoryStore(), timeoutMs: 3000 }), /offline/);
});

test("frames are sealed per direction and can't be replayed or altered", async () => {
  const desktop = { s: await generateKeys(), e: await generateKeys() };
  const phone = { s: await generateKeys(), e: await generateKeys() };
  const pub = async (k) => exportPublic(k.publicKey);
  const transcript = ["room", "device", await pub(desktop.s), await pub(phone.s), await pub(desktop.e), await pub(phone.e), "n1", "n2"];
  const d = createCipher(await deriveSession({ role: "desktop", staticPrivate: desktop.s.privateKey, ephemeralPrivate: desktop.e.privateKey, peerStatic: await pub(phone.s), peerEphemeral: await pub(phone.e), transcript }));
  const p = createCipher(await deriveSession({ role: "phone", staticPrivate: phone.s.privateKey, ephemeralPrivate: phone.e.privateKey, peerStatic: await pub(desktop.s), peerEphemeral: await pub(desktop.e), transcript }));
  const box = await p.seal({ hi: 1 });
  assert.deepEqual(await d.open(box), { hi: 1 });
  await assert.rejects(d.open(box), /Replayed/);
  const next = await p.seal({ hi: 2 });
  const flipped = next.slice(0, -2) + (next.at(-2) === "A" ? "B" : "A") + next.at(-1);
  await assert.rejects(d.open(flipped));
  // A phone key can't open what the phone itself sent.
  await assert.rejects(p.open(await p.seal({ hi: 3 })));
  // Many in flight still arrive in order.
  const boxes = await Promise.all([1, 2, 3, 4, 5].map((n) => d.seal({ n })));
  for (const [i, b] of boxes.entries()) assert.deepEqual(await p.open(b), { n: i + 1 });
});

test("the relay keeps rooms to their desktop and caps frame size", async (t) => {
  const relay = await relayFor();
  t.after(() => relay.close());
  const room = randomToken(16);
  const url = (q) => `${relay.url.replace("http", "ws")}/v1/rooms/${room}?${new URLSearchParams(q)}`;
  const opened = (ws) => new Promise((resolve) => {
    ws.onopen = () => resolve(true);
    ws.onerror = () => resolve(false);
  });
  const owner = new WebSocket(url({ side: "desktop", secret: "s".repeat(32) }));
  assert.equal(await opened(owner), true);
  const squatter = new WebSocket(url({ side: "desktop", secret: "x".repeat(32) }));
  assert.equal(await opened(squatter), false, "a different desktop secret is refused");
  const phone = new WebSocket(url({ side: "phone", device: "d".repeat(22) }));
  const notes = [];
  phone.onmessage = (e) => notes.push(e.data);
  assert.equal(await opened(phone), true);
  await until(() => notes.includes('{"relay":"online"}'), "phone told desktop is online");
  const closed = new Promise((resolve) => (phone.onclose = (e) => resolve(e.code)));
  phone.send("x".repeat(70 * 1024));
  assert.ok([1009, 1006].includes(await closed), "oversized frame closes the socket");
  owner.close();
});
