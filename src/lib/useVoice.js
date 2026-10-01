// Voice chat and dictation in the window: the microphone (an AudioWorklet
// at 16 kHz), turns (Segmenter), speech-to-text in main (voice.transcribe,
// desktop/voice.cjs) or the window's own recognizer (webspeech), and
// speaking replies one sentence at a time. The turn-taking itself is
// VoiceSession (src/lib/voice-session.js).
import { useCallback, useEffect, useRef, useState } from "react";
// Its own file (never a data: URL, which the CSP refuses for worklets).
import workletUrl from "../voice/pcm-worklet.js?url&no-inline";
import { pushToTalkFor, TURN, voiceKey } from "./voice.js";
import { cleanError, hearAudio, openMic, speakSentences } from "./voice-io.js";
import { VoiceSession } from "./voice-session.js";

const OFF = { mode: "off", phase: "off" };
const clean = cleanError;
// Settings → Voice's Try it.
export { speakSentences };

// One turn through the microphone and main's speech-to-text (voice-io.js).
const hearMic = (options) =>
  hearAudio({
    ...options,
    open: (onFrames) => openMic(onFrames, { workletUrl }),
    transcribe: (wav) => window.anybot.request("voice.transcribe", { wav }),
  });

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
  return { result, stop: () => end(null), finish: () => end(), hearing: () => !done && parts.length > 0, press() {}, release() {} };
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

// state: {mode: "off" | "chat" | "dictate", phase, bot, conversation, since,
// level}. `send(payload)` posts a message (true when it went); `onThread`
// (conversation, messageId) when a project voice chat's thread starts;
// `onNotice(text)` when a voice chat ends on its own (voice-session.js).
export function useVoice({ send, onError, onThread, onNotice }) {
  const [state, setState] = useState(OFF);
  const [pushToTalk, setPushToTalk] = useState(false);
  const session = useRef(null);
  const generation = useRef(0);
  const handlers = useRef({ send, onError, onThread, onNotice });
  handlers.current = { send, onError, onThread, onNotice };

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
      const ptt = pushToTalkFor(target.mode, start);
      const next = new VoiceSession(
        {
          hear: start.provider === "webspeech" ? hearWebSpeech : hearMic,
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
          onNotice: (text) => handlers.current.onNotice?.(text),
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

  // Esc ends voice (unless a field, a dialog or a menu used it: voiceKey);
  // with push-to-talk, Space (outside a text field) talks.
  useEffect(() => {
    if (state.mode === "off") return undefined;
    const key = (event) => {
      const { action, prevent } = voiceKey(event, { pushToTalk });
      if (prevent) event.preventDefault();
      if (action === "stop") stop();
      else if (action === "press") press();
      else if (action === "release") release();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
    };
  }, [state.mode, pushToTalk, stop, press, release]);

  // A hidden window (closed to the tray) or a minimized one ends voice:
  // there is no bar to see and no Esc to press, and an open mic would keep
  // sending what the room says. Main says so on hide and minimize
  // (window-shell.cjs stopVoiceWhenHidden); visibilitychange covers the same.
  useEffect(() => {
    if (state.mode === "off") return undefined;
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    const unsubscribe = window.anybot?.onVoiceStop?.(stop);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      unsubscribe?.();
    };
  }, [state.mode, stop]);

  useEffect(() => () => session.current?.stop(), []);

  return { state, pushToTalk, startChat, dictate, stop, press, release };
}
