// Desktop voice (V1): speech-to-text in main (desktop/voice.cjs), one message
// per spoken turn (src/lib/voice.js Segmenter), following the real run to its
// end (messages.follow), speaking the reply without markdown
// (runtime/speakable.mjs), and a half-duplex mic (src/lib/voice-session.js).
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Coordinator } from "../runtime/coordinator.mjs";
import { speakable, SPEAK_LIMIT, REST_OF_IT } from "../runtime/speakable.mjs";
import { findHq } from "../runtime/hq.mjs";
import { encodeWav, resample, Segmenter, followReducer, initialFollow, workingLabel } from "../src/lib/voice.js";
import { VoiceSession } from "../src/lib/voice-session.js";
import { describeIssue } from "../src/lib/diagnostics.js";

const require = createRequire(import.meta.url);
const { createVoice, parseWav } = require("../desktop/voice.cjs");
const { permissionAllowed } = require("../desktop/window-shell.cjs");

const RATE = 16000;
const tone = (seconds, amplitude = 0.3) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE));
const quiet = (seconds) => new Float32Array(Math.round(seconds * RATE));
const join = (...parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
// Feeds the audio in small blocks, the way the worklet delivers it.
function feed(segmenter, samples, block = 320) {
  const turns = [];
  for (let i = 0; i < samples.length; i += block) turns.push(...segmenter.push(samples.subarray(i, i + block)));
  return turns;
}

// ---------------------------------------------------------------- speakable

test("speakable drops machine blocks, code, links, URLs and paths, and reads markdown as plain sentences", () => {
  const reply = [
    "# Launch plan",
    "",
    "**Done.** I wrote the plan to `C:\\Users\\Tony\\Projects\\launch\\plan.md` and ~/notes/launch/today.md.",
    "",
    "- First, *record* the intro",
    "- Then publish it on [the channel page](https://example.com/channel)",
    "",
    "See https://example.com/docs?x=1 for the details, and \\\\server\\share\\clips\\a.mp4 for the clip.",
    "",
    "```js",
    "console.log('never read this');",
    "```",
    "",
    "```anybot-actions",
    '{"actions":[{"type":"task.move"}]}',
    "```",
    "```anybot",
    '{"type":"delegate"}',
    "```",
    "```anybot-artifacts",
    '[{"path":"out.html"}]',
    "```",
    "| Day | Task |",
    "| --- | --- |",
    "| Mon | Record |",
    "",
    "> Quoted **bold** line",
    "That's all.",
  ].join("\n");
  const { sentences, text, clipped } = speakable(reply);
  assert.equal(clipped, false);
  for (const gone of ["```", "anybot", "actions", "delegate", "out.html", "console.log", "https", "example.com", "C:\\", "Users", "~/notes", "server", "share", "**", "#", "|", "Mon", "`"])
    assert.ok(!text.includes(gone), `"${gone}" should not be spoken: ${text}`);
  assert.deepEqual(sentences.slice(0, 2), ["Launch plan.", "Done."]);
  assert.ok(sentences.includes("First, record the intro."), text);
  assert.ok(sentences.includes("Then publish it on the channel page."), text);
  assert.ok(sentences.includes("I wrote the plan to plan.md and today.md."), "a path is read as its file name");
  assert.ok(sentences.includes("See the link for the details, and a.mp4 for the clip."), text);
  assert.ok(sentences.includes("Quoted bold line."), text);
  assert.equal(sentences.at(-1), "That's all.");
});

test("speakable clips a long reply at a sentence end and says the rest is in the chat", () => {
  const sentence = (n) => `This is sentence number ${n} of a long answer that keeps going for a while.`;
  const long = Array.from({ length: 30 }, (_, i) => sentence(i + 1)).join(" ");
  const { sentences, text, clipped } = speakable(long);
  assert.equal(clipped, true);
  assert.equal(sentences.at(-1), REST_OF_IT);
  const spoken = sentences.slice(0, -1);
  assert.ok(spoken.join(" ").length <= SPEAK_LIMIT, `at most ${SPEAK_LIMIT} characters before the note`);
  assert.ok(spoken.every((s) => /^This is sentence number \d+ of a long answer that keeps going for a while\.$/.test(s)), "cut on a sentence end");
  assert.ok(spoken.length >= 5);
  assert.ok(text.endsWith(REST_OF_IT));
  // One sentence longer than the limit is cut on a word, never mid-word.
  const run = speakable(`${"word ".repeat(200)}end.`);
  assert.equal(run.sentences.at(-1), REST_OF_IT);
  assert.ok(run.sentences[0].length <= SPEAK_LIMIT && /word…$/.test(run.sentences[0]), run.sentences[0]);
  // A reply that is only code says where it is instead of nothing.
  assert.deepEqual(speakable("```\nnpm test\n```").sentences, ["The details are in the chat."]);
  assert.deepEqual(speakable("").sentences, []);
});

// ----------------------------------------------------------------- Segmenter

test("the Segmenter makes one turn of speech with a pause inside it, and cuts at 60 seconds", () => {
  const segmenter = new Segmenter();
  const turns = feed(segmenter, join(tone(1), quiet(0.8), tone(1), quiet(1.5)));
  assert.equal(turns.length, 1, "a 0.8 s pause stays inside the turn");
  const seconds = turns[0].length / RATE;
  assert.ok(seconds >= 2.8 && seconds <= 3.5, `the turn is the whole utterance (${seconds}s)`);
  assert.equal(segmenter.flush(), null, "nothing left over");

  // Pauses longer than the 1.3 s hangover make separate turns.
  const two = feed(new Segmenter(), join(tone(1), quiet(1.5), tone(1), quiet(1.5)));
  assert.equal(two.length, 2);

  // 70 s of speech: the first turn is cut at exactly 60 s.
  const long = new Segmenter();
  const cut = feed(long, tone(70));
  assert.equal(cut.length, 1);
  assert.equal(cut[0].length, 60 * RATE);
  const rest = long.flush();
  assert.ok(rest && Math.abs(rest.length / RATE - 10) < 0.5, "the last 10 s are the next turn");

  // A click shorter than 300 ms of speech isn't a turn.
  assert.deepEqual(feed(new Segmenter(), join(quiet(0.5), tone(0.1), quiet(2))), []);
  // Block size doesn't matter.
  assert.equal(feed(new Segmenter(), join(tone(1), quiet(0.8), tone(1), quiet(1.5)), 128).length, 1);
  assert.equal(feed(new Segmenter(), join(tone(1), quiet(0.8), tone(1), quiet(1.5)), RATE).length, 1);
});

test("encodeWav writes a 16 kHz mono 16-bit RIFF file", () => {
  const wav = encodeWav(Float32Array.from([0, 0.5, -1, 2]));
  assert.ok(wav instanceof Uint8Array);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (at, n) => String.fromCharCode(...wav.subarray(at, at + n));
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(view.getUint32(4, true), wav.length - 8);
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(ascii(12, 4), "fmt ");
  assert.equal(view.getUint16(20, true), 1, "PCM");
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000, "byte rate");
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(ascii(36, 4), "data");
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true)), [0, 16384, -32768, 32767]);
  assert.equal(wav.length, 52);
  // main reads it back the same way.
  assert.deepEqual(parseWav(wav), { sampleRate: 16000, channels: 1, bits: 16, seconds: 4 / 16000, dataBytes: 8 });
  // A 48 kHz capture comes down to 16 kHz.
  assert.equal(resample(new Float32Array(4800), 48000, 16000).length, 1600);
});

