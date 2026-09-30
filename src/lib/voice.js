// Voice chat's pure parts (tests/voice.test.mjs): WAV encoding for main's
// speech-to-text (desktop/voice.cjs), the turn Segmenter that makes one
// message of a whole spoken turn, and the follow reducer that decides what
// to say while a run is followed through messages.follow. The browser glue
// is in useVoice.js; the turn-taking loop in voice-session.js.

export const SAMPLE_RATE = 16000;
// A turn ends after 1.3 s of silence, needs 300 ms of speech, and is cut at 60 s.
export const TURN = { hangoverMs: 1300, minSpeechMs: 300, maxMs: 60_000 };

// 16-bit PCM mono WAV. Samples are -1..1 (clipped).
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const data = samples.length * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const ascii = (at, text) => [...text].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + data, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : Math.min(0x7fff, s * 0x8000), true);
  }
  return bytes;
}

// Linear resampling, for a capture that couldn't run at 16 kHz.
export function resample(samples, from, to = SAMPLE_RATE) {
  if (from === to) return samples;
  const length = Math.max(0, Math.round((samples.length * to) / from));
  const out = new Float32Array(length);
  const step = from / to;
  for (let i = 0; i < length; i++) {
    const at = i * step;
    const left = Math.floor(at);
    const right = Math.min(samples.length - 1, left + 1);
    const t = at - left;
    out[i] = samples[left] * (1 - t) + samples[right] * t;
  }
  return out;
}

const rms = (frame) => {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
};

// Energy-based turns. Audio comes in 20 ms frames; a frame is speech when
// it is well above the room's noise (tracked while nobody speaks) and above
// a floor. A turn starts with the first speech frame (plus 300 ms before it,
// so the first word isn't clipped) and ends after `hangoverMs` of silence:
// speech that resumes sooner is the same turn. Turns with less than
// `minSpeechMs` of speech (a click, a cough) are dropped; a turn reaching
// `maxMs` is cut there. push() returns the turns it finished.
export class Segmenter {
  constructor({ sampleRate = SAMPLE_RATE, hangoverMs = TURN.hangoverMs, minSpeechMs = TURN.minSpeechMs, maxMs = TURN.maxMs, floor = 0.012, ratio = 3 } = {}) {
    this.frame = Math.round(sampleRate / 50);
    this.frameMs = 20;
    this.hangover = hangoverMs;
    this.minSpeech = minSpeechMs;
    this.max = Math.round((maxMs / 1000) * sampleRate);
    this.preroll = Math.round(0.3 * sampleRate);
    this.floor = floor;
    this.ratio = ratio;
    this.noise = floor / ratio;
    this.level = 0;
    this.pending = new Float32Array(0);
    this.reset();
  }
  reset() {
    this.chunks = [];
    this.length = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.trailing = 0;
    this.before = [];
    this.beforeLength = 0;
  }
  get inTurn() {
    return this.length > 0;
  }
  push(samples) {
    const input = this.pending.length ? concat([this.pending, samples]) : samples;
    const turns = [];
    let at = 0;
    for (; at + this.frame <= input.length; at += this.frame) {
      const turn = this.step(input.slice(at, at + this.frame));
      if (turn) turns.push(turn);
    }
    this.pending = input.slice(at);
    return turns;
  }
  step(frame) {
    const level = rms(frame);
    this.level = level;
    const speech = level > Math.max(this.floor, this.noise * this.ratio);
    if (!this.inTurn) {
      if (!speech) {
        // The room's noise, slowly, and the last 300 ms before a turn.
        this.noise = Math.min(0.05, this.noise * 0.95 + level * 0.05);
        this.before.push(frame);
        this.beforeLength += frame.length;
        while (this.beforeLength - this.before[0].length >= this.preroll) this.beforeLength -= this.before.shift().length;
        return null;
      }
      for (const chunk of this.before) this.add(chunk);
      this.before = [];
      this.beforeLength = 0;
    }
    this.add(frame);
    if (speech) {
      this.speechMs += this.frameMs;
      this.silenceMs = 0;
      this.trailing = 0;
    } else {
      this.silenceMs += this.frameMs;
      this.trailing += frame.length;
    }
    if (this.length >= this.max) return this.finish(false);
    if (this.silenceMs >= this.hangover) return this.finish(true);
    return null;
  }
  add(frame) {
    const room = this.max - this.length;
    const part = frame.length > room ? frame.slice(0, room) : frame;
    this.chunks.push(part);
    this.length += part.length;
  }
  // The turn so far, without most of its trailing silence; null when it
  // was too short to be speech.
  finish(trim) {
    const enough = this.speechMs >= this.minSpeech;
    let samples = concat(this.chunks);
    if (trim) samples = samples.slice(0, Math.max(0, samples.length - Math.max(0, this.trailing - this.preroll)));
    this.reset();
    return enough ? samples : null;
  }
  // Ends the turn now (the owner pressed stop, or let go of push-to-talk).
  flush() {
    if (this.pending.length) this.pending = new Float32Array(0);
    if (!this.inTurn) return null;
    return this.finish(true);
  }
}

