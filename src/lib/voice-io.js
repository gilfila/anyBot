// The window's side of voice: the microphone (an AudioWorklet at 16 kHz),
// one heard turn through main's speech-to-text, and speaking a reply one
// sentence at a time. No React and no Vite imports, so node:test can run it
// with stand-ins for the browser (tests/voice.test.mjs); useVoice.js passes
// the worklet's URL and main's voice.transcribe.
import { concat, encodeWav, resample, SAMPLE_RATE, Segmenter, TURN } from "./voice.js";

export const cleanError = (message) => String(message || "").replace(/^Error invoking remote method '[^']+': Error: /, "");

export function micProblem(error) {
  const name = error?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Any Bot can't use the microphone. In Windows Settings → Privacy & security → Microphone, turn on microphone access and let desktop apps use it.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found. Plug one in, or choose one in Windows sound settings.";
  if (name === "NotReadableError" || name === "AbortError") return "The microphone is busy or unavailable. Close other apps that use it and try again.";
  return `The microphone couldn't start: ${cleanError(error?.message) || "unknown error"}.`;
}

// The microphone at 16 kHz mono; `onFrames` gets 20 ms Float32Arrays.
// Recording only: the context has no output (sinkId none).
export async function openMic(onFrames, { workletUrl } = {}) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    throw new Error(micProblem(error));
  }
  let context;
  try {
    try {
      context = new AudioContext({ sampleRate: SAMPLE_RATE, sinkId: { type: "none" } });
    } catch {
      context = new AudioContext();
    }
    await context.audioWorklet.addModule(workletUrl);
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "anybot-pcm");
    const rate = context.sampleRate;
    node.port.onmessage = (event) => onFrames(rate === SAMPLE_RATE ? event.data : resample(event.data, rate, SAMPLE_RATE));
    source.connect(node);
    if (context.state !== "running") await context.resume();
    let closed = false;
    return {
      close() {
        if (closed) return;
        closed = true;
        node.port.onmessage = null;
        try {
          source.disconnect();
        } catch {
          // Already gone.
        }
        for (const track of stream.getTracks()) track.stop();
        context.close().catch(() => {});
      },
    };
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    context?.close().catch(() => {});
    throw new Error(`The microphone couldn't start: ${cleanError(error?.message) || "unknown error"}.`);
  }
}

const level = (frame) => {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
};

// One turn through the microphone and main's speech-to-text. The mic closes
// the moment the turn ends, before the text comes back. With push-to-talk
// the mic is open only while the key or button is held.
// `open(onFrames)` → Promise<{close()}> (openMic); `transcribe(wav)` →
// Promise<{text}> (main's voice.transcribe).
export function hearAudio({ pushToTalk = false, onPhase = () => {}, onLevel = () => {}, open: openAudio, transcribe: toText } = {}) {
  let resolve, reject;
  const result = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  const segmenter = new Segmenter();
  let mic = null;
  let settled = false;
  let ending = false;
  let held = [];
  let heldLength = 0;
  let pressed = false;
  // Each open gets a ticket; closing the mic moves it on, so an open still
  // starting (a press, let go and pressed again before the mic was up) is
  // closed the moment it starts and its frames are never used.
  let ticket = 0;
  const closeMic = () => {
    ticket += 1;
    mic?.close();
    mic = null;
  };
  const settle = (fn, value) => {
    if (settled) return;
    settled = true;
    closeMic();
    fn(value);
  };
  const transcribe = async (samples) => {
    ending = true;
    closeMic();
    if (!samples || !samples.length) return settle(resolve, null);
    onPhase("transcribing");
    try {
      const { text } = await toText(encodeWav(samples));
      settle(resolve, text);
    } catch (error) {
      settle(reject, new Error(cleanError(error?.message)));
    }
  };
  const open = async (onFrames) => {
    const mine = ++ticket;
    try {
      const next = await openAudio((frames) => mine === ticket && onFrames(frames));
      // Stopped, finished, let go or opened again while the mic was starting.
      if (mine !== ticket || mic || settled || ending || (pushToTalk && !pressed)) next.close();
      else mic = next;
    } catch (error) {
      if (mine === ticket) settle(reject, error);
    }
  };
  const heldTurn = () => {
    const samples = concat(held);
    held = [];
    heldLength = 0;
    return samples;
  };
  if (!pushToTalk)
    open((frames) => {
      if (ending || settled) return;
      const turns = segmenter.push(frames);
      onLevel(segmenter.level);
      if (turns.length) transcribe(turns[0]);
    });
  return {
    result,
    stop: () => settle(resolve, null),
    // A turn is under way (VoiceSession's idle limit waits for it).
    hearing: () => !settled && (ending || pressed || segmenter.inTurn),
    // End the turn now (dictation: the mic button pressed again).
    finish: () => {
      if (ending || settled) return;
      transcribe(pushToTalk ? heldTurn() : segmenter.flush());
    },
    press: () => {
      if (!pushToTalk || pressed || ending || settled) return;
      pressed = true;
      held = [];
      heldLength = 0;
      onPhase("holding");
      open((frames) => {
        if (!pressed || ending || settled) return;
        held.push(frames);
        heldLength += frames.length;
        onLevel(level(frames));
        if (heldLength >= (TURN.maxMs / 1000) * SAMPLE_RATE) transcribe(heldTurn());
      });
    },
    release: () => {
      if (!pushToTalk || !pressed || ending || settled) return;
      pressed = false;
      closeMic();
      if (heldLength < (TURN.minSpeechMs / 1000) * SAMPLE_RATE) {
        // A tap: keep waiting for a real turn.
        held = [];
        heldLength = 0;
        onPhase("listening");
        return;
      }
      transcribe(heldTurn());
    },
  };
}

// The chosen voice. Right after launch the system's list is empty until
// its first voiceschanged, so wait for that (a second at most) rather than
// read the first reply in the default voice.
function chosenVoice(synth, name, waitMs = 1000) {
  const find = () => synth.getVoices().find((v) => v.name === name) || null;
  if (!name || find() || synth.getVoices().length || !synth.addEventListener) return Promise.resolve(find());
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      synth.removeEventListener?.("voiceschanged", done);
      resolve(find());
    };
    const timer = setTimeout(done, waitMs);
    synth.addEventListener("voiceschanged", done);
  });
}

// Says each sentence as its own utterance; resolves after the last one (or
// when cancelled). An end event that never comes can't keep the mic shut.
export async function speakSentences(sentences, voiceName = "", token = { cancelled: false }) {
  const synth = window.speechSynthesis;
  if (!synth || !sentences.length) return;
  const voice = await chosenVoice(synth, voiceName);
  const spoken = [];
  return new Promise((resolve) => {
    let index = 0;
    const next = () => {
      if (token.cancelled || index >= sentences.length) {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(sentences[index++]);
      if (voice) utterance.voice = voice;
      // Chromium can drop the end event of an utterance nothing refers to.
      spoken.push(utterance);
      let over = false;
      const guard = setTimeout(() => done(), 5000 + utterance.text.length * 120);
      const done = () => {
        if (over) return;
        over = true;
        clearTimeout(guard);
        next();
      };
      utterance.onend = done;
      utterance.onerror = done;
      synth.speak(utterance);
    };
    next();
  });
}