// ------------------------------------------------------------ follow reducer

test("the follow reducer speaks a hand-off once, an approval once, then the reply once", () => {
  const running = { requestId: "r1", message: "m1", status: "running", handoffs: [{ id: "run2", to: "Nova" }], approvals: [] };
  const asking = { ...running, approvals: [{ id: "a1", tool: "Bash", summary: "Run `npm test` in C:\\work\\site" }] };
  const done = { ...running, status: "succeeded", approvals: [], reply: "**All set.** The page is live." };
  let state = initialFollow();
  const said = [];
  for (const items of [[running], [running], [asking], [asking], [asking], [done], [done]]) {
    const next = followReducer(state, items);
    state = next.state;
    said.push(...next.events.map((e) => [e.kind, e.text]));
    if (next.done) assert.equal(items[0].status, "succeeded");
  }
  assert.deepEqual(said.map(([kind]) => kind), ["handoff", "approval", "reply"]);
  assert.equal(said[0][1], "Handed to Nova.");
  assert.match(said[1][1], /^Waiting for your approval in the app/);
  assert.ok(!said[1][1].includes("C:\\"), "no paths spoken");
  assert.equal(said[2][1], "**All set.** The page is live.", "the reply goes to speakable as written");
  assert.equal(state.done, true);

  // A run that fails or is stopped says so once.
  const failed = followReducer(initialFollow(), [{ requestId: "r2", status: "failed", error: "Harness exited 1\nstack…", handoffs: [], approvals: [] }]);
  assert.deepEqual(failed.events.map((e) => e.kind), ["error"]);
  assert.match(failed.events[0].text, /^That didn't finish: Harness exited 1\.?$/);
  assert.equal(failed.done, true);
  const stopped = followReducer(initialFollow(), [{ requestId: "r3", status: "cancelled", handoffs: [], approvals: [] }]);
  assert.equal(stopped.events[0].text, "That was stopped.");
  // Unknown or still queued: keep waiting, say nothing.
  const waiting = followReducer(initialFollow(), [{ requestId: "r4", status: "queued", handoffs: [], approvals: [] }]);
  assert.deepEqual([waiting.events, waiting.done], [[], false]);
  assert.equal(workingLabel("Atlas", 1000, 1000 + 125_000), "Atlas is working · 2m");
  assert.equal(workingLabel("Atlas", 1000, 1000 + 20_000), "Atlas is working · 20s");
});

// ----------------------------------------------------------- messages.follow

test("messages.follow waits for the real run, however long it takes, and returns its reply", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "anybot-voice-"));
  let release;
  const gate = new Promise((r) => (release = r));
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-30T09:00:00.000Z") });
  const c = new Coordinator({
    directory,
    probe: async () => [],
    runner: async () => {
      await gate;
      return "The launch plan is **ready**.";
    },
  });
  t.after(async () => {
    mock.timers.reset();
    if (!c.closed) await c.close();
    await rm(directory, { recursive: true, force: true });
  });
  await c.initialize();
  await c.command("employees.create", { name: "Atlas", role: "Chief of staff", harness: "claude", trusted: true });
  const atlas = c.snapshot().employees[0];
  await c.command("conversations.create", { title: "Atlas", members: [atlas.id] });
  const chat = c.snapshot().conversations[0];
  await c.command("messages.send", { conversation: chat.id, body: "Plan the launch", recipients: [atlas.id], requestId: "voice-1" });
  const follow = async () => (await c.command("messages.follow", { requestIds: ["voice-1", "never-sent"] })).items;
  const first = await follow();
  assert.equal(first[0].requestId, "voice-1");
  assert.ok(["queued", "running"].includes(first[0].status));
  assert.equal(first[0].message, c.snapshot().messages[0].id);
  assert.equal(first[1].status, "unknown");
  // Five minutes later the run is still going, and follow still says so.
  mock.timers.tick(5 * 60_000);
  assert.equal((await follow())[0].status, "running");
  release();
  let item;
  for (let i = 0; i < 500; i++) {
    [item] = await follow();
    if (item.status === "succeeded") break;
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(item.status, "succeeded");
  assert.equal(item.reply, "The launch plan is **ready**.");
  assert.equal(typeof item.started, "string");
  // Not a snapshot: main hands it back as is.
  assert.equal((await c.command("messages.follow", { requestIds: [] })).runtime, undefined);
  await assert.rejects(c.command("voice.transcribe", {}), /Unknown application operation/);
});

