// Voice chat and dictation in the window: the microphone (an AudioWorklet
// at 16 kHz), turns (Segmenter), speech-to-text in main (voice.transcribe,
// desktop/voice.cjs) or the window's own recognizer (webspeech), and
// speaking replies one sentence at a time. The turn-taking itself is
// VoiceSession (src/lib/voice-session.js).
import { useCallback, useEffect, useRef, useState } from "react";
// Its own file (never a data: URL, which the CSP refuses for worklets).
import workletUrl from "../voice/pcm-worklet.js?url&no-inline";
import { concat, encodeWav, resample, SAMPLE_RATE, Segmenter, TURN } from "./voice.js";
import { VoiceSession } from "./voice-session.js";

const OFF = { mode: "off", phase: "off" };
const clean = (message) => String(message || "").replace(/^Error invoking remote method '[^']+': Error: /, "");

export function micProblem(error) {
  const name = error?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Any Bot can't use the microphone. In Windows Settings → Privacy & security → Microphone, turn on microphone access and let desktop apps use it.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found. Plug one in, or choose one in Windows sound settings.";
  if (name === "NotReadableError" || name === "AbortError") return "The microphone is busy or unavailable. Close other apps that use it and try again.";
  return `The microphone couldn't start: ${clean(error?.message) || "unknown error"}.`;
}

// The microphone at 16 kHz mono; `onFrames` gets 20 ms Float32Arrays.
// Recording only: the context has no output (sinkId none).
export async function openMic(onFrames) {
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
    throw new Error(`The microphone couldn't start: ${clean(error?.message) || "unknown error"}.`);
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
export function hearAudio({ pushToTalk = false, onPhase = () => {}, onLevel = () => {} } = {}) {
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
  const closeMic = () => {
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
      const { text } = await window.anybot.request("voice.transcribe", { wav: encodeWav(samples) });
      settle(resolve, text);
    } catch (error) {
      settle(reject, new Error(clean(error?.message)));
    }
  };
  const open = async (onFrames) => {
    try {
      const next = await openMic(onFrames);
      // Stopped, finished or let go while the mic was starting.
      if (settled || ending || (pushToTalk && !pressed)) next.close();
      else mic = next;
    } catch (error) {
      settle(reject, error);
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

// One turn through the window's own speech recognition (only offered once
// Settings → Voice has checked it works). The turn ends 1.3 s after the last
// words it recognized.
export function hearWebSpeech({ onPhase = () => {} } = {}) {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  let resolve, reject;
  const result = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  if (!Speech) {
    reject(new Error("Built-in speech recognition isn't available here. Choose another provider in Settings → Voice."));
    return { result, stop() {}, finish() {}, press() {}, release() {} };
  }
  const recognition = new Speech();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = navigator.language || "en-US";
  const parts = [];
  let done = false;
  let timer = null;
  const end = (value = parts.join(" ").trim() || null) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try {
      recognition.abort();
    } catch {
      // Already stopped.
    }
    if (value) onPhase("transcribing");
    resolve(value);
  };
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++)
      if (event.results[i].isFinal) parts.push(event.results[i][0].transcript.trim());
    clearTimeout(timer);
    timer = setTimeout(() => end(), TURN.hangoverMs);
  };
  recognition.onerror = (event) => {
    if (done || event.error === "no-speech" || event.error === "aborted") return;
    done = true;
    clearTimeout(timer);
    reject(new Error(`Built-in speech recognition stopped (${event.error}). Choose another provider in Settings → Voice.`));
  };
  // It stops on its own after a quiet while; listen again until a turn.
  recognition.onend = () => {
    if (done) return;
    if (parts.length) end();
    else
      try {
        recognition.start();
      } catch {
        end(null);
      }
  };
  recognition.start();
  return { result, stop: () => end(null), finish: () => end(), press() {}, release() {} };
}

