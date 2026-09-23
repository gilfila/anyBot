// Renderer side of voice: a listener (microphone → text) and a speaker
// (text → audio), each with a local "system" provider and an ElevenLabs
// provider that goes through the main-process bridge. Both can be paused so
// the microphone never hears the speaker.
import { speechChunks } from "./speech.js";

export const SYSTEM_STT_UNAVAILABLE =
  "System speech recognition isn't available in the desktop app. Add an ElevenLabs key in Settings → Voice to talk to your team (a local Whisper option is coming).";

// Electron wraps main-process errors; show people the message only.
export function voiceError(error) {
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

function recognitionError(code) {
  if (code === "network" || code === "service-not-allowed" || code === "language-not-supported")
    return SYSTEM_STT_UNAVAILABLE;
  if (code === "not-allowed" || code === "audio-capture")
    return "anyBot can't use the microphone. Check that a microphone is connected and allowed in Windows privacy settings.";
  return `Listening stopped: ${code}`;
}

// Records one utterance at a time with a simple energy-based voice activity
// detector: speech starts when the level rises above the noise floor and the
// utterance ends after `silenceMs` of quiet.
function createRecorder({ onUtterance, onLevel, silenceMs = 1100, maxMs = 60000 }) {
  let stream, context, analyser, recorder, timer;
  let chunks = [];
  let heard = false, quietSince = 0, startedAt = 0, floor = 0.01, paused = false, closed = false;
  const samples = new Float32Array(2048);

  function level() {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) sum += value * value;
    return Math.sqrt(sum / samples.length);
  }
  function begin() {
    if (closed || paused) return;
    chunks = [];
    heard = false;
    quietSince = 0;
    startedAt = performance.now();
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported?.(t));
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    recorder.onstop = () => {
      const keep = heard;
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      chunks = [];
      if (keep && blob.size) onUtterance(blob);
      else begin();
    };
    recorder.start(250);
  }
  // A timer, not requestAnimationFrame: voice chat keeps working while the
  // window is hidden in the tray.
  function tick() {
    if (closed || paused || recorder?.state !== "recording") return;
    const now = performance.now();
    const rms = level();
    onLevel?.(rms);
    if (!heard) floor = floor * 0.95 + rms * 0.05;
    const loud = rms > Math.max(0.02, floor * 2.5);
    if (loud) {
      heard = true;
      quietSince = 0;
    } else if (heard) {
      quietSince ||= now;
      if (now - quietSince > silenceMs) recorder.stop();
    }
    // Nothing said for a while: drop the buffer and start fresh so idle
    // listening never builds up a huge recording.
    if (!heard && now - startedAt > 15000) recorder.stop();
    if (heard && now - startedAt > maxMs) recorder.stop();
  }
  return {
    async start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        throw new Error(recognitionError("not-allowed"));
      }
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      begin();
      timer = setInterval(tick, 50);
    },
    // Called after each utterance is handled, and around speech playback.
    pause() {
      paused = true;
      if (recorder?.state === "recording") {
        heard = false;
        recorder.stop();
      }
    },
    resume() {
      if (closed) return;
      paused = false;
      if (recorder?.state !== "recording") begin();
    },
    stop() {
      closed = true;
      clearInterval(timer);
      try {
        if (recorder?.state === "recording") {
          recorder.onstop = null;
          recorder.stop();
        }
      } catch {}
      stream?.getTracks().forEach((track) => track.stop());
      context?.close().catch(() => {});
    },
  };
}

// Listener contract: start() → onText(text) for each utterance, pause/resume
// around playback, stop() to end. onEnd fires if listening stops by itself.
export function createListener({ provider, onText, onError, onEnd, onState }) {
  if (provider === "elevenlabs") {
    let busy = false;
    const recorder = createRecorder({
      onUtterance: async (blob) => {
        busy = true;
        onState?.("transcribing");
        try {
          const audio = new Uint8Array(await blob.arrayBuffer());
          const { text } = await window.anybot.voice.transcribe(audio, blob.type);
          if (text) await onText(text);
        } catch (error) {
          onError?.(voiceError(error));
        } finally {
          busy = false;
          onState?.("listening");
          recorder.resume();
        }
      },
    });
    return {
      async start() {
        await recorder.start();
        onState?.("listening");
      },
      pause: () => recorder.pause(),
      // The recorder stops itself after each utterance and onUtterance
      // resumes it once the text has been handled.
      resume: () => !busy && recorder.resume(),
      stop: () => recorder.stop(),
    };
  }

  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, stopped = false, paused = false;
  function begin() {
    if (!Speech) throw new Error(SYSTEM_STT_UNAVAILABLE);
    recognition = new Speech();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      const text = [...event.results]
        .slice(event.resultIndex)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript.trim())
        .filter(Boolean)
        .join(" ");
      if (text) onText(text);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      stopped = true;
      onError?.(recognitionError(event.error));
    };
    recognition.onend = () => {
      recognition = null;
      // Chromium ends continuous recognition after a stretch of silence;
      // restart unless we stopped on purpose or are paused for playback.
      if (!stopped && !paused) {
        try {
          begin();
          return;
        } catch {}
      }
      if (stopped) onEnd?.();
    };
    recognition.start();
  }
  return {
    async start() {
      begin();
      onState?.("listening");
    },
    pause() {
      paused = true;
      recognition?.abort?.();
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      if (!recognition) begin();
    },
    stop() {
      stopped = true;
      recognition?.stop();
      if (!recognition) onEnd?.();
    },
  };
}

// Speaker contract: speak(text, employeeId) resolves when playback ends or is
// cancelled. ElevenLabs failures fall back to the system voice once.
export function createSpeaker({ provider, onError }) {
  let audio = null, url = null, finish = null, cancelled = false;

  function system(text) {
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) return Promise.resolve();
    return new Promise((resolve) => {
      const chunks = speechChunks(text);
      finish = resolve;
      let index = 0;
      const next = () => {
        if (cancelled || index >= chunks.length) {
          finish = null;
          resolve();
          return;
        }
        const utterance = new SpeechSynthesisUtterance(chunks[index++]);
        utterance.onend = next;
        utterance.onerror = next;
        synth.speak(utterance);
      };
      next();
    });
  }
  async function cloud(text, employeeId) {
    const { audio: bytes, mime } = await window.anybot.voice.speak(text, employeeId);
    if (cancelled) return;
    url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    audio = new Audio(url);
    await new Promise((resolve) => {
      finish = resolve;
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(resolve);
    });
    URL.revokeObjectURL(url);
    audio = url = finish = null;
  }
  return {
    async speak(text, employeeId) {
      if (!text) return;
      cancelled = false;
      if (provider === "elevenlabs") {
        try {
          await cloud(text, employeeId);
          return;
        } catch (error) {
          if (cancelled) return;
          onError?.(`${voiceError(error)} Using the system voice instead.`);
        }
      }
      await system(text);
    },
    cancel() {
      cancelled = true;
      window.speechSynthesis?.cancel();
      audio?.pause();
      if (url) URL.revokeObjectURL(url);
      finish?.();
      audio = url = finish = null;
    },
  };
}
