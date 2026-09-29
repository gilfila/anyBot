import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Coordinator } from "../runtime/coordinator.mjs";
import { buzzHarnessPath } from "../runtime/buzz-bridge.mjs";

// Never touch the real Buzz Desktop folder from tests.
const buzzFolder = join(tmpdir(), `anybot-buzz-app-${process.pid}`);
process.env.ANYBOT_BUZZ_APP_DATA = buzzFolder;

async function fixture(t, runner) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-buzz-"));
  const c = new Coordinator({ directory, concurrency: 1, probe: async () => [], runner });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  await c.command("employees.create", { name: "Sol", role: "Writer", harness: "claude", trusted: true });
  const sol = c.snapshot().employees[0];
  const endpointPath = join(directory, "buzz", "endpoint.json");
  const endpoint = async () => JSON.parse(await readFile(endpointPath, "utf8"));
  return { c, sol, directory, endpointPath, endpoint };
}

// What runtime/anybot-acp.mjs does: POST, then read NDJSON events.
async function ask({ url, token }, body, { signal } = {}) {
  const response = await fetch(`${url}ask`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (response.status !== 200) return { status: response.status, ...(await response.json()) };
  const events = [];
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += Buffer.from(chunk).toString("utf8");
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      events.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  }
  return { status: 200, events, result: events.at(-1) };
}

test("Buzz is off until the owner turns it on; off removes the endpoint", async (t) => {
  const { c, sol, endpointPath } = await fixture(t, async () => "Hi");
  assert.equal(existsSync(endpointPath), false);
  const off = await c.command("buzz.status", { employee: sol.id });
  assert.equal(off.enabled, false);
  assert.equal(off.listening, false);
  assert.equal(off.harness, null);
  assert.equal(off.recent, null);
  const on = await c.command("buzz.set", { enabled: true, employee: sol.id });
  assert.equal(on.listening, true);
  const { url, token } = JSON.parse(await readFile(endpointPath, "utf8"));
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.match(token, /^[0-9a-f]{64}$/);
  await c.command("buzz.set", { enabled: false });
  assert.equal(existsSync(endpointPath), false);
  await assert.rejects(fetch(`${url}ask`, { method: "POST", headers: { authorization: `Bearer ${token}` } }));
});

test("the setting survives a restart", async (t) => {
  const { c, directory, endpointPath } = await fixture(t, async () => "Hi");
  await c.command("buzz.set", { enabled: true });
  await c.close();
  assert.equal(existsSync(endpointPath), false);
  const again = new Coordinator({ directory, concurrency: 1, probe: async () => [], runner: async () => "Hi" });
  await again.initialize();
  assert.equal(existsSync(endpointPath), true);
  await again.close();
});

