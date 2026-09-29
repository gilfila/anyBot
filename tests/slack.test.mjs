import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSlackBridge } from "../runtime/slack-bridge.mjs";
import { fromSlackText, slackChunks, slackCreateAppUrl, slackManifest, SLACK_SCOPES, toSlackText } from "../runtime/slack-format.mjs";
import { Coordinator } from "../runtime/coordinator.mjs";

const BOT = "xoxb-1111-2222-abcdefabcdef";
const APP = "xapp-1-A111-3333-abcdefabcdef";
const flush = () => new Promise((r) => setTimeout(r, 5));
const until = async (check, what) => {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await flush();
  }
};

// A pretend Slack: Web API calls are recorded and answered, and each Socket
// Mode connection is a fake socket the test pushes envelopes through.
function fakeSlack({ fail = {}, drop = {} } = {}) {
  const calls = [];
  const sockets = [];
  const fetchImpl = async (url, init) => {
    const method = url.replace("https://slack.com/api/", "");
    // `drop[method]` connections time out before reaching Slack, as fetch does.
    if (drop[method] > 0) {
      drop[method]--;
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
    }
    const args = Object.fromEntries(new URLSearchParams(init.body));
    calls.push({ method, token: init.headers.authorization.replace("Bearer ", ""), args });
    const answer = fail[method]
      ? { ok: false, error: fail[method] }
      : method === "auth.test"
        ? { ok: true, team: "Tony's team", team_id: "T1", user: "chief", user_id: "UBOT" }
        : method === "apps.connections.open"
          ? { ok: true, url: `wss://slack.test/${sockets.length}` }
          : method === "users.info"
            ? { ok: true, user: { real_name: "Tony G", profile: { display_name: "Tony" } } }
            : { ok: true, ts: "999.1" };
    return { status: 200, json: async () => answer, headers: { get: () => null } };
  };
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      sockets.push(this);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.closed = true;
      this.onclose?.();
    }
    push(envelope) {
      this.onmessage({ data: JSON.stringify(envelope) });
    }
  }
  const posts = (method = "chat.postMessage") => calls.filter((c) => c.method === method);
  return { calls, sockets, fetchImpl, WebSocketImpl: FakeSocket, posts };
}

const dm = (user, text, ts = "100.1") => ({
  envelope_id: `env-${ts}`,
  type: "events_api",
  payload: { event: { type: "message", channel_type: "im", channel: "D1", user, text, ts } },
});

async function bridgeFixture(t, { updates, fail, drop, clock = Date.now, onDiagnostic } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "anybot-slack-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const slack = fakeSlack({ fail, drop });
  const requests = [];
  const bridge = createSlackBridge({
    statePath: join(directory, "slack.json"),
    request: async (method, payload) => {
      requests.push({ method, payload });
      if (method === "bridge.send") return { conversation: "c1", message: `m-${requests.length}` };
      if (method === "bridge.updates") return { items: payload.messages.map((message) => ({ message, ...(updates?.(message) || { status: "running", approvals: [] }) })) };
      return {};
    },
    protect: (text) => `enc:${Buffer.from(text).toString("base64")}`,
    unprotect: (text) => Buffer.from(text.slice(4), "base64").toString(),
    fetchImpl: slack.fetchImpl,
    WebSocketImpl: slack.WebSocketImpl,
    retryMs: [5],
    clock,
    onDiagnostic,
    pollMs: 60_000,
  });
  t.after(() => bridge.stop());
  bridge.start();
  return { bridge, slack, requests, directory };
}

test("Slack text converts both ways, and long replies split", () => {
  assert.equal(
    toSlackText("# Plan\n**Ship it** & see [the doc](https://x.test/a?b=1&c=2)\n- one\n`<tag>`\n```js\nif (a < b) {}\n```"),
    "*Plan*\n*Ship it* &amp; see <https://x.test/a?b=1&amp;c=2|the doc>\n• one\n`&lt;tag&gt;`\n```\nif (a &lt; b) {}\n```",
  );
  assert.equal(
    fromSlackText("<@UBOT> ask <@U2|sam> about <#C1|general> and <https://x.test|this> &amp; <!here>", "UBOT"),
    "ask @sam about #general and this (https://x.test) & @here",
  );
  const chunks = slackChunks(`${"a".repeat(3000)}\n\n${"b".repeat(3000)}`);
  assert.deepEqual(chunks.map((c) => c.length), [3000, 3000]);
  assert.deepEqual(slackChunks(""), [""]);
});

