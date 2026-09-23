// Local (on-phone) voice for the native Capacitor app: the platform speech
// recognizer and text-to-speech engine. Android and iOS WebViews don't provide
// SpeechRecognition, so the installed app needs these plugins. The listener
// matches the contract of createListener in src/lib/voice.js.
import { Capacitor } from "@capacitor/core";
import { SpeechRecognition } from "@capgo/capacitor-speech-recognition";
import { TextToSpeech } from "@capacitor-community/text-to-speech";

export const nativeVoiceAvailable = () => Capacitor.isNativePlatform();
const language = () => navigator.language || "en-US";

export function createNativeListener({ onText, onError, onEnd, onState, silenceMs = 1400 }) {
  let stopped = false, paused = false, running = false, latest = "", timer = null;
  const handles = [];

  async function begin() {
    if (stopped || paused || running) return;
    running = true;
    latest = "";
    try {
      await SpeechRecognition.start({ language: language(), maxResults: 1, partialResults: true, popup: false });
    } catch (error) {
      running = false;
      // Android reports "no match" when nobody spoke; just listen again.
      if (/no match|no speech|didn't catch|7$/i.test(String(error?.message || error))) {
        setTimeout(begin, 250);
        return;
      }
      stopped = true;
      onError?.(`Listening stopped: ${error?.message || error}`);
      onEnd?.();
    }
  }
  // iOS keeps listening through silence, so end the utterance ourselves once
  // the partial transcript stops changing.
  async function finish() {
    clearTimeout(timer);
    const text = latest.trim();
    latest = "";
    if (running) {
      running = false;
      try {
        await SpeechRecognition.stop();
      } catch {}
    }
    if (stopped) return;
    if (text && !paused) await onText(text);
    if (!stopped && !paused) begin();
  }

  return {
    async start() {
      const { available } = await SpeechRecognition.available();
      if (!available) throw new Error("Speech recognition isn't available on this phone.");
      let permission = await SpeechRecognition.checkPermissions();
      if (permission.speechRecognition !== "granted") permission = await SpeechRecognition.requestPermissions();
      if (permission.speechRecognition !== "granted")
        throw new Error("Allow microphone and speech recognition for anyBot in your phone's settings.");
      handles.push(
        await SpeechRecognition.addListener("partialResults", (event) => {
          const text = event.accumulatedText || event.matches?.[0] || "";
          if (!text || paused) return;
          latest = text;
          clearTimeout(timer);
          timer = setTimeout(finish, silenceMs);
        }),
        await SpeechRecognition.addListener("listeningState", (event) => {
          const state = event.state || event.status;
          if (state === "stopped" && running) finish();
        }),
      );
      await begin();
      onState?.("listening");
    },
    pause() {
      paused = true;
      clearTimeout(timer);
      latest = "";
      if (running) {
        running = false;
        SpeechRecognition.stop().catch(() => {});
      }
    },
    resume() {
      if (stopped) return;
      paused = false;
      begin();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      running = false;
      SpeechRecognition.stop().catch(() => {});
      for (const handle of handles.splice(0)) handle.remove().catch?.(() => {});
      onEnd?.();
    },
  };
}

// Passed to createSpeaker as `local`.
export const nativeSpeech = {
  speak: (text) => TextToSpeech.speak({ text, lang: language(), rate: 1.0 }),
  stop: () => TextToSpeech.stop().catch(() => {}),
};