// -------------------------------------------------------------- VoiceSession

// A scripted microphone: each hear() gives the next text; records when the
// mic was open so the test can check it never was while the bot talked.
function fakes({ heard = [], follows = [] } = {}) {
  const log = [];
  let speaking = 0;
  let pendingSpeech = [];
  const d = {
    log,
    sent: [],
    spoken: [],
    states: [],
    errors: [],
    threads: [],
    listeners: new Set(),
    hear() {
      log.push(`hear${speaking ? " WHILE SPEAKING" : ""}`);
      const text = heard.shift();
      let stop;
      const result = new Promise((resolve) => {
        stop = () => resolve(null);
        if (text !== undefined) setImmediate(() => resolve(text));
      });
      return { result, stop, finish: () => {}, press: () => {}, release: () => {} };
    },
    async send(payload) {
      log.push(`send ${payload.body}`);
      d.sent.push(payload);
      return true;
    },
    async follow() {
      const next = follows.length > 1 ? follows.shift() : follows[0];
      return typeof next === "function" ? next(d) : next;
    },
    subscribe(listener) {
      d.listeners.add(listener);
      return () => d.listeners.delete(listener);
    },
    speak(sentences) {
      speaking += 1;
      log.push(`speak ${sentences.join(" ")}`);
      d.spoken.push(sentences);
      return new Promise((resolve) => {
        pendingSpeech.push(() => {
          speaking -= 1;
          resolve();
        });
      });
    },
    finishSpeech() {
      const all = pendingSpeech;
      pendingSpeech = [];
      for (const done of all) done();
    },
    cancelSpeech() {
      log.push("cancel speech");
      d.finishSpeech();
    },
    onState: (s) => d.states.push(s),
    onError: (e) => d.errors.push(String(e.message || e)),
    onThread: (id) => d.threads.push(id),
  };
  return d;
}
const tick = () => new Promise((r) => setImmediate(r));
async function until(check, what) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await tick();
  }
  throw new Error(`timed out: ${what}`);
}

