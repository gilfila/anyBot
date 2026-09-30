import React, { useEffect, useRef, useState } from "react";
import { AudioLines, Check, Download, KeyRound, Trash2, Volume2, X } from "lucide-react";
import { probeWebSpeech, speakSentences } from "../lib/useVoice.js";
import "./voice.css";

// Settings → Voice: how voice chat and dictation turn speech into text
// (desktop/voice.cjs), the voice replies are read in, and push-to-talk.
// Nothing downloads until the owner presses Download; keys never come back
// from main once saved.
const clean = (message) => String(message || "").replace(/^Error invoking remote method '[^']+': Error: /, "");
const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;
const PROVIDERS = [
  { id: "whisper-local", title: "On this computer", note: "whisper.cpp. Private and offline; your voice never leaves this PC." },
  { id: "groq", title: "Groq", note: "Your Groq API key. Fast; each turn's audio is sent to Groq." },
  { id: "openai", title: "OpenAI", note: "Your OpenAI API key. Each turn's audio is sent to OpenAI." },
  { id: "webspeech", title: "Built-in speech recognition", note: "The window's own recognizer, if it works here." },
];

function useVoices() {
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return undefined;
    const load = () => setVoices(synth.getVoices().map((v) => ({ name: v.name, lang: v.lang, local: v.localService })));
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, []);
  return voices;
}