test("each bot's Slack app manifest uses Socket Mode and only the scopes the bridge needs", () => {
  const manifest = slackManifest("Chief of Staff");
  assert.equal(manifest.display_information.name, "Chief of Staff");
  assert.equal(manifest.features.bot_user.display_name, "Chief of Staff");
  assert.equal(manifest.settings.socket_mode_enabled, true);
  assert.equal(manifest.settings.interactivity.is_enabled, true);
  assert.deepEqual(manifest.settings.event_subscriptions.bot_events, ["app_mention", "message.im"]);
  assert.deepEqual(manifest.oauth_config.scopes.bot, SLACK_SCOPES);
  assert.equal(slackManifest("x".repeat(60)).display_information.name.length, 35);
  const url = new URL(slackCreateAppUrl("Chief"));
  assert.equal(url.host, "api.slack.com");
  assert.equal(JSON.parse(url.searchParams.get("manifest_json")).display_information.name, "Chief");
});

test("connecting checks both tokens, stores them encrypted, and starts a pairing code", async (t) => {
  const { bridge, slack, directory } = await bridgeFixture(t);
  await assert.rejects(bridge.connect("e1", { botToken: "nope", appToken: APP }), /xoxb-/);
  await assert.rejects(bridge.connect("e1", { botToken: BOT, appToken: "xoxb-wrong-kind-12345" }), /xapp-/);
  const status = await bridge.connect("e1", { botToken: ` ${BOT} `, appToken: APP });
  assert.equal(status.connected, true);
  assert.equal(status.team, "Tony's team");
  assert.equal(status.botName, "chief");
  assert.match(status.pairing.code, /^\d{6}$/);
  assert.equal(JSON.stringify(status).includes("xox"), false, "tokens never leave the bridge");
  const saved = await readFile(join(directory, "slack.json"), "utf8");
  assert.equal(saved.includes(BOT) || saved.includes(APP), false, "tokens are stored protected");
  await until(() => slack.sockets.length === 1, "the Socket Mode connection");
  slack.sockets[0].push({ type: "hello" });
  assert.equal(bridge.status("e1").state, "online");
  assert.deepEqual(bridge.overview(), { e1: "online" });
  await assert.rejects(bridge.connect("e2", { botToken: BOT, appToken: APP }), /already connected to another bot/);
});

