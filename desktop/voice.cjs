// Speech-to-text for voice chat and dictation, in the main process
// (main.cjs voiceRequest; tests/voice.test.mjs). The renderer records a turn
// and sends it here as a 16 kHz mono WAV (src/lib/voice.js encodeWav); the
// text goes back. Nothing is kept: the recording and transcript are deleted,
// and diagnostics carry codes and numbers, never words or paths.
//
// Providers, chosen in Settings → Voice:
// - whisper-local: whisper.cpp on this computer (Windows). Downloaded only
//   when the owner asks, from pinned URLs whose SHA-256 is checked before
//   anything is unpacked or used, into <userData>/voice/.
// - openai, groq: the owner's API key, kept with safeStorage (protect) in
//   <userData>/voice.json. The request is made here, since the
//   window's CSP allows no outside connections.
// - webspeech: the window's own speech recognition, offered only once a
//   check in the window has worked; it never comes through here.
// `fakeStt` (ANYBOT_FAKE_STT, never in a packaged app) answers every turn
// with fixed text, for the Electron e2e.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { execFile } = require("node:child_process");

const MAX_WAV = 2 * 1024 * 1024;
const MAX_SECONDS = 60;
const RUN_TIMEOUT = 60_000;
const API_TIMEOUT = 60_000;
const MISSING_EVERY = 10 * 60_000;
// Room left on the disk after a download.
const SPARE_BYTES = 50 * 1024 * 1024;

// whisper.cpp v1.9.2, the newest release with Windows builds (2026-08-04).
// The SHA-256 is GitHub's own digest for the asset; checked on every download.
const WHISPER = {
  version: "v1.9.2",
  url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip",
  size: 8194445,
  sha256: "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a",
};
// English models from the whisper.cpp model repository, pinned to one commit;
// the SHA-256 is the file's LFS object id.
const MODEL_REPO = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1";
const MODELS = {
  "base.en": {
    file: "ggml-base.en.bin",
    url: `${MODEL_REPO}/ggml-base.en.bin`,
    size: 147964211,
    sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
    label: "Base (English)",
    note: "quick",
  },
  "small.en": {
    file: "ggml-small.en.bin",
    url: `${MODEL_REPO}/ggml-small.en.bin`,
    size: 487614201,
    sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
    label: "Small (English)",
    note: "more accurate, slower",
  },
};
// OpenAI-compatible transcription endpoints (multipart file + model; the
// json response has `text`).
const APIS = {
  openai: { label: "OpenAI", url: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-4o-mini-transcribe" },
  groq: { label: "Groq", url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
};
const PROVIDERS = ["whisper-local", "openai", "groq", "webspeech"];

// A WAV's format, or null when it isn't a PCM WAV.
function parseWav(input) {
  const bytes = asBytes(input);
  if (!bytes || bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let format = null;
  let dataBytes = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt " && size >= 16 && at + 24 <= bytes.length)
      format = { code: view.getUint16(at + 8, true), channels: view.getUint16(at + 10, true), sampleRate: view.getUint32(at + 12, true), bits: view.getUint16(at + 22, true) };
    if (id === "data") {
      dataBytes = Math.min(size, bytes.length - at - 8);
      break;
    }
    at += 8 + size + (size % 2);
  }
  if (!format || format.code !== 1 || dataBytes === null || !format.channels || !format.bits || !format.sampleRate) return null;
  const { sampleRate, channels, bits } = format;
  return { sampleRate, channels, bits, seconds: dataBytes / (sampleRate * channels * (bits / 8)), dataBytes };
}
function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return null;
}

// Whisper marks silence and sounds as [BLANK_AUDIO], [MUSIC], (wind blowing).
function cleanText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]*\]/g, "").trim())
    .filter((line) => line && !/^\([^)]*\)$/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function runFile(file, args, options) {
  return new Promise((resolve, reject) =>
    execFile(file, args, options, (error, stdout, stderr) => (error ? reject(error) : resolve({ stdout, stderr }))),
  );
}
// Windows 10 and later ship bsdtar, which unpacks zip files.
function extractZip(zip, dest) {
  const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  return runFile(tar, ["-xf", zip, "-C", dest], { timeout: 120_000, windowsHide: true });
}
const rm = (target) => {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // Left for the next download to replace.
  }
};
// Recordings and whisper's text only live in <userData>/voice/tmp while a
// turn is turned into text; one left by a quit, an update or a crash in the
// middle is deleted when Any Bot next starts (main.cjs) and when voice does.
function clearVoiceTemp(dir) {
  rm(path.join(dir, "voice", "tmp"));
}
const downloadError = (item, reason, message) => Object.assign(new Error(message), { item, reason, owner: message });