export function VoicePanel() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState({ groq: "", openai: "" });
  const [picked, setModel] = useState(null);
  const [probing, setProbing] = useState(false);
  const [probeFailed, setProbeFailed] = useState(false);
  const voices = useVoices();
  const live = useRef(true);
  const call = async (method, payload) => {
    setBusy(true);
    try {
      const next = await window.anybot.request(method, payload);
      if (live.current) {
        setStatus(next);
        setError("");
      }
      return next;
    } catch (e) {
      if (live.current) setError(clean(e.message));
      return null;
    } finally {
      if (live.current) setBusy(false);
    }
  };
  useEffect(() => {
    live.current = true;
    window.anybot
      ?.request("voice.status")
      .then((next) => live.current && setStatus(next))
      .catch((e) => live.current && setError(clean(e.message)));
    return () => {
      live.current = false;
    };
  }, []);
  const downloading = status?.local?.download?.state === "downloading";
  // Progress while downloading.
  useEffect(() => {
    if (!downloading) return undefined;
    const timer = setInterval(() => {
      window.anybot
        .request("voice.status")
        .then((next) => live.current && setStatus(next))
        .catch(() => {});
    }, 500);
    return () => clearInterval(timer);
  }, [downloading]);

  if (!status)
    return (
      <div className="settings-card voice-card">
        <div className="voice-icon" aria-hidden="true">
          <AudioLines size={20} />
        </div>
        <div>
          <h3>Voice</h3>
          <p>{error ? `Voice settings didn't load: ${error}` : "Loading…"}</p>
        </div>
      </div>
    );

  const { local } = status;
  const model = picked ?? local.model;
  const download = local.download || {};
  const installedModels = Object.entries(local.models).filter(([, m]) => m.installed);
  const needed = (id) => (local.installed ? 0 : local.programSize) + (local.models[id]?.installed ? 0 : local.models[id]?.size || 0);
  const choose = (id) => call("voice.setProvider", { provider: id });
  const saveKey = async (provider) => {
    const next = await call("voice.setKey", { provider, key: keys[provider] });
    if (next) setKeys((k) => ({ ...k, [provider]: "" }));
  };
  const probe = async () => {
    setProbing(true);
    setProbeFailed(false);
    const ok = await probeWebSpeech();
    setProbing(false);
    setProbeFailed(!ok);
    await call("voice.set", { webspeech: ok });
  };

  return (
    <div className="settings-card voice-card">
      <div className="voice-icon" aria-hidden="true">
        <AudioLines size={20} />
      </div>
      <div className="voice-body">
        <h3>Voice</h3>
        <p>
          Talk to a bot with <strong>Voice chat</strong> in its chat (or <strong>Talk to</strong> your chief in HQ), and dictate
          with the mic in the message box. A whole spoken turn becomes one message, Any Bot waits for the real answer however
          long the work takes, and reads it back without the markdown. The mic stays off while the bot works and talks.
        </p>
        <p className={status.ready ? "voice-state is-ready" : "voice-state"} role="status">
          {status.ready
            ? `Ready: ${status.provider === "fake" ? "test speech-to-text" : PROVIDERS.find((p) => p.id === status.provider)?.title}.`
            : // This is Settings → Voice already.
              status.reason.replace(/ in Settings → Voice/g, "")}
        </p>

        <fieldset className="voice-providers" disabled={busy}>
          <legend>Speech to text</legend>
          {PROVIDERS.filter((p) => p.id !== "webspeech" || status.webspeech || status.chosen === "webspeech").map((p) => (
            <label key={p.id} className={status.provider === p.id ? "voice-provider is-chosen" : "voice-provider"}>
              <input type="radio" name="voice-provider" checked={status.provider === p.id} onChange={() => choose(p.id)} />
              <span>
                <strong>{p.title}</strong>
                <small>{p.note}</small>
              </span>
            </label>
          ))}
        </fieldset>

        {status.provider === "whisper-local" || (!status.chosen && !local.installed) ? (
          <div className="voice-section">
            {!local.supported ? (
              <p className="voice-note">Speech-to-text on this computer is available on Windows. Use Groq or OpenAI here.</p>
            ) : downloading ? (
              <div className="voice-download">
                <progress max={download.total || 1} value={download.received || 0} aria-label="Download progress" />
                <span>
                  {download.step === "program" ? "Downloading whisper.cpp" : "Downloading the speech model"} ·{" "}
                  {mb(download.received || 0)} of {mb(download.total || 0)}
                </span>
                <button type="button" className="secondary" onClick={() => call("voice.cancelDownload")}>
                  <X size={14} />
                  Cancel
                </button>
              </div>
            ) : (
              <>
                {local.installed && installedModels.length ? (
                  <p className="voice-note">
                    <Check size={14} /> Installed: whisper.cpp {local.version}, {installedModels.map(([, m]) => m.label).join(" and ")}.
                  </p>
                ) : (
                  <p className="voice-note">
                    Downloads whisper.cpp {local.version} and a speech model from their official pages, checks each file against
                    its known fingerprint, and keeps them in Any Bot's data folder. Nothing downloads until you press Download.
                  </p>
                )}
                {download.state === "failed" && (
                  <p className="voice-error" role="alert">
                    {download.error}
                  </p>
                )}
                <div className="voice-row">
                  <label className="voice-select">
                    <span>Model</span>
                    <select value={model} onChange={(event) => setModel(event.target.value)}>
                      {Object.entries(local.models).map(([id, m]) => (
                        <option key={id} value={id}>
                          {m.label} ({mb(m.size)}){m.installed ? ", installed" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {local.models[model]?.installed && local.installed ? (
                    local.model !== model && (
                      <button type="button" className="secondary" onClick={() => call("voice.set", { model })}>
                        Use this model
                      </button>
                    )
                  ) : (
                    <button type="button" className="secondary" disabled={!local.supported} onClick={() => call("voice.download", { model })}>
                      <Download size={14} />
                      Download ({mb(needed(model))})
                    </button>
                  )}
                  {local.installed && (
                    <button type="button" className="secondary" onClick={() => call("voice.remove")}>
                      <Trash2 size={14} />
                      Remove
                    </button>
                  )}
                </div>
                {local.installed && local.model && <small className="voice-note">In use: {local.models[local.model]?.label}.</small>}
              </>
            )}
          </div>
        ) : null}

        {["groq", "openai"].includes(status.provider) && (
          <form
            className="voice-section voice-row"
            onSubmit={(event) => {
              event.preventDefault();
              saveKey(status.provider);
            }}
          >
            <label className="voice-key">
              <span>
                <KeyRound size={13} /> {status.provider === "groq" ? "Groq" : "OpenAI"} API key
                {status.keys[status.provider] ? " (saved)" : ""}
              </span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={status.keys[status.provider] ? "Saved. Paste a new key to replace it." : "Paste your key"}
                value={keys[status.provider]}
                onChange={(event) => setKeys((k) => ({ ...k, [status.provider]: event.target.value }))}
              />
            </label>
            <button type="submit" className="secondary" disabled={busy || !keys[status.provider].trim()}>
              Save key
            </button>
            {status.keys[status.provider] && (
              <button type="button" className="secondary" onClick={() => call("voice.setKey", { provider: status.provider, key: "" })}>
                Remove key
              </button>
            )}
            <small className="voice-note">Kept encrypted with your Windows account; Any Bot never shows it again.</small>
          </form>
        )}

        {!status.webspeech && status.chosen !== "webspeech" && (
          <p className="voice-note">
            Built-in speech recognition usually doesn't work in Any Bot.{" "}
            <button type="button" className="mini" disabled={probing} onClick={probe}>
              {probing ? "Checking… say something" : "Check it"}
            </button>
            {probeFailed && " It didn't work here."}
          </p>
        )}

        <div className="voice-row voice-section">
          <label className="voice-select">
            <span>
              <Volume2 size={13} /> Voice for replies
            </span>
            <select value={status.voice} onChange={(event) => call("voice.set", { voice: event.target.value })}>
              <option value="">The system's default</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                  {v.local ? "" : " (online)"}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary" onClick={() => speakSentences(["This is how your bots will sound."], status.voice)}>
            Try it
          </button>
        </div>
        {error && (
          <p className="voice-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="voice-ptt">
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={status.pushToTalk}
          aria-label="Push to talk"
          disabled={busy}
          onClick={() => call("voice.set", { pushToTalk: !status.pushToTalk })}
        />
        <small>Push to talk: hold Space instead of pausing</small>
      </div>
    </div>
  );
}
