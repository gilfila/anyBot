import React, { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { createSpeaker, voiceError } from "../lib/voice.js";

const MODELS = [
  { id: "eleven_flash_v2_5", label: "Flash v2.5 (fastest)" },
  { id: "eleven_multilingual_v2", label: "Multilingual v2 (most natural)" },
];

export function VoiceSettings({ settings, employees, onChange }) {
  const [voices, setVoices] = useState([]),
    [key, setKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const connected = Boolean(settings?.elevenlabs?.configured);

  useEffect(() => {
    if (!connected) {
      setVoices([]);
      return;
    }
    window.anybot.voice.voices().then(setVoices, (e) => setError(voiceError(e)));
  }, [connected]);

  async function run(action) {
    setError("");
    setBusy(true);
    try {
      return await action();
    } catch (e) {
      setError(voiceError(e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  const save = (patch) => run(async () => onChange(await window.anybot.voice.save(patch)));
  const preview = (employee) =>
    run(() =>
      createSpeaker({ provider: settings.tts, onError: setError }).speak(
        `Hi, I'm ${employee?.name || "your team"}. This is how I'll sound.`,
        employee?.id,
      ),
    );

  if (!window.anybot?.voice || !settings) return null;
  return (
    <div className="settings-card voice-settings">
      <div>
        <h3>Voice</h3>
        <p>
          Voice chat and dictation use this computer's speech engine by default.
          Connect ElevenLabs for accurate transcription and natural voices; the
          key is encrypted on this computer and only used for ElevenLabs
          requests. A fully local transcription option (Whisper) is coming.
        </p>
        {error && <p role="alert" className="banner error">{error}</p>}
        {!connected ? (
          <div className="voice-key">
            <label>
              ElevenLabs API key
              <input
                type="password"
                autoComplete="off"
                value={key}
                placeholder="sk_…"
                onChange={(e) => setKey(e.target.value)}
              />
              <span className="field-hint">
                Create one at elevenlabs.io → Developers → API keys. It needs
                text to speech, speech to text and voices (read) access.
              </span>
            </label>
            {!settings.elevenlabs.encryptionAvailable && (
              <p className="field-hint">Secure storage is unavailable on this computer, so a key can't be saved.</p>
            )}
            <button
              className="primary"
              disabled={busy || !key.trim() || !settings.elevenlabs.encryptionAvailable}
              onClick={() =>
                run(async () => {
                  const result = await window.anybot.voice.setKey(key.trim());
                  setKey("");
                  setVoices(result.voices);
                  onChange(result.settings);
                })
              }
            >
              {busy ? "Checking…" : "Connect ElevenLabs"}
            </button>
          </div>
        ) : (
          <div className="voice-grid">
            <label>
              Listening
              <select value={settings.stt} disabled={busy} onChange={(e) => save({ stt: e.target.value })}>
                <option value="elevenlabs">ElevenLabs Scribe</option>
                <option value="system">System speech recognition</option>
              </select>
            </label>
            <label>
              Speaking
              <select value={settings.tts} disabled={busy} onChange={(e) => save({ tts: e.target.value })}>
                <option value="elevenlabs">ElevenLabs voices</option>
                <option value="system">System voices (offline)</option>
              </select>
            </label>
            <label>
              Voice model
              <select value={settings.model} disabled={busy || settings.tts !== "elevenlabs"} onChange={(e) => save({ model: e.target.value })}>
                {MODELS.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
            </label>
            <label>
              Default voice
              <select value={settings.voiceId} disabled={busy || settings.tts !== "elevenlabs"} onChange={(e) => save({ voiceId: e.target.value })}>
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>{voice.name}</option>
                ))}
              </select>
            </label>
            {settings.tts === "elevenlabs" && employees.length > 0 && (
              <div className="voice-bots">
                <strong>Bot voices</strong>
                {employees.map((employee) => (
                  <div key={employee.id} className="voice-bot">
                    <span>{employee.name}</span>
                    <select
                      aria-label={`Voice for ${employee.name}`}
                      value={settings.employeeVoices[employee.id] || ""}
                      disabled={busy}
                      onChange={(e) =>
                        save({ employeeVoices: { ...settings.employeeVoices, [employee.id]: e.target.value } })
                      }
                    >
                      <option value="">Default voice</option>
                      {voices.map((voice) => (
                        <option key={voice.id} value={voice.id}>{voice.name}</option>
                      ))}
                    </select>
                    <button
                      className="secondary voice-preview"
                      title={`Preview ${employee.name}'s voice`}
                      aria-label={`Preview ${employee.name}'s voice`}
                      disabled={busy}
                      onClick={() => preview(employee)}
                    >
                      <Volume2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {connected && (
        <div className="settings-actions">
          <button className="secondary" disabled={busy} onClick={() => preview(null)}>
            <Volume2 size={15} />
            Test voice
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => run(async () => onChange(await window.anybot.voice.clearKey()))}
          >
            Disconnect ElevenLabs
          </button>
        </div>
      )}
    </div>
  );
}
