import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createVoiceService, handleVoice, VOICE_METHODS } = require("../desktop/voice.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "sk_test_0123456789abcdefghijklmnop";

// Reversible stand-in for Electron safeStorage; the prefix proves the stored
// value went through encryptString rather than being written in clear.
const safeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (value) => Buffer.from(`enc:${value}`),
  decryptString: (buffer) => {
    const value = buffer.toString();
    if (!value.startsWith("enc:")) throw new Error("bad ciphertext");
    return value.slice(4);
  },
});

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) return new Response("{}", { status: 404 });
    return route[1](url, init);
  };
  return { fetch, calls };
}
const voicesRoute = [
  /\/v1\/voices$/,
  () => Response.json({ voices: [{ voice_id: "voiceA1", name: "Aria", category: "premade" }, { voice_id: "bad id!", name: "x" }] }),
];

async function service(t, { routes = [voicesRoute], available = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "anybot-voice-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { fetch, calls } = fakeFetch(routes);
  return { dir, calls, voice: createVoiceService({ dir, safeStorage: safeStorage(available), fetch }) };
}

test("defaults to local system voice with no key configured", async (t) => {
  const { voice } = await service(t);
  const settings = voice.settings();
  assert.equal(settings.stt, "system");
  assert.equal(settings.tts, "system");
  assert.equal(settings.elevenlabs.configured, false);
});

test("the API key is encrypted at rest and never returned to the renderer", async (t) => {
  const { voice, dir, calls } = await service(t);
  const result = await voice.setKey({ key: KEY });
  assert.equal(result.settings.elevenlabs.configured, true);
  assert.equal(result.settings.tts, "elevenlabs");
  assert.equal(result.settings.voiceId, "voiceA1");
  assert.deepEqual(result.voices.map((v) => v.id), ["voiceA1"]);
  assert.equal(calls[0].init.headers["xi-api-key"], KEY);
  const disk = await readFile(path.join(dir, "voice.json"), "utf8");
  assert.ok(!disk.includes(KEY), "key stored in clear text");
  assert.ok(!JSON.stringify(voice.settings()).includes(KEY));
  assert.ok(!JSON.stringify(result).includes(KEY));
  // A fresh service (app restart) still has the key.
  const again = createVoiceService({ dir, safeStorage: safeStorage(), fetch: async () => new Response("{}") });
  assert.equal(again.settings().elevenlabs.configured, true);
  voice.clearKey();
  assert.equal(voice.settings().elevenlabs.configured, false);
  assert.equal(voice.settings().tts, "system");
});

test("a rejected key is not saved", async (t) => {
  const { voice } = await service(t, { routes: [[/\/v1\/voices$/, () => new Response("{}", { status: 401 })]] });
  await assert.rejects(voice.setKey({ key: KEY }), /rejected the API key/);
  assert.equal(voice.settings().elevenlabs.configured, false);
});

test("keys are refused when secure storage is unavailable", async (t) => {
  const { voice } = await service(t, { available: false });
  await assert.rejects(voice.setKey({ key: KEY }), /Secure storage is unavailable/);
});

test("cloud providers cannot be chosen without a key", async (t) => {
  const { voice } = await service(t);
  assert.throws(() => voice.save({ tts: "elevenlabs" }), /API key/);
  assert.throws(() => voice.save({ tts: "robot" }), /Unknown/);
  assert.throws(() => voice.save({ voiceId: "../../x" }), /Invalid voice/);
  assert.throws(() => voice.save({ employeeVoices: { "a/b": "voiceA1" } }), /Invalid bot voices/);
});

test("speak uses the employee's voice and returns mp3 bytes", async (t) => {
  const { voice, calls } = await service(t, {
    routes: [voicesRoute, [/text-to-speech/, () => new Response(new Uint8Array([1, 2, 3]))]],
  });
  await voice.setKey({ key: KEY });
  voice.save({ employeeVoices: { emp1: "voiceB2" } });
  const result = await voice.speak({ text: "Hello there", employeeId: "emp1" });
  assert.deepEqual([...result.audio], [1, 2, 3]);
  assert.equal(result.mime, "audio/mpeg");
  const call = calls.at(-1);
  assert.match(call.url, /\/v1\/text-to-speech\/voiceB2\?output_format=mp3_44100_128$/);
  assert.deepEqual(JSON.parse(call.init.body), { text: "Hello there", model_id: "eleven_flash_v2_5" });
  await voice.speak({ text: "Default", employeeId: "other" });
  assert.match(calls.at(-1).url, /text-to-speech\/voiceA1\?/);
});

test("transcribe posts audio to Scribe and validates input", async (t) => {
  const { voice, calls } = await service(t, {
    routes: [voicesRoute, [/speech-to-text$/, () => Response.json({ text: "  build the report  " })]],
  });
  await assert.rejects(voice.transcribe({ audio: new Uint8Array([1]) }), /API key/);
  await voice.setKey({ key: KEY });
  const result = await voice.transcribe({ audio: new Uint8Array([1, 2]), mime: "audio/webm;codecs=opus" });
  assert.equal(result.text, "build the report");
  const form = calls.at(-1).init.body;
  assert.equal(form.get("model_id"), "scribe_v1");
  assert.equal(form.get("file").type, "audio/webm");
  await assert.rejects(voice.transcribe({ audio: new Uint8Array([1]), mime: "text/html" }), /Unsupported/);
  await assert.rejects(voice.transcribe({ audio: "nope" }), /No audio/);
});

test("every preload voice method is handled in the main process", async () => {
  const preload = await readFile(path.join(root, "desktop/preload.cjs"), "utf8");
  const exposed = [...preload.matchAll(/"anybot:voice",\s*"([a-z]+\.[A-Za-z]+)"/g)].map((m) => m[1]);
  assert.ok(exposed.length >= 7, "expected voice methods in preload");
  for (const method of exposed) assert.ok(VOICE_METHODS.has(method), method);
  assert.throws(() => handleVoice({}, "voice.secret"), /not allowed/);
});
