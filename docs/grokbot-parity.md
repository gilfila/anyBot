# anyBot vs Grok Bot: feature gap review and voice plan

Reviewed 2026-09-23 against anyBot 0.2.26 (`main` @ 60d6070) and public Grok Bot
material (xAI launched it 2026-08-11). x.ai itself is blocked from the review
environment, so Grok Bot details come from third-party reviews and search results
(Vellum, MacRumors, Composio, The Rundown, docs.x.ai excerpts). Check against
docs.x.ai before building anything that depends on an exact Grok Bot behaviour.

## Where anyBot already matches or beats Grok Bot

| Area | anyBot | Grok Bot |
| --- | --- | --- |
| Model choice | Claude Code, Codex, Gemini, Hermes, Cursor, custom CLIs, per-employee model | xAI models only |
| Self-hosting | Desktop plus headless VPS server, owner-held data | xAI-managed cloud only |
| Named teammates, group chats, delegation | Yes. Structured, bounded delegation through the coordinator | Yes. 2–6 bots per group chat, @-mention to add one mid-thread |
| Per-bot isolation | Separate workspace per employee (not an OS sandbox) | Every bot shares one cloud computer, including cookies, files and credentials |
| Artifacts | Content-addressed capture, safe previews, deliverables panel | Files on the shared computer |
| Cost | Uses subscriptions you already pay for | SuperGrok from $30 a month, up to $300 a month for Heavy |
| Live voice | Early version exists (see below) | **No live voice mode, dictation only.** This is a chance to be ahead, not a gap |

## Where anyBot falls short (ranked by impact on the "AI teammates" experience)

| # | Gap | Grok Bot | anyBot today | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Approvals** | Allow once, Deny or Always allow per action, plus Auto Review rules. Works from phone | `permissionMode` ask/dontAsk only. In headless `-p` mode, "ask" silently **denies** any tool that needs permission. There is no approval prompt in the UI | L |
| 2 | **Always-on execution** | Cloud VM keeps working with the laptop closed | Only while the desktop (or VPS) runtime is up. The VPS path exists, but setup is manual | M (docs and a one-click VPS image) |
| 3 | **Computer and browser use** | A real browser on the bot's computer that you can watch and **take over** for 2FA, CAPTCHA and payments. Logins persist | Rail "browser" is an iframe viewer. There is no agent-driven browser and no takeover. Relies on whatever the harness has (e.g. Playwright MCP) | XL |
| 4 | **Connectors / MCP** | Gmail, Slack, GitHub and MCP tools, authorised once and shared by the whole team | Harness-native only. There is no connector UI, and MCP config lives in each CLI's own settings | M (UI that writes per-harness MCP config) to L (credential broker) |
| 5 | **Memory** | Automatic per-bot memory plus team-wide shared memory | None. Continuity is only the conversation slice replayed into each prompt. No native session resume | M |
| 6 | **Routines** | Schedules **and event triggers**, plus "follow along / teach a task" recording that becomes a skill | Fixed intervals only (5 min to 7 days). No calendar/cron, no event triggers, no recording | S (cron), M (webhook/file/email triggers), XL (recording) |
| 7 | **Notifications** | Push on mobile, and bots "only come back when they need you" | No OS notifications on desktop. Mobile push is not release-complete. Unread dots only | S (desktop `Notification`), M (mobile push) |
| 8 | **Mobile parity** | Native iOS and Android store apps with approvals, routines and connectors | Capacitor companion: Android debug APK, iOS unsigned, no push, no approvals | L |
| 9 | **Live progress / steering** | Watch the bot's screen live, send follow-ups mid-task | Streams text output. No mid-run steering (a new message queues behind the run) | M |
| 10 | **File intake** | Drop files into a chat | No upload or drag-drop in the composer. Files only flow in from prior artifacts | S |
| 11 | **Bot profiles / templates** | Shareable bot profiles and team templates (community "awesome-grokbot") | Employee form only. No import/export or templates | S |
| 12 | **Onboarding** | Sign in and go | Must install and authenticate each CLI first. The Harnesses view helps but doesn't install anything | M |

Suggested order: **7 → 10 → 6 (cron) → 1 → 5 → 4 → 9 → 2 → 8 → 3**. The first
three are small wins that make the product feel alive. Approvals (1) is the biggest
functional gap because "ask" mode currently fails silently.

## Voice: current state and why it doesn't work

Code: `src/App.jsx` (`startDictation`, `startVoiceChat`) and `mobile/main.jsx`,
covered by `tests/mobile.e2e.spec.mjs` with a mocked `SpeechRecognition`.

1. **Speech recognition is dead on desktop.** Electron exposes
   `webkitSpeechRecognition`, but Chromium's implementation streams audio to a
   Google service that needs Google's own API keys. In Electron it fails with
   `onerror: "network"`, so Dictate and Voice chat both stop immediately. The
   Capacitor Android and iOS WebViews don't provide a working implementation
   either. The mocked Playwright test hides this.
2. **The reply wait gives up after 24 s.** The code polls `snapshot` 30 times at
   800 ms intervals, but a harness run usually takes 20 s to several minutes.
   Longer replies are never spoken.
3. **Echo loop.** Recognition is `continuous` and keeps listening while
   `speechSynthesis` talks, so the bot can hear itself and send its own reply
   back as a new task.