export function concat(parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// What to say while a sent turn is followed (messages.follow items, the
// bridgeUpdates shape): each hand-off and each approval once, then the reply
// or how the work ended, once. Replies go out as written; the session makes
// them speakable. Other text (approval summaries, errors) is cut to a line.
export const initialFollow = () => ({ handoffs: [], approvals: [], done: false });
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "interrupted"]);
const firstLine = (text, max = 160) => {
  const line = String(text || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  return line.length > max ? `${line.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : line;
};
const stop = (text) => (/[.!?…]$/.test(text) ? text : `${text}.`);
const noPaths = (text) =>
  text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\b(?:https?|file):\/\/\S+/gi, "a link")
    .replace(/[A-Za-z]:[\\/][^\s"'`]*|\\\\[^\s"'`]+|(?<![\w.])~?\/(?:[\w.-]+\/)+[\w.-]*/g, (path) => path.split(/[\\/]/).filter(Boolean).at(-1) || "a folder");

export function followReducer(state, items = []) {
  const events = [];
  let next = state;
  if (state.done) return { state, events, done: true };
  for (const item of items) {
    if (!item) continue;
    const newHandoffs = (item.handoffs || []).filter((h) => !next.handoffs.includes(h.id));
    const newApprovals = (item.approvals || []).filter((a) => !next.approvals.includes(a.id));
    for (const handoff of newHandoffs) events.push({ kind: "handoff", text: `Handed to ${handoff.to || "a teammate"}.` });
    for (const approval of newApprovals) {
      const what = noPaths(firstLine(approval.summary || approval.tool || "", 140));
      events.push({ kind: "approval", text: what ? `Waiting for your approval in the app: ${stop(what)}` : "Waiting for your approval in the app." });
    }
    next = {
      ...next,
      handoffs: [...next.handoffs, ...newHandoffs.map((h) => h.id)],
      approvals: [...next.approvals, ...newApprovals.map((a) => a.id)],
    };
    if (!TERMINAL.has(item.status)) continue;
    if (item.status === "succeeded")
      events.push(item.reply ? { kind: "reply", text: item.reply } : { kind: "error", text: "Done. There's nothing to read out." });
    else if (item.status === "cancelled") events.push({ kind: "error", text: "That was stopped." });
    else if (item.status === "interrupted") events.push({ kind: "error", text: "That was cut off when Any Bot closed." });
    else {
      const why = noPaths(firstLine(item.error, 160));
      events.push({ kind: "error", text: why ? `That didn't finish: ${stop(why)}` : "That didn't finish." });
    }
    next = { ...next, done: true };
    break;
  }
  return { state: next, events, done: next.done };
}

// "Atlas is working · 2m" (seconds under a minute).
export function workingLabel(name, since, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  const took = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${name} is working · ${took}`;
}