test("only paired people reach the bot; a stranger is told once, the code pairs by DM", async (t) => {
  const { bridge, slack, requests } = await bridgeFixture(t);
  const { pairing } = await bridge.connect("e1", { botToken: BOT, appToken: APP });
  await until(() => slack.sockets.length === 1, "socket");
  const socket = slack.sockets[0];
  socket.push(dm("U9", "do my taxes", "1.1"));
  socket.push(dm("U9", "please", "1.2"));
  await until(() => slack.posts().length === 1, "the refusal");
  await flush();
  assert.equal(slack.posts().length, 1, "one refusal an hour");
  assert.match(slack.posts()[0].args.text, /only take work from people paired/);
  assert.deepEqual(socket.sent.map((a) => a.envelope_id), ["env-1.1", "env-1.2"], "every envelope is acked");
  assert.equal(requests.filter((r) => r.method === "bridge.send").length, 0);

  socket.push(dm("U1", `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}`, "2.1"));
  await until(() => bridge.status("e1").users.length === 1, "pairing");
  assert.deepEqual(bridge.status("e1").users, [{ id: "U1", name: "Tony" }]);
  assert.equal(bridge.status("e1").pairing, null, "a code works once");
  await until(() => slack.posts().length === 2, "the pairing reply");
  assert.match(slack.posts()[1].args.text, /You're paired/);
  bridge.removeUser("e1", "U1");
  assert.deepEqual(bridge.status("e1").users, []);
});

test("a pasted code pairs even when Slack keeps its bold", async (t) => {
  const { bridge, slack } = await bridgeFixture(t);
  const { pairing } = await bridge.connect("e1", { botToken: BOT, appToken: APP });
  await until(() => slack.sockets.length === 1, "socket");
  // Copied from Any Bot's panel, where the code is <strong>123 456</strong>.
  slack.sockets[0].push(dm("U1", `*${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}*`, "1.1"));
  await until(() => bridge.status("e1").users.length === 1, "pairing");
});

test("a wrong or expired code is always answered, and five wrong guesses cancel the code", async (t) => {
  let now = Date.now();
  const { bridge, slack } = await bridgeFixture(t, { clock: () => now });
  const { pairing } = await bridge.connect("e1", { botToken: BOT, appToken: APP });
  await until(() => slack.sockets.length === 1, "socket");
  const socket = slack.sockets[0];
  const wrong = String((Number(pairing.code) + 1) % 1_000_000).padStart(6, "0");
  socket.push(dm("U9", "hello", "1.0"));
  await until(() => slack.posts().length === 1, "the refusal");
  // Right after the refusal, which mutes plain messages for an hour.
  socket.push(dm("U1", wrong, "1.1"));
  await until(() => slack.posts().length === 2, "the wrong-code answer");
  assert.match(slack.posts()[1].args.text, /isn't the pairing code/);
  for (let i = 2; i <= 5; i++) socket.push(dm("U1", wrong, `1.${i}`));
  await until(() => slack.posts().length === 6, "every guess answered");
  assert.equal(bridge.status("e1").pairing, null, "cancelled after five misses");
  assert.match(slack.posts()[5].args.text, /expired or was already used/);
  socket.push(dm("U1", pairing.code, "2.0"));
  await until(() => slack.posts().length === 7, "the old code refused");
  assert.equal(bridge.status("e1").users.length, 0);

  const fresh = bridge.pair("e1").pairing;
  now += 11 * 60_000;
  socket.push(dm("U1", fresh.code, "3.0"));
  await until(() => slack.posts().length === 8, "the expired-code answer");
  assert.match(slack.posts()[7].args.text, /expired or was already used/);
  assert.equal(bridge.status("e1").users.length, 0);
});

test("a Slack call that times out before connecting is retried, and a lost refusal doesn't mute the hour", async (t) => {
  const drop = { "chat.postMessage": 3 };
  const diagnostics = [];
  const { bridge, slack } = await bridgeFixture(t, { drop, onDiagnostic: (entry) => diagnostics.push(entry) });
  const { pairing } = await bridge.connect("e1", { botToken: BOT, appToken: APP });
  await until(() => slack.sockets.length === 1, "socket");
  const socket = slack.sockets[0];
  // Three timeouts in a row outlast the retries: this refusal is lost...
  socket.push(dm("U9", "hello", "1.0"));
  await until(() => drop["chat.postMessage"] === 0, "every attempt");
  await flush();
  assert.equal(slack.posts().length, 0);
  assert.equal(diagnostics.at(-1).message, "fetch failed (UND_ERR_CONNECT_TIMEOUT)", "the log says why");
  // ...so the next message is answered instead of met with silence.
  drop["chat.postMessage"] = 1;
  socket.push(dm("U9", "hello?", "1.1"));
  await until(() => slack.posts().length === 1, "the refusal, after one retry");
  socket.push(dm("U1", pairing.code, "2.0"));
  await until(() => bridge.status("e1").users.length === 1, "pairing");
});

test("a paired DM becomes work for the bot, and its reply comes back to the DM", async (t) => {
  let result = { status: "running", approvals: [] };
  const { bridge, slack, requests } = await bridgeFixture(t, { updates: () => result });
  const { pairing } = await bridge.connect("e1", { botToken: BOT, appToken: APP });
  await until(() => slack.sockets.length === 1, "socket");
  const socket = slack.sockets[0];
  socket.push(dm("U1", pairing.code, "1.0"));
  await until(() => bridge.status("e1").users.length === 1, "pairing");

  socket.push(dm("U1", "<@UBOT> draft the **weekly** update", "5.5"));
  socket.push(dm("U1", "<@UBOT> draft the **weekly** update", "5.5"));
  await until(() => requests.some((r) => r.method === "bridge.send"), "the message");
  await flush();
  const sends = requests.filter((r) => r.method === "bridge.send");
  assert.equal(sends.length, 1, "Slack's retries don't duplicate work");
  assert.deepEqual(sends[0].payload, { employee: "e1", body: "[Slack DM] draft the **weekly** update", requestId: "slack:T1:D1:5.5" });
  await until(() => slack.posts("reactions.add").length === 1, "the eyes reaction");
  assert.equal(bridge.status("e1").waiting, 1);

  result = { status: "succeeded", reply: "## Done\n**Shipped** it", approvals: [] };
  await bridge.refresh();
  const reply = slack.posts().at(-1);
  assert.equal(reply.args.channel, "D1");
  assert.equal(reply.args.thread_ts, undefined, "a top-level DM gets a top-level reply");
  assert.equal(reply.args.text, "*Done*\n*Shipped* it");
  assert.equal(reply.token, BOT);
  assert.equal(bridge.status("e1").waiting, 0);
  assert.equal(slack.posts("reactions.remove").length, 1);
});

test("a channel @mention is answered in its thread; failures and approvals are posted", async (t) => {
  let result = { status: "running", approvals: [{ id: "a1", tool: "Bash", summary: "rm -rf build" }] };
  const { bridge, slack, requests } = await bridgeFixture(t, { updates: () => result });
  const { pairing } = await bridge.connect("e1", { botToken: BOT, appToken: APP });
  await until(() => slack.sockets.length === 1, "socket");
  const socket = slack.sockets[0];
  socket.push(dm("U1", pairing.code, "1.0"));
  await until(() => bridge.status("e1").users.length === 1, "pairing");
  socket.push({
    envelope_id: "env-m",
    type: "events_api",
    payload: { event: { type: "app_mention", channel: "C7", user: "U1", text: "<@UBOT> clean the build", ts: "7.7" } },
  });
  await until(() => requests.some((r) => r.method === "bridge.send"), "the mention");
  assert.equal(requests.find((r) => r.method === "bridge.send").payload.body, "[Slack channel] clean the build");

  await bridge.refresh();
  await bridge.refresh();
  const approvals = slack.posts().filter((p) => p.args.blocks);
  assert.equal(approvals.length, 1, "each approval is posted once");
  assert.equal(approvals[0].args.thread_ts, "7.7");
  const blocks = JSON.parse(approvals[0].args.blocks);
  assert.deepEqual(blocks[1].elements.map((e) => [e.action_id, e.value]), [["anybot.approve", "a1"], ["anybot.deny", "a1"]]);

  // A stranger's click does nothing; the paired person's approves.
  const click = (user) => ({
    envelope_id: `click-${user}`,
    type: "interactive",
    payload: {
      type: "block_actions",
      user: { id: user },
      actions: [{ action_id: "anybot.approve", value: "a1" }],
      channel: { id: "C7" },
      message: { ts: "999.1", blocks },
    },
  });
  socket.push(click("U9"));
  socket.push(click("U1"));
  await until(() => slack.posts("chat.update").length === 1, "the updated approval");
  assert.deepEqual(requests.filter((r) => r.method === "approvals.decide").map((r) => r.payload), [{ id: "a1", decision: "allow" }]);
  assert.match(slack.posts("chat.update")[0].args.text, /Approved by Tony/);

  result = { status: "failed", error: "Codex exited 1\nstack…", approvals: [] };
  await bridge.refresh();
  const failure = slack.posts().at(-1);
  assert.equal(failure.args.text, "I couldn't finish that: Codex exited 1");
  assert.equal(failure.args.thread_ts, "7.7");
});

test("work cut off when Any Bot stopped gets an answer instead of a 24-hour wait", async (t) => {
  let result = { status: "running", approvals: [] };
  const { bridge, slack } = await bridgeFixture(t, { updates: () => result });
  const { pairing } = await bridge.connect("e1", { botToken: BOT, appToken: APP });
  await until(() => slack.sockets.length === 1, "socket");
  const socket = slack.sockets[0];
  socket.push(dm("U1", pairing.code, "1.0"));
  await until(() => bridge.status("e1").users.length === 1, "pairing");
  socket.push(dm("U1", "<@UBOT> render the video", "6.6"));
  await until(() => bridge.status("e1").waiting === 1, "the request");
  result = { status: "interrupted", error: "Any Bot stopped during this run (it quit, updated, or crashed).", approvals: [] };
  await bridge.refresh();
  assert.match(slack.posts().at(-1).args.text, /Any Bot stopped before I finished/);
  assert.equal(bridge.status("e1").waiting, 0);
});

test("a hand-off is announced once, and Slack waits for the bot's final answer", async (t) => {
  let result = { status: "running", approvals: [], handoffs: [{ id: "r2", to: "Nova" }] };
  const { bridge, slack } = await bridgeFixture(t, { updates: () => result });
  const { pairing } = await bridge.connect("e1", { botToken: BOT, appToken: APP });
  await until(() => slack.sockets.length === 1, "socket");
  const socket = slack.sockets[0];
  socket.push(dm("U1", pairing.code, "1.0"));
  await until(() => bridge.status("e1").users.length === 1, "pairing");
  socket.push(dm("U1", "<@UBOT> price the course", "8.8"));
  await until(() => bridge.status("e1").waiting === 1, "the request");
  await bridge.refresh();
  await bridge.refresh();
  const handed = slack.posts().filter((p) => /Handed to Nova/.test(p.args.text));
  assert.equal(handed.length, 1, "each hand-off is announced once");
  assert.equal(bridge.status("e1").waiting, 1, "still waiting for the answer");
  assert.equal(slack.posts("reactions.remove").length, 0, "still working");
  result = { status: "succeeded", reply: "Charge $15.", approvals: [], handoffs: [{ id: "r2", to: "Nova" }] };
  await bridge.refresh();
  assert.equal(slack.posts().at(-1).args.text, "Charge $15.");
  assert.equal(bridge.status("e1").waiting, 0);
});

test("files attached in Slack are refused politely; any text still goes to the bot", async (t) => {
  const { bridge, slack, requests } = await bridgeFixture(t);
  const { pairing } = await bridge.connect("e1", { botToken: BOT, appToken: APP });
  await until(() => slack.sockets.length === 1, "socket");
  const socket = slack.sockets[0];
  socket.push(dm("U1", pairing.code, "1.0"));
  await until(() => bridge.status("e1").users.length === 1, "pairing");
  const withFile = (text, ts) => {
    const envelope = dm("U1", text, ts);
    Object.assign(envelope.payload.event, { subtype: "file_share", files: [{ id: "F1", name: "storyboard.pdf" }] });
    return envelope;
  };
  socket.push(withFile("<@UBOT> cut this down to 60s", "9.1"));
  await until(() => requests.some((r) => r.method === "bridge.send"), "the text");
  const sent = requests.find((r) => r.method === "bridge.send").payload.body;
  assert.match(sent, /^\[Slack DM\] cut this down to 60s/);
  assert.match(sent, /storyboard\.pdf/, "the bot hears a file was left behind");
  await until(() => slack.posts().some((p) => /can't open files from Slack/.test(p.args.text)), "the file notice");
  // A file with no text: nothing to forward, but the sender hears why.
  socket.push(withFile("", "9.2"));
  await until(() => slack.posts().filter((p) => /can't open files from Slack/.test(p.args.text)).length === 2, "the second notice");
  assert.equal(requests.filter((r) => r.method === "bridge.send").length, 1);
  // Edits and deletions are still ignored.
  const edit = dm("U1", "changed", "9.3");
  edit.payload.event.subtype = "message_changed";
  socket.push(edit);
  await flush();
  assert.equal(requests.filter((r) => r.method === "bridge.send").length, 1);
});

test("the coordinator follows a Slack request through a hand-off to the bot's summary", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-bridge-"));
  const who = {};
  let release;
  const gate = new Promise((r) => (release = r));
  const ids = {};
  const c = new Coordinator({
    directory,
    concurrency: 2,
    probe: async () => [],
    runner: async ({ workspace, prompt, signal }) => {
      if (who[workspace] === "Nova") {
        await Promise.race([gate, new Promise((resolve) => signal.addEventListener("abort", resolve))]);
        return "Competitors charge $12 to $20.";
      }
      const handOff = (target) =>
        `On it, handing this over.\n\`\`\`anybot\n${JSON.stringify({ type: "delegate", employeeId: target, objective: "Research competitor prices" })}\n\`\`\``;
      // Ghost isn't Chief's report, so that hand-off is refused.
      if (prompt.includes("ask the ghost")) return handOff(ids.ghost);
      if (prompt.includes("Delegated work returned")) return "Charge $15: the middle of the market.";
      return handOff(ids.nova);
    },
  });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  for (const name of ["Chief", "Nova", "Ghost"]) await c.command("employees.create", { name, role: name, harness: "claude", trusted: true });
  const e = Object.fromEntries(c.snapshot().employees.map((x) => [x.name, x]));
  for (const x of Object.values(e)) who[x.workspace] = x.name;
  ids.nova = e.Nova.id;
  ids.ghost = e.Ghost.id;
  await c.command("employees.setManager", { id: e.Nova.id, manager: e.Chief.id });
  const { message } = await c.command("bridge.send", { employee: e.Chief.id, body: "[Slack DM] price the course", requestId: "slack:T1:D1:10" });
  const update = async () => (await c.command("bridge.updates", { messages: [message] })).items[0];
  const until2 = async (check, what) => {
    for (let i = 0; i < 500; i++) {
      const item = await update();
      if (check(item)) return item;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  // Chief handed off and Nova is working: still running, with the hand-off named.
  const working = await until2((item) => item.handoffs?.length === 1, "the hand-off");
  assert.equal(working.status, "running");
  assert.equal(working.reply, undefined);
  assert.deepEqual(working.handoffs.map((h) => h.to), ["Nova"]);
  release();
  const done = await until2((item) => item.status !== "running" && item.status !== "queued", "the summary");
  assert.equal(done.status, "succeeded");
  assert.equal(done.reply, "Charge $15: the middle of the market.");

  // A hand-off that isn't scheduled leaves the first reply, without its machine block.
  const second = await c.command("bridge.send", { employee: e.Chief.id, body: "[Slack DM] ask the ghost", requestId: "slack:T1:D1:11" });
  let item;
  for (let i = 0; i < 500; i++) {
    item = (await c.command("bridge.updates", { messages: [second.message] })).items[0];
    if (!["running", "queued"].includes(item.status)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(item.status, "succeeded");
  assert.equal(item.reply, "On it, handing this over.");
});

test("in a chain of hand-offs, a bot summing up what came back isn't announced as another hand-off", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-bridge-"));
  const who = {};
  const ids = {};
  let release;
  const gate = new Promise((r) => (release = r));
  const handOff = (target, objective) =>
    `Handing this over.\n\`\`\`anybot\n${JSON.stringify({ type: "delegate", employeeId: target, objective })}\n\`\`\``;
  const c = new Coordinator({
    directory,
    concurrency: 2,
    probe: async () => [],
    runner: async ({ workspace, prompt, signal }) => {
      const name = who[workspace];
      const returned = prompt.includes("Delegated work returned");
      if (name === "Rex") return "Competitors charge $12 to $20.";
      if (name === "Nova" && returned) {
        await Promise.race([gate, new Promise((resolve) => signal.addEventListener("abort", resolve))]);
        return "Research done: $12 to $20.";
      }
      if (name === "Nova") return handOff(ids.rex, "Collect competitor prices");
      if (returned) return "Charge $15.";
      return handOff(ids.nova, "Research competitor prices");
    },
  });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  for (const name of ["Chief", "Nova", "Rex"]) await c.command("employees.create", { name, role: name, harness: "claude", trusted: true });
  const e = Object.fromEntries(c.snapshot().employees.map((x) => [x.name, x]));
  for (const x of Object.values(e)) who[x.workspace] = x.name;
  ids.nova = e.Nova.id;
  ids.rex = e.Rex.id;
  await c.command("employees.setManager", { id: e.Nova.id, manager: e.Chief.id });
  await c.command("employees.setManager", { id: e.Rex.id, manager: e.Nova.id });
  const { message } = await c.command("bridge.send", { employee: e.Chief.id, body: "[Slack DM] price the course", requestId: "slack:T1:D1:20" });
  const update = async () => (await c.command("bridge.updates", { messages: [message] })).items[0];
  const until2 = async (check, what) => {
    for (let i = 0; i < 500; i++) {
      const item = await update();
      if (check(item)) return item;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timed out waiting for ${what}`);
  };
  // Rex has answered and Nova is summing up: two hand-offs, not three.
  await until2(() => c.snapshot().runs.some((r) => r.employee === e.Nova.id && r.status === "running" && r.parent && c.snapshot().runs.some((x) => x.employee === e.Rex.id && x.status === "succeeded")), "Nova's summary run");
  assert.deepEqual((await update()).handoffs.map((h) => h.to), ["Nova", "Rex"]);
  release();
  const done = await until2((item) => !["running", "queued"].includes(item.status), "the summary");
  assert.equal(done.reply, "Charge $15.");
  assert.deepEqual(done.handoffs.map((h) => h.to), ["Nova", "Rex"]);
});

test("a dropped connection reconnects; a revoked token stops retrying and says why", async (t) => {
  const fail = {};
  const { bridge, slack } = await bridgeFixture(t, { fail });
  await bridge.connect("e1", { botToken: BOT, appToken: APP });
  await until(() => slack.sockets.length === 1, "socket");
  slack.sockets[0].push({ type: "hello" });
  // Slack rotates the connection: a new one opens.
  slack.sockets[0].push({ type: "disconnect", reason: "refresh_requested" });
  await until(() => slack.sockets.length === 2, "the next connection");
  // Then the app token is revoked and the connection drops.
  const opens = () => slack.calls.filter((c) => c.method === "apps.connections.open").length;
  fail["apps.connections.open"] = "token_revoked";
  const before = opens();
  slack.sockets[1].close();
  await until(() => bridge.status("e1").state === "error", "the error");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(opens(), before + 1, "no retry loop on a revoked token");
  assert.match(bridge.status("e1").error, /revoked/);
  bridge.disconnect("e1");
  assert.deepEqual(bridge.status("e1"), { connected: false });
  assert.deepEqual(bridge.overview(), {});
});

test("the coordinator routes outside messages to a bot's direct chat and reports how they end", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "anybot-bridge-"));
  let release;
  const gate = new Promise((r) => (release = r));
  const c = new Coordinator({
    directory,
    concurrency: 1,
    probe: async () => [],
    runner: async (options) => {
      await gate;
      if (options.prompt.includes("break it")) throw new Error("Harness exited 1\ndetails");
      return "Here is the **update**.";
    },
  });
  t.after(async () => {
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  await c.command("employees.create", { name: "Chief", role: "Chief of staff", harness: "claude", trusted: true });
  const chief = c.snapshot().employees[0];
  const first = await c.command("bridge.send", { employee: chief.id, body: "[Slack DM] weekly update", requestId: "slack:T1:D1:1" });
  const again = await c.command("bridge.send", { employee: chief.id, body: "[Slack DM] weekly update", requestId: "slack:T1:D1:1" });
  assert.deepEqual(again, first, "a repeated request is the same message");
  const second = await c.command("bridge.send", { employee: chief.id, body: "[Slack DM] break it", requestId: "slack:T1:D1:2" });
  assert.equal(second.conversation, first.conversation, "one direct chat per bot");
  const chat = c.snapshot().conversations.find((x) => x.id === first.conversation);
  assert.deepEqual(chat.members, [chief.id]);
  const running = await c.command("bridge.updates", { messages: [first.message, second.message, "nope"] });
  assert.deepEqual(running.items.map((i) => i.status).slice(0, 2).every((s) => ["queued", "running"].includes(s)), true);
  assert.equal(running.items[2].status, "unknown");
  release();
  const settle = async () => {
    for (let i = 0; i < 500; i++) {
      const { items } = await c.command("bridge.updates", { messages: [first.message, second.message] });
      if (items.every((x) => ["succeeded", "failed"].includes(x.status))) return items;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("runs never settled");
  };
  const [done, failed] = await settle();
  assert.equal(done.status, "succeeded");
  assert.equal(done.reply, "Here is the **update**.");
  assert.deepEqual(done.approvals, []);
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /Harness exited 1/);
  const current = c.snapshot().employees.find((e) => e.id === chief.id);
  await c.command("employees.setArchived", { id: chief.id, archived: true, revision: current.revision });
  await assert.rejects(c.command("bridge.send", { employee: chief.id, body: "hi", requestId: "slack:T1:D1:3" }));
});
