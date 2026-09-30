import React, { useEffect, useState } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import { workingLabel } from "../lib/voice.js";
import "./voice.css";

// The voice chat or dictation in progress (src/lib/useVoice.js): what it is
// doing, a level meter while the mic is open, and Stop (or Esc). With
// push-to-talk, holding the button talks, like holding Space.
export function voiceLabel(state, { pushToTalk = false, now = Date.now() } = {}) {
  const bot = state.bot || "Your bot";
  if (state.mode === "dictate")
    return state.phase === "transcribing" ? "Writing it down…" : "Dictating. Pause when you're done, or press the mic again.";
  switch (state.phase) {
    case "listening":
      return pushToTalk ? `Hold Space (or the button) and talk to ${bot}.` : `Listening. Talk to ${bot}, then pause.`;
    case "holding":
      return "Listening. Let go to send.";
    case "transcribing":
      return "Turning that into text…";
    case "sending":
      return `Sending to ${bot}…`;
    case "working":
      return workingLabel(bot, state.since || now, now);
    case "speaking":
      return `${bot} is answering.`;
    default:
      return "";
  }
}

export function VoiceBar({ state, pushToTalk, onStop, onPress, onRelease }) {
  const [now, setNow] = useState(Date.now());
  const working = state.phase === "working";
  useEffect(() => {
    if (!working) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);
  if (state.mode === "off") return null;
  const listening = state.phase === "listening" || state.phase === "holding";
  const meter = listening ? Math.min(1, (state.level || 0) * 8) : 0;
  const talk = state.mode === "chat" && pushToTalk && listening;
  return (
    <div className={`voice-bar is-${state.phase}`} role="region" aria-label={state.mode === "dictate" ? "Dictation" : "Voice chat"}>
      <span className="voice-bar-icon" aria-hidden="true">
        {state.phase === "speaking" ? <Volume2 size={16} /> : <Mic size={16} />}
      </span>
      <span className="voice-bar-label" aria-live="polite">
        {voiceLabel(state, { pushToTalk, now })}
      </span>
      {listening && (
        <span className="voice-meter" aria-hidden="true">
          <span style={{ transform: `scaleX(${meter.toFixed(3)})` }} />
        </span>
      )}
      {talk && (
        <button
          type="button"
          className={state.phase === "holding" ? "secondary voice-hold is-held" : "secondary voice-hold"}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            onPress();
          }}
          onPointerUp={onRelease}
          onPointerCancel={onRelease}
        >
          <Mic size={14} />
          Hold to talk
        </button>
      )}
      <button type="button" className="secondary voice-stop" onClick={onStop} title="Stop (Esc)">
        <Square size={13} />
        Stop
      </button>
    </div>
  );
}
