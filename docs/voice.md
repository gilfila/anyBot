# Voice in Any Bot

Desktop voice (0.3.40). On the phone, voice doesn't work yet: the Android
app has no microphone permission, and a reply is read out only if it comes
within about 24 seconds. V2 of the always-on team plan
(`docs/plans/always-on-team.md`) fixes both.

## What you get

- **Voice chat** in a bot's own chat, and **Talk to <chief>** in your HQ room
  (the project holding the bot at the top of your org, the same room the
  daily people review writes to; `runtime/hq.mjs`). In HQ the voice chat
  stays in one thread, which opens beside the channel.
- **Dictation**: the mic in the message box adds one spoken turn to your
  draft. Press it again to end the turn early.
- A bar at the top of the window says what is happening ("Listening",
  "Turning that into text", "Atlas is working · 2m", "Atlas is answering"),
  with a level meter while the mic is open. **Stop** or Esc ends it (see
  "When a voice chat ends" below).

How a voice chat goes (`src/lib/voice-session.js`):

1. The mic opens and listens for one whole turn. Short pauses stay inside the
   turn; about 1.3 seconds of quiet ends it (`TURN.hangoverMs`). A turn needs
   300 ms of speech (a click or a cough isn't one) and is cut at 60 seconds.
   The first 300 ms the mic hears learn the room's steady noise (a fan, a
   hum), and the noise level keeps following the room, so steady noise never
   passes for talking for more than a moment (`Segmenter`).
   With **push to talk** on, the mic is open only while you hold Space
   (outside a text field) or the bar's **Hold to talk** button. Built-in
   speech recognition listens by itself, so it has no push to talk.
2. The mic closes, and the turn is turned into text (below). Silence, a turn
   that comes back empty, or one that is only what speech-to-text tends to
   "hear" in noise ("Thank you.", "you", "Bye."; `noiseTranscript`) isn't
   sent; the mic just opens again.
3. The text is sent as one ordinary message from you at the desk (so it has
   your owner lane, like typing it).
4. Any Bot follows that message's work to its end, however long it takes: on
   every change it asks `messages.follow`, plus every 5 seconds. The mic stays
   closed the whole time. A hand-off ("Handed to Nova.") and an approval the
   work is waiting on are said once each.
5. The answer is read out (`runtime/speakable.mjs`): no code blocks, tables,
   HTML or Any Bot's own `anybot` blocks; a web address is "the link" (a
   named link is read by its name) and a file path its file name; markdown
   marks are dropped. After about 600 characters, cut at the end of a
   sentence, it says "The rest is in the chat." Only the first 8,000
   characters of a reply are looked at, so a huge one can't hold the window
   up. Each sentence is its own utterance. A run that failed or was stopped
   says so.
6. Only after the last sentence has been spoken does the mic open again, so a
   bot never hears itself.

## When a voice chat ends

- **Stop** on the bar, or Esc. Esc typed in a text field, or one that closes
  something else first (an HTML preview, the open task, a menu), is left to
  that and the voice chat goes on.
- After 3 minutes of listening with nothing sent, and after 20 turns. It
  says why, out loud and in a note in the window.
- When you close the window to the tray, or minimize it: there is no bar to
  see there, and an open mic would keep sending what the room says.
- When you pull a brake: Stop the team, Pause, or Stop everything.

A turn you started is never cut off by the 3 minutes: it waits for you to
finish, or let go of Space.

## Speech to text (Settings → Voice)

Speech-to-text runs in the main process (`desktop/voice.cjs`); the window
records 16 kHz mono audio with an AudioWorklet (`src/voice/pcm-worklet.js`),
encodes a WAV itself (`encodeWav`) and sends it as `voice.transcribe` (at
most 2 MB and 60 seconds). Nothing is set up by default; pressing Voice chat
or the mic before you choose says where to set it up (and logs
`voice.provider_missing`).