4. **It reads raw markdown aloud**, including code blocks, tables and
   `anybot-artifacts` JSON. Chromium also cuts off long utterances (around 15 s
   on some voices).
5. **UI state gets out of sync.** When recognition ends (silence or error),
   `dictating` resets but `voiceAgent` stays set, so the button still says
   "Stop voice chat" while nothing is listening.
6. **It's slow by design.** Every spoken turn starts a full CLI agent run with
   no acknowledgement, so you hear nothing for 30 s or more.
7. There is no mic permission handler (Electron allows everything by default)
   and no voice settings (voice, rate, language, push-to-talk).

What already works: `speechSynthesis` on Windows uses local SAPI voices offline,
so text-to-speech on desktop is fine. Recognition is the part that's broken.

## Voice agent plan

Design principle: split **talking** from **working**. A fast voice layer handles
the conversation, and employees keep doing the slow harness runs. The voice
layer acknowledges straight away, dispatches work, and speaks a short summary
when a run finishes.

```
mic → VAD → STT ──► Voice session (coordinator) ──► messages.send → employee run
                         │  ▲                                   │
                         │  └──── run.completed event ◄─────────┘
                         ▼
                 speakable summary → TTS → speaker   (mic muted while speaking; barge-in stops TTS)
```

### Phase 0: make today's feature honest and usable (1 PR, S)
- Detect the `network` / `not-allowed` / `service-not-allowed` errors and show
  "Speech recognition isn't available in this build. Voice setup is coming",
  not a generic failure.
- Stop recognition while speaking and resume on `utterance.onend`. This fixes
  the echo.
- Replace the 24 s poll with waiting on `onChanged` until the run for that
  `requestId` reaches a terminal state, however long it takes. Speak "On it"
  immediately and a short "still working" cue about every 30 s.
- Add `toSpeech(markdown)` in `src/lib/`: drop code, tables and artifact
  blocks, strip markup, cap at around 2–3 sentences with "details are in the
  chat", and split into sentence-sized utterances. Unit test it like
  `markdown.js`.
- Keep `voiceAgent` and `dictating` in sync in `onend`.
- Add `session.setPermissionRequestHandler` in `main.cjs` that allows only
  `media` with audio from the app origin.

### Phase 1: real speech-to-text that works everywhere (M)
- **Desktop (default, local-first):** capture audio with
  `getUserMedia` + `AudioWorklet` at 16 kHz mono PCM, detect speech with Silero
  VAD (ONNX, small), then transcribe with **whisper.cpp** as a sidecar binary
  (`base.en` or `small.en`, downloaded on first use with a SHA-256 check, like
  the updater). Run it from main or a utility process, **not** the renderer, so
  the CSP stays strict. Only add `'wasm-unsafe-eval'` if we choose in-renderer
  WASM instead.
- **Optional cloud STT** (faster and more accurate): OpenAI `gpt-4o-transcribe`,
  Deepgram or ElevenLabs Scribe. API keys go in Electron `safeStorage`, never in
  SQLite or the renderer.
- **Mobile:** use a Capacitor native plugin
  (`@capacitor-community/speech-recognition`, which uses Android
  SpeechRecognizer and iOS SFSpeechRecognizer) behind the same `SpeechProvider`
  interface.
- Add a `SpeechProvider` interface (`start`, `stop`, `onPartial`, `onFinal`)
  so Flow/chatty can plug in later, as `docs/voice.md` already anticipates.
- Add push-to-talk as a global shortcut (e.g. Ctrl+Space) alongside hands-free
  VAD mode.

### Phase 2: the voice agent itself (L)
- Add a **voice session** in the coordinator: a small, fast "front desk" model
  with tools `assign(employee, task)`, `status()`, `latest_reply(employee)`,
  `cancel(run)` and `list_team()`. It answers simple things itself ("who's
  working on what?") and hands real work to employees. It works in **group
  conversations** too, as one voice speaking for the team, which removes the
  "bots talking over each other" limitation.
- Model options: Claude Haiku 4.5 through the API (text in, text out, then
  TTS), or a speech-to-speech realtime model (OpenAI Realtime / Gemini Live)
  for the lowest latency. This needs an API key. There's no local-only path at
  real-time quality today, so a local fallback stays Phase 0/1 behaviour.
- Speak unprompted when a run completes or a bot needs you, with a
  "do not disturb" toggle.
- Better TTS: keep SAPI as the free default, with optional Piper (local neural)
  or ElevenLabs/OpenAI TTS. Each employee can have its own voice.
- Barge-in: VAD during playback cancels TTS.

### Phase 3: nice-to-have (M–L)
- A mobile "call your team" screen that uses the Phase 2 session over the
  gateway (audio streamed over the existing TLS WebSocket, contributor role
  required).
- Voice approvals, once approvals (gap 1) exist. These need an on-screen
  confirm, never voice alone.
- Wake word ("Hey anyBot") with openWakeWord, off by default.

### Tests
- Unit tests: `toSpeech`, and the voice-session tool dispatch against the
  simulated harness used in `tests/`.
- Playwright: mock the `SpeechProvider`, not `window.SpeechRecognition`, so the
  test exercises the real code path.
- Runtime smoke: whisper sidecar on a bundled 3 s WAV fixture, asserting the
  transcript.
- Manual: a real Windows install with the mic on, plus a real Android device.
