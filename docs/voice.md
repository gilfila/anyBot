# Voice in anyBot

Voice is local by default, with an optional cloud connection. The owner chose
that direction on 2026-09-23 (see `docs/grokbot-parity.md` for the plan).

## What ships today (0.2.27)

- **Dictate** (mic button in the composer) adds speech to the current message.
- **Voice chat** (one-to-one conversations) listens for an assignment, sends it,
  says "On it.", waits for the run to finish however long it takes, and speaks
  a short summary of the reply (`toSpeech` in `src/lib/speech.js`). The
  microphone is paused while the bot works and speaks, so it never hears itself.
- **Settings → Voice** picks the providers:

| | Local (default) | ElevenLabs (optional) |
| --- | --- | --- |
| Listening | Chromium `SpeechRecognition`. **Doesn't work in the Electron desktop app**: it returns `network` because it needs Google's API keys. Works in mobile Chrome | Scribe `scribe_v1` via `POST /v1/speech-to-text` |
| Speaking | System voices (`speechSynthesis`, SAPI on Windows), offline | `POST /v1/text-to-speech/{voice}`, model Flash v2.5 or Multilingual v2, mp3 |

With ElevenLabs connected, the renderer records with `MediaRecorder` and an
energy-based voice-activity detector (`src/lib/voice.js`). Each utterance
(webm/opus) goes to the main process, which calls Scribe.

## Security model

- The ElevenLabs key is entered once in Settings and sent to the main process
  over `anybot:voice` (`voice.setKey`). It is checked against `/v1/voices`,
  encrypted with Electron `safeStorage` (DPAPI on Windows) and stored in
  `voice.json` in the user-data directory with mode 0600. It is never returned
  to the renderer; `voice.settings` only reports `configured: true`. If secure
  storage is unavailable, the key is refused instead of being saved in clear
  text.
- All ElevenLabs calls happen in `desktop/voice.cjs`. The renderer CSP is
  unchanged except for `media-src 'self' blob:`, which is needed to play the
  returned mp3.
- `session.setPermissionRequestHandler` allows only the app page (main frame,
  `dist/index.html`) to use the microphone, audio only. Remote pages in the rail
  browser can no longer use the mic or camera.
- Audio is not persisted. Recordings are held in memory, sent to ElevenLabs
  only when that provider is selected, then discarded.

## Next

1. **Local transcription**: a whisper.cpp sidecar (`base.en` / `small.en`,
   downloaded on first use with a checksum), so listening works offline with
   no key. The same `createListener` contract applies.
2. **Local natural voices**: Piper as a middle option between system voices
   and ElevenLabs.
3. **The voice receptionist (option B)**: a fast model in the coordinator that
   talks back immediately and hands work to employees through tools.
   Claude Haiku 4.5 needs an API key; a local model via Ollama is the fallback.
   It also enables voice in group conversations.
4. **Mobile**: native speech recognition through a Capacitor plugin, because
   Android and iOS WebViews don't provide `SpeechRecognition`.

The companion Flow project (`chatty`) can plug in later behind the same
listener contract once it has a signed bridge.
