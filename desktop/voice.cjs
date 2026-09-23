// Voice settings and the optional ElevenLabs connector. Runs in the main
// process so the API key never reaches the renderer: it is encrypted with
// Electron safeStorage (DPAPI on Windows) and only used for outbound calls
// from here. The renderer sees `configured: true`, never the key.
const fs = require("node:fs");
const path = require("node:path");

const API = "https://api.elevenlabs.io";
const PROVIDERS = new Set(["system", "elevenlabs"]);
const VOICE_ID = /^[A-Za-z0-9]{1,64}$/;
const MODEL_ID = /^[a-z0-9_]{1,64}$/;
const EMPLOYEE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const DEFAULT_MODEL = "eleven_flash_v2_5";
const MAX_SPEAK_CHARS = 2000;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "audio/mp4"]);

function defaults() {
  return {
    stt: "system",
    tts: "system",
    voiceId: "",
    model: DEFAULT_MODEL,
    employeeVoices: {},
    elevenlabsKey: "",
  };
}

function createVoiceService({ dir, safeStorage, fetch = globalThis.fetch, timeoutMs = 30000 }) {
  const file = path.join(dir, "voice.json");
  let state = load();

  function load() {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      return { ...defaults(), ...sanitize(value, defaults()), elevenlabsKey: typeof value.elevenlabsKey === "string" ? value.elevenlabsKey : "" };
    } catch {
      return defaults();
    }
  }
  function persist() {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  }
  function key() {
    if (!state.elevenlabsKey) return "";
    try {
      return safeStorage.decryptString(Buffer.from(state.elevenlabsKey, "base64"));
    } catch {
      return "";
    }
  }
  function publicSettings() {
    const configured = Boolean(key());
    return {
      stt: state.stt,
      tts: state.tts,
      voiceId: state.voiceId,
      model: state.model,
      employeeVoices: { ...state.employeeVoices },
      elevenlabs: {
        configured,
        encryptionAvailable: safeStorage.isEncryptionAvailable(),
      },
    };
  }
  async function call(route, init = {}) {
    const apiKey = key();
    if (!apiKey) throw new Error("Add an ElevenLabs API key in Settings → Voice first.");
    let response;
    try {
      response = await fetch(`${API}${route}`, {
        ...init,
        headers: { ...(init.headers || {}), "xi-api-key": apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(
        error?.name === "TimeoutError"
          ? "ElevenLabs did not respond in time."
          : "Could not reach ElevenLabs. Check your internet connection.",
      );
    }
    if (response.ok) return response;
    let detail = "";
    try {
      const body = await response.json();
      detail = String(body?.detail?.message || body?.detail || "").slice(0, 200);
    } catch {}
    if (response.status === 401) throw new Error("ElevenLabs rejected the API key.");
    if (response.status === 429) throw new Error("ElevenLabs rate limit or quota reached.");
    throw new Error(`ElevenLabs request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  async function listVoices() {
    const response = await call("/v1/voices");
    const body = await response.json();
    return (Array.isArray(body?.voices) ? body.voices : [])
      .filter((voice) => VOICE_ID.test(String(voice?.voice_id || "")))
      .map((voice) => ({
        id: voice.voice_id,
        name: String(voice.name || voice.voice_id).slice(0, 80),
        category: String(voice.category || "").slice(0, 40),
      }));
  }

  return {
    settings: publicSettings,
    save(payload = {}) {
      const next = { ...state, ...sanitize(payload, state) };
      if (!key() && (next.stt === "elevenlabs" || next.tts === "elevenlabs"))
        throw new Error("Add an ElevenLabs API key before choosing ElevenLabs.");
      state = next;
      persist();
      return publicSettings();
    },
    async setKey(payload = {}) {
      const value = String(payload.key ?? "").trim();
      if (!/^[A-Za-z0-9_-]{20,200}$/.test(value)) throw new Error("That doesn't look like an ElevenLabs API key.");
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("Secure storage is unavailable on this computer, so the key can't be saved safely.");
      const previous = state;
      state = { ...state, elevenlabsKey: safeStorage.encryptString(value).toString("base64") };
      let voices;
      try {
        voices = await listVoices();
      } catch (error) {
        state = previous;
        throw error;
      }
      if (!voices.some((voice) => voice.id === state.voiceId)) state.voiceId = voices[0]?.id || "";
      state.stt = "elevenlabs";
      state.tts = "elevenlabs";
      persist();
      return { settings: publicSettings(), voices };
    },
    clearKey() {
      state = { ...state, elevenlabsKey: "", stt: "system", tts: "system" };
      persist();
      return publicSettings();
    },
    listVoices,
    async speak(payload = {}) {
      const text = String(payload.text ?? "").trim().slice(0, MAX_SPEAK_CHARS);
      if (!text) throw new Error("Nothing to speak.");
      const employee = typeof payload.employeeId === "string" ? payload.employeeId : "";
      const voiceId = state.employeeVoices[employee] || state.voiceId;
      if (!key()) throw new Error("Add an ElevenLabs API key in Settings → Voice first.");
      if (!voiceId) throw new Error("Choose an ElevenLabs voice in Settings → Voice.");
      const response = await call(
        `/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "audio/mpeg" },
          body: JSON.stringify({ text, model_id: state.model }),
        },
      );
      return { audio: new Uint8Array(await response.arrayBuffer()), mime: "audio/mpeg" };
    },
    async transcribe(payload = {}) {
      const audio = payload.audio;
      if (!(audio instanceof Uint8Array) || !audio.byteLength) throw new Error("No audio was recorded.");
      if (audio.byteLength > MAX_AUDIO_BYTES) throw new Error("That recording is too long to transcribe.");
      const mime = String(payload.mime || "audio/webm").split(";")[0];
      if (!AUDIO_TYPES.has(mime)) throw new Error("Unsupported audio format.");
      const form = new FormData();
      form.append("model_id", "scribe_v1");
      form.append("tag_audio_events", "false");
      form.append("file", new Blob([audio], { type: mime }), `speech.${mime.split("/")[1]}`);
      const response = await call("/v1/speech-to-text", { method: "POST", body: form });
      const body = await response.json();
      return { text: String(body?.text || "").trim() };
    },
  };
}