test("a voice chat sends one message per turn, keeps the mic shut while the bot works and talks, and reopens it after", async () => {
  const running = { requestId: "x", message: "m1", status: "running", handoffs: [], approvals: [] };
  const d = fakes({
    heard: ["Plan the launch", "Thanks"],
    follows: [[running], [{ ...running, handoffs: [{ id: "r2", to: "Nova" }] }], [{ ...running, status: "succeeded", reply: "## Plan\nIt's **ready**." }]],
  });
  const session = new VoiceSession({ ...d, pollMs: 60_000 }, { mode: "chat", conversation: "c1", employee: { id: "e1", name: "Atlas" } });
  session.start();
  await until(() => d.sent.length === 1, "the first turn is sent");
  assert.deepEqual(
    { ...d.sent[0], requestId: typeof d.sent[0].requestId },
    { conversation: "c1", body: "Plan the launch", recipients: ["e1"], thread: null, requestId: "string" },
  );
  // While the bot works the mic is shut: only change pushes move things on.
  await until(() => session.state.phase === "working", "working");
  assert.equal(session.state.bot, "Atlas");
  for (const listener of d.listeners) listener();
  await until(() => d.spoken.length === 1, "the hand-off is spoken");
  assert.deepEqual(d.spoken[0], ["Handed to Nova."]);
  d.finishSpeech();
  for (const listener of d.listeners) listener();
  await until(() => d.spoken.length === 2, "the reply is spoken");
  assert.deepEqual(d.spoken[1], ["Plan.", "It's ready."]);
  assert.equal(session.state.phase, "speaking");
  await tick();
  assert.equal(d.log.filter((l) => l.startsWith("hear")).length, 1, "the mic stays shut until the reply has been spoken");
  d.finishSpeech();
  await until(() => d.log.filter((l) => l.startsWith("hear")).length === 2, "the mic reopens after the last sentence");
  assert.ok(!d.log.some((l) => l.includes("WHILE SPEAKING")));
  await until(() => d.sent.length === 2, "the next turn");
  assert.equal(d.sent[1].body, "Thanks");
  session.stop();
  assert.equal(session.state.phase, "off");
  assert.equal(d.listeners.size, 0);
  assert.deepEqual(d.errors, []);
});