- **On this computer (Windows).** whisper.cpp, offline and private. Press
  **Download** to fetch, into `<userData>/voice/`:
  - the whisper.cpp v1.9.2 Windows build (`whisper-bin-x64.zip`, 8 MB, from
    the project's GitHub release), unpacked with Windows' own `tar.exe`;
  - a model from the whisper.cpp model repository, pinned to one commit:
    **Base (English)**, 148 MB, or **Small (English)**, 488 MB (slower, more
    accurate).

  Every file is checked against the size and SHA-256 pinned in
  `desktop/voice.cjs` while it downloads; a file that doesn't match is
  deleted and never unpacked or run. The download shows progress and can be
  cancelled; **Remove** deletes it all. Each turn runs
  `whisper-cli -m <model> -f <turn.wav> -otxt -of <temp> -nt -np -l en`
  (60-second limit) on a temporary copy, deleted afterwards. It is English
  only. How fast it is on a given PC hasn't been measured.
- **Groq** (`whisper-large-v3-turbo`) or **OpenAI** (`gpt-4o-mini-transcribe`),
  with your own API key: `POST https://api.groq.com/openai/v1/audio/transcriptions`
  or `https://api.openai.com/v1/audio/transcriptions`, multipart `file` +
  `model`, `response_format=json`. The request is made from the main process
  (the window's CSP allows no outside connections). Keys are stored with
  Electron's `safeStorage` (Windows' per-user encryption) in
  `<userData>/voice.json` and are never sent back to the window. Each turn's
  audio goes to that service. Groq bills at least 10 seconds per request.
- **Built-in speech recognition** (the window's `webkitSpeechRecognition`).
  In Any Bot it has always stopped with "network", so it is offered only
  after **Check it** in Settings → Voice finds that it works on this PC.

Settings → Voice also picks which voice reads the replies (the system's
voices, with **Try it**; it is used from the first reply after Any Bot
starts) and turns push to talk on or off; both are kept in `voice.json`.

For the Electron e2e only, `ANYBOT_FAKE_STT` (in a copy run from source,
never a packaged app) answers every turn with that text.

## Privacy and permissions

- Only Any Bot's own page may use the microphone, and only for audio
  (`permissionAllowed` in `desktop/window-shell.cjs`, set for both the
  permission request and check handlers). Bot-made HTML in previews and pages
  in the browser panel can't get the microphone or the camera, and nothing
  can capture the screen. Other permissions keep Electron's default.
- Recordings and transcripts are never stored: the WAV and whisper's text
  file are deleted as soon as the text is back, and one left by a quit or a
  crash in the middle of a turn is deleted when Any Bot next starts. Diagnostics
  (`voice.stt_failed`, `voice.provider_missing`, `voice.download_failed`)
  carry the provider, an HTTP status or exit code and a reason code, never
  words, keys or paths.
- Windows can block microphones for desktop apps (Settings → Privacy &
  security → Microphone); Any Bot says so when that happens.

## Tests

- `tests/voice.test.mjs`: `speakable` (and how fast it is on a huge reply),
  the Segmenter (a pause inside a turn, the 60-second cut, a click, steady
  room noise), `encodeWav`, the follow reducer, `messages.follow` across a
  fake five-minute run, the half-duplex session and its limits (3 quiet
  minutes, 20 turns, noise transcripts), push to talk pressed again while the
  mic starts (`src/lib/voice-io.js` with a fake microphone), Esc and the
  brakes, `desktop/voice.cjs` (keys, providers, the pinned-hash download,
  whisper's arguments, WAV checks, diagnostics, leftover recordings) and the
  microphone permission rule. `tests/desktop-ipc.test.mjs` runs main's own
  `voiceRequest` with a stand-in.
- `tests/electron-threads.cjs` (`npm run test:e2e`): the built renderer with
  Chromium's fake microphone playing a WAV on a loop. One spoken turn with a
  pause in it is one recording and one message; the reply of a 26-second run
  (past the old 24-second wait) is read without markdown; the mic is closed
  while the bot works and talks, and nothing is sent again meanwhile. Esc in
  the message box leaves the voice chat on, Esc ends it, and hiding the
  window (main's rule, `stopVoiceWhenHidden`) ends a voice chat that has
  just started.
- Not tested by hand yet: a real microphone and real speech on Tony's PC, the
  real whisper.cpp download and its speed, and a real Groq or OpenAI key.