function createVoice({
  dir,
  platform = process.platform,
  protect = (text) => text,
  unprotect = (text) => text,
  fetch: fetchImpl = globalThis.fetch,
  run = runFile,
  extract = extractZip,
  onDiagnostic = () => {},
  fakeStt = null,
  assets = { whisper: WHISPER, models: MODELS },
  now = Date.now,
} = {}) {
  const root = path.join(dir, "voice");
  const file = path.join(dir, "voice.json");
  const programDir = path.join(root, "whisper-cpp");
  const marker = path.join(programDir, "anybot-version.txt");
  const cli = path.join(programDir, "whisper-cli.exe");
  const modelsDir = path.join(root, "models");
  const tmpDir = path.join(root, "tmp");
  const downloads = path.join(root, "downloads");
  const unpack = path.join(root, "whisper-unpack");
  const supported = platform === "win32";
  clearVoiceTemp(dir);
  let settings = load();
  let download = { state: "idle" };
  let job = Promise.resolve();
  let controller = null;
  let lastMissing = -Infinity;
  let busy = 0;

  function load() {
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(file, "utf8")) || {};
    } catch {
      // A new or unreadable file starts over.
    }
    const keys = {};
    for (const provider of Object.keys(APIS)) if (typeof saved.keys?.[provider] === "string" && saved.keys[provider]) keys[provider] = saved.keys[provider];
    return {
      provider: PROVIDERS.includes(saved.provider) ? saved.provider : "",
      keys,
      model: assets.models[saved.model] ? saved.model : Object.keys(assets.models)[0],
      voice: typeof saved.voice === "string" ? saved.voice.slice(0, 200) : "",
      pushToTalk: saved.pushToTalk === true,
      webspeech: saved.webspeech === true,
    };
  }
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(settings));
    fs.renameSync(temp, file);
  }
  const programInstalled = () => {
    try {
      return supported && fs.existsSync(cli) && fs.readFileSync(marker, "utf8").trim() === assets.whisper.version;
    } catch {
      return false;
    }
  };
  const modelPath = (id) => path.join(modelsDir, assets.models[id].file);
  const modelInstalled = (id) => {
    try {
      return fs.statSync(modelPath(id)).size === assets.models[id].size;
    } catch {
      return false;
    }
  };
  const localModel = () => (modelInstalled(settings.model) ? settings.model : Object.keys(assets.models).find(modelInstalled) || null);
  const localReady = () => programInstalled() && Boolean(localModel());

  // The provider in use: the owner's choice, else local whisper once installed.
  function effective() {
    if (fakeStt) return "fake";
    if (settings.provider) return settings.provider;
    return localReady() ? "whisper-local" : "";
  }
  function problem(provider) {
    if (provider === "fake") return "";
    if (!provider)
      return "Choose how Any Bot turns your speech into text in Settings → Voice: on this computer, or with a Groq or OpenAI key.";
    if (provider === "whisper-local") {
      if (!supported) return "Speech-to-text on this computer needs Windows. Choose Groq or OpenAI in Settings → Voice.";
      if (!localReady()) return "Download speech-to-text for this computer in Settings → Voice first.";
      return "";
    }
    if (APIS[provider]) return settings.keys[provider] ? "" : `Add your ${APIS[provider].label} API key in Settings → Voice first.`;
    if (provider === "webspeech") return settings.webspeech ? "" : "Check the built-in speech recognition in Settings → Voice first.";
    return "Choose a speech-to-text provider in Settings → Voice.";
  }
  function status() {
    const provider = effective();
    const reason = problem(provider);
    return {
      provider,
      chosen: settings.provider,
      ready: !reason,
      reason,
      keys: Object.fromEntries(Object.keys(APIS).map((id) => [id, Boolean(settings.keys[id])])),
      local: {
        supported,
        installed: programInstalled(),
        version: assets.whisper.version,
        programSize: assets.whisper.size,
        model: localModel() || settings.model,
        models: Object.fromEntries(
          Object.entries(assets.models).map(([id, model]) => [id, { label: model.label || id, note: model.note || "", size: model.size, installed: modelInstalled(id) }]),
        ),
        download: { ...download },
      },
      webspeech: settings.webspeech,
      voice: settings.voice,
      pushToTalk: settings.pushToTalk,
      fake: Boolean(fakeStt),
    };
  }
  function missing(provider) {
    if (now() - lastMissing < MISSING_EVERY) return;
    lastMissing = now();
    onDiagnostic({
      level: "warn",
      source: "voice",
      code: "voice.provider_missing",
      message: "Voice was used before speech-to-text was set up.",
      context: { provider: provider || "none" },
    });
  }
  function failed(context, message = "Speech-to-text failed.") {
    onDiagnostic({ level: "warn", source: "voice", code: "voice.stt_failed", message, context });
  }

  // The window asks before it opens the microphone.
  function start() {
    const current = status();
    if (!current.ready) missing(current.provider);
    return { ready: current.ready, reason: current.reason, provider: current.provider, voice: current.voice, pushToTalk: current.pushToTalk };
  }
  function setProvider(provider) {
    const next = String(provider || "");
    if (next && !PROVIDERS.includes(next)) throw new Error("Unknown speech-to-text provider.");
    settings.provider = next;
    save();
    return status();
  }
  function setKey({ provider, key } = {}) {
    if (!APIS[provider]) throw new Error("Keys are only for Groq and OpenAI.");
    const value = typeof key === "string" ? key.trim() : "";
    if (!value) delete settings.keys[provider];
    else {
      if (!/^[\x21-\x7e]{8,300}$/.test(value)) throw new Error("That doesn't look like an API key.");
      settings.keys[provider] = protect(value);
    }
    save();
    return status();
  }
  function set(payload = {}) {
    if (typeof payload.voice === "string") settings.voice = payload.voice.slice(0, 200);
    if (typeof payload.pushToTalk === "boolean") settings.pushToTalk = payload.pushToTalk;
    if (typeof payload.webspeech === "boolean") settings.webspeech = payload.webspeech;
    if (payload.model !== undefined) {
      if (!assets.models[payload.model]) throw new Error("Unknown model.");
      if (!modelInstalled(payload.model)) throw new Error("Download that model first.");
      settings.model = payload.model;
    }
    save();
    return status();
  }

  // Downloads stream to a .part file, hashing as they go; only a file with
  // the pinned size and SHA-256 is kept.
  async function fetchVerified(asset, dest, item, signal) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = `${dest}.part`;
    const offline = "Any Bot couldn't reach the download. Check your connection and try again.";
    let response;
    try {
      response = await fetchImpl(asset.url, { signal, redirect: "follow" });
    } catch {
      throw downloadError(item, signal.aborted ? "cancelled" : "network", offline);
    }
    if (!response.ok || !response.body) throw downloadError(item, "http", `The download failed (error ${response.status}). Try again later.`);
    const mismatch = downloadError(item, "hash", "The download didn't match the expected file, so it was deleted. Try again.");
    const hash = crypto.createHash("sha256");
    const out = fs.createWriteStream(part);
    let received = 0;
    try {
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > asset.size) throw mismatch;
        hash.update(chunk);
        download.received += chunk.length;
        if (!out.write(chunk)) await once(out, "drain");
      }
      out.end();
      await once(out, "close");
    } catch (error) {
      out.destroy();
      rm(part);
      throw error.item ? error : downloadError(item, signal.aborted ? "cancelled" : "network", offline);
    }
    if (received !== asset.size || hash.digest("hex") !== asset.sha256) {
      rm(part);
      throw mismatch;
    }
    fs.renameSync(part, dest);
  }
  async function installProgram(signal) {
    const zip = path.join(downloads, "whisper.zip");
    try {
      await fetchVerified(assets.whisper, zip, "program", signal);
      rm(unpack);
      fs.mkdirSync(unpack, { recursive: true });
      try {
        await extract(zip, unpack);
      } catch {
        throw downloadError("program", "extract", "The download couldn't be unpacked. Try again.");
      }
      const found = fs.readdirSync(unpack, { recursive: true }).find((entry) => path.basename(String(entry)).toLowerCase() === "whisper-cli.exe");
      if (!found) throw downloadError("program", "missing", "The download didn't contain whisper-cli.exe.");
      rm(programDir);
      fs.renameSync(path.dirname(path.join(unpack, String(found))), programDir);
      fs.writeFileSync(marker, assets.whisper.version);
    } finally {
      rm(unpack);
      rm(downloads);
    }
  }
  function freeBytes() {
    try {
      const stats = fs.statfsSync(root);
      return stats.bavail * stats.bsize;
    } catch {
      return Infinity;
    }
  }
  async function runDownload(id, signal) {
    try {
      fs.mkdirSync(root, { recursive: true });
      if (freeBytes() < download.total + SPARE_BYTES)
        throw downloadError("disk", "space", `There isn't enough free disk space: this needs about ${Math.ceil(download.total / 1e6)} MB.`);
      if (!programInstalled()) {
        download.step = "program";
        await installProgram(signal);
      }
      if (!modelInstalled(id)) {
        download.step = "model";
        await fetchVerified(assets.models[id], modelPath(id), "model", signal);
      }
      download = { state: "idle" };
      if (!modelInstalled(settings.model)) settings.model = id;
      if (!settings.provider) settings.provider = "whisper-local";
      save();
    } catch (error) {
      const cancelled = signal.aborted || error.reason === "cancelled";
      download = cancelled ? { state: "idle" } : { state: "failed", model: id, error: error.owner || "The download failed. Try again." };
      if (!cancelled)
        onDiagnostic({
          level: "warn",
          source: "voice",
          code: "voice.download_failed",
          message: "The speech-to-text download didn't finish.",
          context: { item: error.item || "unknown", reason: error.reason || "error" },
        });
    } finally {
      controller = null;
    }
    return status();
  }
  // Starts the owner's download and returns at once; downloaded() waits for it.
  function startDownload({ model = "base.en" } = {}) {
    if (!assets.models[model]) throw new Error("Unknown model.");
    if (!supported) throw new Error("Speech-to-text on this computer is available on Windows only.");
    if (controller) return status();
    const total = (programInstalled() ? 0 : assets.whisper.size) + (modelInstalled(model) ? 0 : assets.models[model].size);
    controller = new AbortController();
    download = { state: "downloading", model, received: 0, total, step: "program" };
    job = runDownload(model, controller.signal);
    return status();
  }
  function cancelDownload() {
    controller?.abort();
    return status();
  }
  function remove() {
    if (controller) throw new Error("Wait for the download to finish, or cancel it first.");
    rm(programDir);
    rm(modelsDir);
    rm(tmpDir);
    download = { state: "idle" };
    if (settings.provider === "whisper-local") settings.provider = "";
    save();
    return status();
  }

  async function transcribeLocal(audio) {
    const model = localModel();
    fs.mkdirSync(tmpDir, { recursive: true });
    const id = crypto.randomUUID();
    const wav = path.join(tmpDir, `${id}.wav`);
    const out = path.join(tmpDir, id);
    try {
      fs.writeFileSync(wav, audio);
      await run(cli, ["-m", modelPath(model), "-f", wav, "-otxt", "-of", out, "-nt", "-np", "-l", "en"], {
        timeout: RUN_TIMEOUT,
        windowsHide: true,
        cwd: programDir,
      });
      return fs.readFileSync(`${out}.txt`, "utf8");
    } catch (error) {
      const context = { provider: "whisper-local" };
      if (Number.isInteger(error?.code)) context.exit = error.code;
      if (error?.killed) context.reason = "timeout";
      failed(context);
      throw new Error(
        error?.killed
          ? "Local speech-to-text took over a minute and was stopped. Try a shorter turn, or the Base model."
          : "Local speech-to-text failed. Try again, or remove and download it again in Settings → Voice.",
      );
    } finally {
      rm(wav);
      rm(`${out}.txt`);
    }
  }
  async function transcribeApi(provider, audio) {
    const { label, url, model } = APIS[provider];
    let key;
    try {
      key = unprotect(settings.keys[provider]);
    } catch {
      failed({ provider, reason: "key" });
      throw new Error(`The saved ${label} key can't be read on this computer. Enter it again in Settings → Voice.`);
    }
    const form = new FormData();
    form.append("file", new Blob([audio], { type: "audio/wav" }), "speech.wav");
    form.append("model", model);
    form.append("response_format", "json");
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(API_TIMEOUT),
      });
    } catch (error) {
      failed({ provider, reason: error?.name === "TimeoutError" ? "timeout" : "network" });
      throw new Error(`${label} couldn't be reached. Check your connection and try again.`);
    }
    if (!response.ok) {
      failed({ provider, status: response.status });
      if (response.status === 401 || response.status === 403) throw new Error(`${label} didn't accept the API key. Check it in Settings → Voice.`);
      if (response.status === 429) throw new Error(`${label} says you've hit a rate or usage limit. Try again later.`);
      throw new Error(`${label} couldn't turn that into text (error ${response.status}).`);
    }
    const body = await response.json().catch(() => null);
    if (typeof body?.text !== "string") {
      failed({ provider, reason: "format" });
      throw new Error(`${label} sent back something Any Bot didn't understand.`);
    }
    return body.text;
  }
  async function transcribe({ wav } = {}) {
    const audio = asBytes(wav);
    if (!audio) throw new Error("That recording couldn't be used. Try again.");
    if (audio.length > MAX_WAV) throw new Error("That recording is too long: keep a turn under 60 seconds.");
    const format = parseWav(audio);
    if (!format || format.sampleRate !== 16000 || format.channels !== 1 || format.bits !== 16)
      throw new Error("That recording couldn't be used (Any Bot records 16 kHz mono). Try again.");
    if (format.seconds > MAX_SECONDS + 0.5) throw new Error("Keep a turn under 60 seconds.");
    const provider = effective();
    if (provider === "fake") return { text: fakeStt };
    const reason = problem(provider);
    if (reason) {
      missing(provider);
      throw new Error(reason);
    }
    if (provider === "webspeech") throw new Error("Built-in speech recognition runs in the window.");
    if (busy >= 2) throw new Error("Still working on the last recording. Try again in a moment.");
    busy += 1;
    try {
      const text = provider === "whisper-local" ? await transcribeLocal(audio) : await transcribeApi(provider, audio);
      return { text: cleanText(text) };
    } finally {
      busy -= 1;
    }
  }

  return {
    status,
    start,
    setProvider,
    setKey,
    set,
    download: startDownload,
    downloaded: () => job,
    cancelDownload,
    remove,
    transcribe,
  };
}

module.exports = { createVoice, clearVoiceTemp, parseWav, cleanText, WHISPER, MODELS, APIS };