test("silence isn't sent, a project voice chat stays in one thread, and dictation fills the draft once", async () => {
  const done = (message) => [{ requestId: "x", message, status: "succeeded", reply: "OK.", handoffs: [], approvals: [] }];
  const d = fakes({ heard: [null, "  ", "Hello there", "And again"], follows: [done("root1")] });
  const session = new VoiceSession(d, { mode: "chat", conversation: "hq", employee: { id: "e1", name: "Atlas" }, project: true });
  session.start();
  await until(() => d.spoken.length === 1, "the first reply");
  assert.equal(d.sent.length, 1, "nothing heard, nothing sent");
  assert.equal(d.sent[0].thread, null);
  assert.deepEqual(d.threads, ["root1"]);
  d.finishSpeech();
  await until(() => d.sent.length === 2, "the second turn");
  assert.equal(d.sent[1].thread, "root1", "later turns reply in the first turn's thread");
  session.stop();

  const typed = [];
  const dictation = fakes({ heard: ["Draft this sentence"] });
  const dictate = new VoiceSession(dictation, { mode: "dictate", onText: (text) => typed.push(text) });
  dictate.start();
  await until(() => dictate.state.phase === "off", "dictation ends after one turn");
  assert.deepEqual(typed, ["Draft this sentence"]);
  assert.deepEqual(dictation.sent, []);
});

// ------------------------------------------------------------ desktop/voice

const bytes = (text, size) => Buffer.alloc(size, text);
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
function testAssets() {
  const program = bytes("zip", 3000);
  const model = bytes("model", 5000);
  return {
    program,
    model,
    assets: {
      whisper: { version: "v-test", url: "https://example.test/whisper.zip", size: program.length, sha256: sha(program) },
      models: { "base.en": { file: "ggml-base.en.bin", url: "https://example.test/base.bin", size: model.length, sha256: sha(model), label: "Base (English)" } },
    },
  };
}
async function voiceFixture(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "anybot-voice-main-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const diagnostics = [];
  const calls = [];
  const voice = createVoice({
    dir,
    platform: "win32",
    protect: (text) => `os:${Buffer.from(text).toString("base64")}`,
    unprotect: (text) => Buffer.from(text.slice(3), "base64").toString(),
    onDiagnostic: (entry) => diagnostics.push(entry),
    fetch: async (url, init) => {
      calls.push({ url, init });
      return options.fetch ? options.fetch(url, init) : new Response("{}", { status: 500 });
    },
    ...options.voice,
  });
  return { dir, voice, diagnostics, calls };
}
const speechWav = (seconds = 1) => encodeWav(tone(seconds));

