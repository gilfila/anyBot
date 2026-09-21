# Voice in anyBot

The desktop composer has two voice paths:

- **Dictate** adds microphone speech to the current message. It uses the
  Chromium speech-recognition API when the installed desktop runtime exposes
  it, and keeps the result in the composer until the owner sends it.
- **Voice chat** is available in one-to-one conversations. It listens for an
  assignment, sends it to the selected employee, and speaks the returned
  response with the local speech-synthesis engine. Group conversations stay
  text-first so several agents do not talk over one another.

The controls are intentionally local UI capabilities. Microphone permission is
requested by the renderer only when the owner presses Dictate or Voice chat;
audio is not persisted by anyBot.

The companion Flow project (`chatty`) is the intended future native dictation
provider. Its Windows client is currently a validation prototype without a
released executable or stable IPC contract, so this build does not pretend that
Flow is installed or silently launch its source tree. When a signed Flow
bridge exists, it can replace the speech-recognition provider behind the same
composer contract without changing conversations or harness execution.
