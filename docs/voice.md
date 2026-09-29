# Voice in anyBot

The desktop composer has two voice paths:

- **Dictate** adds microphone speech to the current message. It uses the
  Chromium speech-recognition API when the installed desktop runtime exposes
  it, and keeps the result in the composer until the owner sends it.
- **Voice chat** is available in one-to-one conversations. It listens, sends
  what it heard to the conversation's employee, and speaks the reply with the
  local speech-synthesis engine. Group conversations stay text-first so
  several agents do not talk over one another.

Both are experimental. What they really do today (`startDictation` and
`startVoiceChat` in `src/App.jsx`):

- **Speech recognition depends on the runtime.** If the Electron build has no
  speech-recognition API, Dictate and Voice chat show "Dictation is
  unavailable in this build". If the API exists but can't reach its speech
  service, recognition stops with an error such as "Dictation stopped:
  network". Whether the packaged app's runtime has a working recognizer
  hasn't been verified.
- **Every pause sends a message.** Recognition is continuous, so each phrase
  it finalizes is sent on its own and starts its own run.
- **Only quick replies are read aloud.** After sending, voice chat checks for
  the employee's reply every 0.8 seconds, 30 times (about 24 seconds). A reply
  that arrives later still shows in the chat but is never spoken, and nothing
  says so. A bot's reply is only written when its run finishes, so a Claude
  Code or Codex reply often takes longer than that.
- **The reply is read as written,** markdown included. If the bot delegates,
  the first reply it posts is the one read, not the result that comes back
  later.
- Listening keeps going while the reply is spoken, and the button keeps
  saying **Stop voice chat** after listening ends; press it to stop both.

The controls are intentionally local UI capabilities. Microphone permission is
requested by the renderer only when the owner presses Dictate or Voice chat;
audio is not persisted by anyBot.

The companion Flow project (`chatty`) is the intended future native dictation
provider. Its Windows client is currently a validation prototype without a
released executable or stable IPC contract, so this build does not pretend that
Flow is installed or silently launch its source tree. When a signed Flow
bridge exists, it can replace the speech-recognition provider behind the same
composer contract without changing conversations or harness execution.