test("with nothing set up, voice says so and logs voice.provider_missing without any speech", async (t) => {
  const { voice, diagnostics } = await voiceFixture(t);
  const status = voice.status();
  assert.equal(status.provider, "");
  assert.equal(status.ready, false);
  const start = voice.start();
  assert.equal(start.ready, false);
  assert.match(start.reason, /Settings → Voice/);
  voice.start();
  await assert.rejects(voice.transcribe({ wav: speechWav() }), /Settings → Voice/);
  const missing = diagnostics.filter((d) => d.code === "voice.provider_missing");
  assert.equal(missing.length, 1, "logged once, not per press");
  assert.notEqual(describeIssue(missing[0]).title, "voice.provider_missing");
  assert.notEqual(describeIssue({ code: "voice.stt_failed", context: {} }).title, "voice.stt_failed");
  assert.notEqual(describeIssue({ code: "voice.download_failed", context: {} }).title, "voice.download_failed");
});

test("an API key is stored protected in voice.json, never handed back, and used from main", async (t) => {
  const { dir, voice, diagnostics, calls } = await voiceFixture(t, {
    fetch: async (url, init) => {
      if (init.headers.Authorization === "Bearer sk-wrong-key-000") return new Response('{"error":{"message":"Incorrect API key sk-wrong-key-000"}}', { status: 401 });
      return new Response(JSON.stringify({ text: " Plan the launch. " }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await assert.rejects(Promise.resolve().then(() => voice.setKey({ provider: "openai", key: "has spaces in it" })), /key/);
  voice.setKey({ provider: "openai", key: "  sk-test-key-123  " });
  const saved = readFileSync(path.join(dir, "voice.json"), "utf8");
  assert.ok(!saved.includes("sk-test-key-123"), "the key is not stored in the clear");
  assert.match(saved, /"openai":"os:/);
  const status = voice.setProvider("openai");
  assert.equal(status.ready, true);
  assert.equal(status.provider, "openai");
  assert.equal(status.keys.openai, true);
  assert.ok(!JSON.stringify(status).includes("sk-test-key-123"), "status never carries the key");

  assert.deepEqual(await voice.transcribe({ wav: speechWav() }), { text: "Plan the launch." });
  const call = calls.at(-1);
  assert.equal(call.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.Authorization, "Bearer sk-test-key-123");
  assert.equal(call.init.body.get("model"), "gpt-4o-mini-transcribe");
  assert.equal(call.init.body.get("response_format"), "json");
  const file = call.init.body.get("file");
  assert.equal(file.type, "audio/wav");
  assert.equal(file.size, speechWav().length);

  // Groq is the same shape at its own endpoint.
  voice.setKey({ provider: "groq", key: "gsk_test_456" });
  voice.setProvider("groq");
  await voice.transcribe({ wav: speechWav() });
  assert.equal(calls.at(-1).url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.equal(calls.at(-1).init.body.get("model"), "whisper-large-v3-turbo");

  // A refused key: a plain error, and a diagnostic without the key or any text.
  voice.setKey({ provider: "groq", key: "sk-wrong-key-000" });
  await assert.rejects(voice.transcribe({ wav: speechWav() }), /Groq didn't accept the API key/);
  const failed = diagnostics.find((d) => d.code === "voice.stt_failed");
  assert.deepEqual(failed.context, { provider: "groq", status: 401 });
  assert.ok(!JSON.stringify(failed).includes("sk-wrong"));
  // Removing the key leaves no provider ready.
  assert.equal(voice.setKey({ provider: "groq", key: "" }).ready, false);
});

test("voice.transcribe takes only a short 16 kHz mono WAV", async (t) => {
  const { voice } = await voiceFixture(t, { voice: { fakeStt: "Hello" } });
  assert.deepEqual(await voice.transcribe({ wav: speechWav() }), { text: "Hello" });
  await assert.rejects(voice.transcribe({ wav: "not audio" }), /recording/);
  await assert.rejects(voice.transcribe({ wav: new Uint8Array(100) }), /recording/);
  await assert.rejects(voice.transcribe({ wav: encodeWav(tone(61)) }), /60 seconds/);
  await assert.rejects(voice.transcribe({ wav: new Uint8Array(2 * 1024 * 1024 + 1) }), /too long|recording/);
  const wrongRate = encodeWav(tone(1));
  new DataView(wrongRate.buffer).setUint32(24, 44100, true);
  await assert.rejects(voice.transcribe({ wav: wrongRate }), /recording/);
});

test("local whisper downloads only when asked, checks every byte, and runs whisper-cli on a temp file", async (t) => {
  const { program, model, assets } = testAssets();
  const served = new Map([
    [assets.whisper.url, program],
    [assets.models["base.en"].url, model],
  ]);
  const runs = [];
  const { dir, voice, diagnostics, calls } = await voiceFixture(t, {
    fetch: async (url) => new Response(served.get(url)),
    voice: {
      assets,
      extract: async (zip, dest) => {
        assert.equal(readFileSync(zip).length, program.length);
        await mkdir(path.join(dest, "Release"), { recursive: true });
        await writeFile(path.join(dest, "Release", "whisper-cli.exe"), "exe");
        await writeFile(path.join(dest, "Release", "whisper.dll"), "dll");
      },
      run: async (file, args, options) => {
        runs.push({ file, args, options });
        const out = args[args.indexOf("-of") + 1];
        const wav = args[args.indexOf("-f") + 1];
        assert.ok(existsSync(wav), "the recording is on disk while whisper runs");
        await writeFile(`${out}.txt`, "Plan the launch\n[BLANK_AUDIO]\nfor Friday.\n");
        return { stdout: "", stderr: "" };
      },
    },
  });
  assert.equal(calls.length, 0, "nothing downloads on its own");
  assert.equal(voice.status().local.installed, false);
  // It starts and answers at once; the progress shows in status().
  assert.equal(voice.download({ model: "base.en" }).local.download.state, "downloading");
  await voice.downloaded();
  const status = voice.status();
  assert.equal(status.local.download.state, "idle");
  assert.equal(status.local.installed, true);
  assert.equal(status.local.models["base.en"].installed, true);
  assert.equal(status.provider, "whisper-local", "the owner's download makes it the provider");
  assert.equal(status.ready, true);
  assert.deepEqual(calls.map((c) => c.url), [assets.whisper.url, assets.models["base.en"].url]);

  assert.deepEqual(await voice.transcribe({ wav: speechWav() }), { text: "Plan the launch for Friday." });
  const [run] = runs;
  assert.equal(path.basename(run.file), "whisper-cli.exe");
  const flag = (name) => run.args[run.args.indexOf(name) + 1];
  assert.equal(path.basename(flag("-m")), "ggml-base.en.bin");
  for (const name of ["-otxt", "-nt", "-np"]) assert.ok(run.args.includes(name), name);
  assert.equal(flag("-l"), "en");
  assert.equal(run.options.timeout, 60_000);
  assert.equal(run.options.windowsHide, true);
  assert.deepEqual(await readdir(path.join(dir, "voice", "tmp")), [], "the recording and transcript are deleted");
  assert.deepEqual(diagnostics, []);

  // whisper-cli failing: a plain error and a diagnostic with no paths or text.
  const failing = await voiceFixture(t, {
    fetch: async (url) => new Response(served.get(url)),
    voice: {
      assets,
      extract: async (zip, dest) => {
        await mkdir(path.join(dest, "Release"), { recursive: true });
        await writeFile(path.join(dest, "Release", "whisper-cli.exe"), "exe");
      },
      run: async () => {
        throw Object.assign(new Error(`Command failed: ${dir}\\whisper-cli.exe -m secret`), { code: 3 });
      },
    },
  });
  failing.voice.download({ model: "base.en" });
  await failing.voice.downloaded();
  await assert.rejects(failing.voice.transcribe({ wav: speechWav() }), /Local speech-to-text failed/);
  const entry = failing.diagnostics.find((d) => d.code === "voice.stt_failed");
  assert.deepEqual(entry.context, { provider: "whisper-local", exit: 3 });
  assert.ok(!JSON.stringify(entry).includes(dir));
});

test("a download that doesn't match its pinned SHA-256 is thrown away", async (t) => {
  const { program, assets } = testAssets();
  const { dir, voice, diagnostics } = await voiceFixture(t, {
    fetch: async (url) => new Response(url === assets.whisper.url ? Buffer.concat([program.subarray(1), Buffer.from("x")]) : Buffer.alloc(0)),
    voice: { assets, extract: async () => assert.fail("never unpack a file that failed its check") },
  });
  voice.download({ model: "base.en" });
  await voice.downloaded();
  const status = voice.status();
  assert.equal(status.local.download.state, "failed");
  assert.match(status.local.download.error, /didn't match/);
  assert.equal(status.local.installed, false);
  assert.equal(status.ready, false);
  const leftovers = (await readdir(path.join(dir, "voice"), { recursive: true })).filter((f) => /\.(zip|bin|part)$/.test(f));
  assert.deepEqual(leftovers, []);
  const entry = diagnostics.find((d) => d.code === "voice.download_failed");
  assert.deepEqual(entry.context, { item: "program", reason: "hash" });
});

// ------------------------------------------------------ permissions and HQ

test("the microphone is allowed for the app's own page only, never the camera or a frame inside it", () => {
  const page = "file:///C:/Program%20Files/Any%20Bot/resources/app.asar/dist/index.html";
  const allow = (permission, details) => permissionAllowed(permission, details, page);
  assert.equal(allow("media", { requestingUrl: page, isMainFrame: true, mediaTypes: ["audio"] }), true);
  assert.equal(allow("media", { requestingUrl: page, isMainFrame: true, mediaType: "audio" }), true, "the check before the request");
  assert.equal(allow("media", { requestingUrl: page, isMainFrame: true }), true, "a check with no type yet");
  assert.equal(allow("media", { requestingUrl: page, isMainFrame: true, mediaTypes: ["audio", "video"] }), false);
  assert.equal(allow("media", { requestingUrl: page, isMainFrame: true, mediaType: "video" }), false);
  assert.equal(allow("media", { requestingUrl: "about:srcdoc", isMainFrame: false, mediaTypes: ["audio"] }), false, "bot HTML in a preview");
  assert.equal(allow("media", { requestingUrl: "https://example.com/", isMainFrame: false, mediaTypes: ["audio"] }), false, "a site in the rail browser");
  assert.equal(allow("media", { requestingUrl: "file:///C:/other/index.html", isMainFrame: true, mediaTypes: ["audio"] }), false);
  assert.equal(allow("display-capture", { requestingUrl: page, isMainFrame: true }), false, "no screen capture");
  assert.equal(allow("notifications", { requestingUrl: page, isMainFrame: true }), true, "other permissions keep Electron's default");
});

test("HQ is the top-level bot with the most people under it, in its project with most of its reports", () => {
  const bots = [
    { id: "jim", manager: "", archived: 0 },
    { id: "atlas", manager: "", archived: 0 },
    { id: "nova", manager: "atlas", archived: 0 },
    { id: "reel", manager: "nova", archived: 0 },
    { id: "pax", manager: "atlas", archived: 0 },
    { id: "gone", manager: "jim", archived: 1 },
  ];
  const rooms = [
    { id: "dm", members: ["atlas"], archived: 0 },
    { id: "side", members: ["atlas", "reel"], archived: 0 },
    { id: "hq", members: ["atlas", "nova", "pax"], archived: 0 },
    { id: "old", members: ["atlas", "nova", "pax", "reel"], archived: 1 },
  ];
  assert.deepEqual(findHq(bots, rooms), { employee: "atlas", conversation: "hq" });
  assert.deepEqual(findHq(bots, rooms.slice(0, 1)), { employee: "atlas", conversation: null });
  assert.equal(findHq(bots.map((b) => ({ ...b, manager: "" })), rooms), null, "no org, no HQ");
});