test("a mention goes to the bot's direct chat and the clean reply streams back", async (t) => {
  const prompts = [];
  const { c, sol, endpoint } = await fixture(t, async (opts) => {
    prompts.push(opts.prompt);
    return "Here is the plan.\n\n```anybot-actions\n[]\n```";
  });
  await c.command("buzz.set", { enabled: true });
  const ep = await endpoint();
  const forged = await ask({ ...ep, token: "0".repeat(64) }, { requestId: "a", employee: "Sol", body: "x" });
  assert.equal(forged.status, 403);

  const first = await ask(ep, { requestId: "evt-1", employee: "sol", body: "Tony: plan the launch", channel: "#launch" });
  assert.equal(first.events[0].type, "accepted");
  assert.deepEqual(first.result, { type: "result", status: "succeeded", reply: "Here is the plan.", error: "" });
  assert.match(prompts[0], /\[Buzz #launch\] Tony: plan the launch/);
  const chat = c.snapshot().conversations.find((conv) => conv.members.length === 1 && conv.members[0] === sol.id);
  assert.ok(chat, "the bot's direct chat");
  assert.ok(c.snapshot().messages.some((m) => m.conversation === chat.id && m.body === "[Buzz #launch] Tony: plan the launch"));

  // The same Buzz event again (buzz-acp replays after a reconnect): no new run.
  const replay = await ask(ep, { requestId: "evt-1", employee: sol.id, body: "Tony: plan the launch", channel: "#launch" });
  assert.equal(replay.result.status, "succeeded");
  assert.equal(c.snapshot().runs.length, 1);
  // The panel shows it arrived.
  const status = await c.command("buzz.status", { employee: sol.id });
  assert.equal(status.recent.channel, "#launch");
  assert.equal(status.recent.status, "succeeded");
});

test("unknown bots and bad requests are refused with a reason", async (t) => {
  const { c, endpoint } = await fixture(t, async () => "Hi");
  await c.command("buzz.set", { enabled: true });
  const ep = await endpoint();
  const unknown = await ask(ep, { requestId: "a", employee: "Nobody", body: "x" });
  assert.equal(unknown.status, 400);
  assert.match(unknown.error, /no bot named "Nobody"/);
  const unlinked = await ask(ep, { requestId: "a", employee: "", body: "x" });
  assert.match(unlinked.error, /ANYBOT_EMPLOYEE/);
  assert.equal((await ask(ep, { requestId: "", employee: "Sol", body: "x" })).status, 400);
  assert.equal((await ask(ep, { requestId: "b", employee: "Sol", body: " " })).status, 400);
  assert.equal(c.snapshot().runs.length, 0);
});

test("a failed run reports its error", async (t) => {
  const { c, endpoint } = await fixture(t, async () => {
    throw new Error("Harness exploded");
  });
  await c.command("buzz.set", { enabled: true });
  const done = await ask(await endpoint(), { requestId: "a", employee: "Sol", body: "x" });
  assert.equal(done.result.status, "failed");
  assert.match(done.result.error, /Harness exploded/);
});

test("the caller hanging up cancels the run", async (t) => {
  let started;
  const running = new Promise((resolve) => (started = resolve));
  const { c, endpoint } = await fixture(t, (opts) => {
    started();
    return new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  });
  await c.command("buzz.set", { enabled: true });
  const controller = new AbortController();
  const pending = ask(await endpoint(), { requestId: "a", employee: "Sol", body: "x" }, { signal: controller.signal }).catch((e) => e);
  await running;
  controller.abort();
  await pending;
  const deadline = Date.now() + 5000;
  while (!["cancelled", "interrupted"].includes(c.snapshot().runs[0].status)) {
    if (Date.now() > deadline) throw new Error(`run is ${c.snapshot().runs[0].status}`);
    await new Promise((r) => setTimeout(r, 10));
  }
});

test("Add to Buzz Desktop writes a custom harness Buzz accepts", async (t) => {
  const { c, sol, directory } = await fixture(t, async () => "Hi");
  t.after(() => rm(buzzFolder, { recursive: true, force: true }));
  await rm(buzzFolder, { recursive: true, force: true });
  await assert.rejects(c.command("buzz.install", { employee: sol.id }), /Buzz Desktop isn't installed/);
  await mkdir(buzzFolder, { recursive: true });
  assert.equal((await c.command("buzz.status")).buzzFound, true);
  const status = await c.command("buzz.install", { employee: sol.id });
  assert.equal(status.harness.current, true);
  const harness = JSON.parse(await readFile(buzzHarnessPath(), "utf8"));
  // Buzz's rules (desktop/src-tauri/src/managed_agents/custom_harnesses.rs).
  assert.match(harness.id, /^[a-z0-9_][a-z0-9_-]*$/);
  assert.equal(harness.command, process.execPath);
  assert.match(harness.args[0], /anybot-acp\.mjs$/);
  assert.ok(existsSync(harness.args[0]));
  assert.ok(harness.args.every((arg) => !arg.includes(",")));
  for (const key of Object.keys(harness.env)) assert.match(key, /^[A-Za-z_][A-Za-z0-9_]*$/);
  assert.equal(harness.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(harness.env.ANYBOT_DATA, directory);
});

test("the Buzz folder follows Tauri's app data location", () => {
  const env = { APPDATA: "C:/Users/x/AppData/Roaming" };
  assert.equal(buzzHarnessPath(env, "win32").replaceAll("\\", "/"), "C:/Users/x/AppData/Roaming/xyz.block.buzz.app/custom_harnesses/anybot.json");
  assert.match(buzzHarnessPath({}, "darwin"), /Application Support[\\/]xyz\.block\.buzz\.app/);
});