function sanitize(payload, current) {
  const out = {};
  if (payload.stt !== undefined) {
    if (!PROVIDERS.has(payload.stt)) throw new Error("Unknown speech-to-text provider.");
    out.stt = payload.stt;
  }
  if (payload.tts !== undefined) {
    if (!PROVIDERS.has(payload.tts)) throw new Error("Unknown text-to-speech provider.");
    out.tts = payload.tts;
  }
  if (payload.voiceId !== undefined) {
    if (payload.voiceId !== "" && !VOICE_ID.test(payload.voiceId)) throw new Error("Invalid voice.");
    out.voiceId = payload.voiceId;
  }
  if (payload.model !== undefined) {
    if (!MODEL_ID.test(payload.model)) throw new Error("Invalid voice model.");
    out.model = payload.model;
  }
  if (payload.employeeVoices !== undefined) {
    if (!payload.employeeVoices || typeof payload.employeeVoices !== "object") throw new Error("Invalid bot voices.");
    const voices = {};
    for (const [employee, voice] of Object.entries(payload.employeeVoices)) {
      if (!EMPLOYEE_ID.test(employee)) throw new Error("Invalid bot voices.");
      if (voice === "" || voice === null) continue;
      if (!VOICE_ID.test(voice)) throw new Error("Invalid voice.");
      voices[employee] = voice;
    }
    out.employeeVoices = voices;
  }
  return out;
}

const VOICE_METHODS = new Set([
  "voice.settings",
  "voice.save",
  "voice.setKey",
  "voice.clearKey",
  "voice.voices",
  "voice.speak",
  "voice.transcribe",
]);

function handleVoice(service, method, payload) {
  switch (method) {
    case "voice.settings":
      return service.settings();
    case "voice.save":
      return service.save(payload);
    case "voice.setKey":
      return service.setKey(payload);
    case "voice.clearKey":
      return service.clearKey();
    case "voice.voices":
      return service.listVoices();
    case "voice.speak":
      return service.speak(payload);
    case "voice.transcribe":
      return service.transcribe(payload);
    default:
      throw new Error("Operation not allowed");
  }
}

module.exports = { createVoiceService, handleVoice, VOICE_METHODS, DEFAULT_MODEL };