// Settings → Voice: does the window's recognizer reach its service? (In
// Electron it usually fails at once with "network".) Listens up to 8 s.
export function probeWebSpeech() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) return Promise.resolve(false);
  return new Promise((resolve) => {
    const recognition = new Speech();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        recognition.abort();
      } catch {
        // Already stopped.
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(true), 8000);
    recognition.onresult = () => finish(true);
    recognition.onerror = (event) => finish(event.error === "no-speech");
    try {
      recognition.start();
    } catch {
      finish(false);
    }
  });
}

// Says each sentence as its own utterance; resolves after the last one (or
// when cancelled). An end event that never comes can't keep the mic shut.
export function speakSentences(sentences, voiceName = "", token = { cancelled: false }) {
  const synth = window.speechSynthesis;
  if (!synth || !sentences.length) return Promise.resolve();
  const voice = voiceName ? synth.getVoices().find((v) => v.name === voiceName) : null;
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

const typing = (target) =>
  Boolean(target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)));

// state: {mode: "off" | "chat" | "dictate", phase, bot, conversation, since,
// level}. `send(payload)` posts a message (true when it went); `onThread`
// (conversation, messageId) when a project voice chat's thread starts.
export function useVoice({ send, onError, onThread }) {
  const [state, setState] = useState(OFF);
  const [pushToTalk, setPushToTalk] = useState(false);
  const session = useRef(null);
  const generation = useRef(0);
  const handlers = useRef({ send, onError, onThread });
  handlers.current = { send, onError, onThread };

  const stop = useCallback(() => {
    generation.current += 1;
    const current = session.current;
    session.current = null;
    current?.stop();
    setState(OFF);
  }, []);

  const begin = useCallback(
    async (target) => {
      stop();
      const mine = generation.current;
      let start;
      try {
        start = await window.anybot.request("voice.start");
      } catch (error) {
        handlers.current.onError?.(clean(error?.message));
        return;
      }
      if (mine !== generation.current) return;
      if (!start.ready) {
        handlers.current.onError?.(start.reason);
        return;
      }
      const token = { cancelled: false };
      const ptt = target.mode === "chat" && start.pushToTalk === true;
      const next = new VoiceSession(
        {
          hear: start.provider === "webspeech" ? hearWebSpeech : hearAudio,
          pushToTalk: ptt,
          send: (payload) => handlers.current.send(payload),
          follow: async (requestIds) => (await window.anybot.request("messages.follow", { requestIds })).items,
          subscribe: (listener) => window.anybot.onChanged(listener),
          speak: (sentences) => speakSentences(sentences, start.voice, token),
          cancelSpeech: () => {
            token.cancelled = true;
            window.speechSynthesis?.cancel();
          },
          onState: (value) => {
            if (session.current !== next) return;
            if (value.phase === "off") session.current = null;
            setState(value);
          },
          onError: (error) => handlers.current.onError?.(clean(error?.message || error)),
          onThread: (id) => handlers.current.onThread?.(target.conversation, id),
        },
        target,
      );
      session.current = next;
      setPushToTalk(ptt);
      next.start();
    },
    [stop],
  );

  const startChat = useCallback((target) => begin({ mode: "chat", ...target }), [begin]);
  // The composer's mic: one turn into the draft; pressed again, it ends the turn now.
  const dictate = useCallback(
    (onText) => {
      if (session.current?.target.mode === "dictate") session.current.finish();
      else begin({ mode: "dictate", onText });
    },
    [begin],
  );
  const press = useCallback(() => session.current?.press(), []);
  const release = useCallback(() => session.current?.release(), []);

  // Esc ends voice; with push-to-talk, Space (outside a text field) talks.
  useEffect(() => {
    if (state.mode === "off") return undefined;
    const down = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        stop();
        return;
      }
      if (pushToTalk && event.code === "Space" && !typing(event.target)) {
        event.preventDefault();
        if (!event.repeat) press();
      }
    };
    const up = (event) => {
      if (pushToTalk && event.code === "Space" && !typing(event.target)) {
        event.preventDefault();
        release();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [state.mode, pushToTalk, stop, press, release]);

  useEffect(() => () => session.current?.stop(), []);

  return { state, pushToTalk, startChat, dictate, stop, press, release };
}
