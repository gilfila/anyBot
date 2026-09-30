// One voice session: a voice chat with a bot, or one dictated turn.
// Half-duplex turn-taking (tests/voice.test.mjs):
//   listening (mic open) → the whole turn is heard → the mic closes →
//   the text is sent as one message → the real run is followed however long
//   it takes (messages.follow on every change push, plus a slow fallback) →
//   hand-offs and approvals are said once each, then the reply → only when
//   the last sentence has been spoken does the mic open again.
// Dictation hears one turn, hands its text back and ends.
// The browser parts (microphone, speech-to-text, speech synthesis) come in
// as functions, so this runs under node:test with fakes.
import { speakable } from "../../runtime/speakable.mjs";
import { followReducer, initialFollow } from "./voice.js";

const OFF = { mode: "off", phase: "off" };
// A message that never shows up in follow (it was never sent) stops waiting.
const UNKNOWN_MS = 60_000;

export class VoiceSession {
  // deps: hear({pushToTalk, onPhase, onLevel}) → {result: Promise<text|null>,
  //   stop(), finish(), press(), release()}; send(payload) → Promise<bool>;
  //   follow(requestIds) → Promise<items>; subscribe(fn) → unsubscribe;
  //   speak(sentences) → Promise (the last sentence ended); cancelSpeech();
  //   onState(state); onError(error); onThread(messageId).
  // target: {mode: "chat", conversation, employee: {id, name}, project?,
  //   thread?} or {mode: "dictate", onText}.
  constructor(deps, target) {
    this.deps = {
      clock: () => Date.now(),
      pollMs: 5000,
      timers: globalThis,
      pushToTalk: false,
      ...deps,
    };
    this.target = target;
    this.thread = target.thread || null;
    this.stopped = false;
    this.handle = null;
    this.cleanup = [];
    this.state = OFF;
  }
  set(patch) {
    if (this.stopped && patch.phase !== "off") return;
    const base = this.target.mode === "chat" ? { bot: this.target.employee.name, conversation: this.target.conversation } : {};
    this.state = { ...base, ...this.state, ...patch, mode: patch.phase === "off" ? "off" : this.target.mode };
    this.deps.onState?.(this.state);
  }
  start() {
    this.loop().catch((error) => {
      if (!this.stopped) this.deps.onError?.(error);
      this.stop();
    });
    return this;
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.handle?.stop();
    this.handle = null;
    for (const undo of this.cleanup.splice(0)) undo();
    this.deps.cancelSpeech?.();
    this.state = OFF;
    this.deps.onState?.(OFF);
  }
  // Push-to-talk: the key or button went down / up.
  press() {
    this.handle?.press?.();
  }
  release() {
    this.handle?.release?.();
  }
  // Dictation: the mic button pressed again ends the turn now.
  finish() {
    this.handle?.finish?.();
  }
  async hearOnce() {
    this.set({ phase: "listening", level: 0 });
    this.handle = this.deps.hear({
      pushToTalk: this.deps.pushToTalk,
      onPhase: (phase) => this.set({ phase }),
      onLevel: (level) => this.set({ level }),
    });
    try {
      const text = await this.handle.result;
      return typeof text === "string" ? text.trim() : "";
    } finally {
      this.handle = null;
    }
  }
  async loop() {
    if (this.target.mode === "dictate") {
      const text = await this.hearOnce();
      if (!this.stopped && text) this.target.onText(text);
      this.stop();
      return;
    }
    const { conversation, employee } = this.target;
    while (!this.stopped) {
      const text = await this.hearOnce();
      if (this.stopped) return;
      if (!text) continue;
      this.set({ phase: "sending" });
      const requestId = globalThis.crypto?.randomUUID?.() || `voice-${this.deps.clock()}-${Math.random().toString(36).slice(2)}`;
      const sent = await this.deps.send({ conversation, body: text, recipients: [employee.id], thread: this.thread, requestId });
      if (this.stopped) return;
      if (!sent) {
        this.stop();
        return;
      }
      await this.followUntilDone(requestId);
    }
  }
  // Resolves once the work has ended and everything about it has been said.
  followUntilDone(requestId) {
    const { timers, clock, pollMs } = this.deps;
    this.set({ phase: "working", since: clock() });
    return new Promise((resolve) => {
      let state = initialFollow();
      let speech = Promise.resolve();
      let busy = false;
      let again = false;
      let finished = false;
      const began = clock();
      const done = () => {
        if (finished) return;
        finished = true;
        off();
        speech.then(resolve);
      };
      const say = (sentences) => {
        if (!sentences.length) return;
        speech = speech.then(async () => {
          if (this.stopped) return;
          this.set({ phase: "speaking" });
          // A voice that fails to speak still lets the mic open again.
          await Promise.resolve(this.deps.speak(sentences)).catch(() => {});
          if (!finished && !this.stopped) this.set({ phase: "working" });
        });
      };
      const poll = async () => {
        if (finished || this.stopped) return;
        if (busy) {
          again = true;
          return;
        }
        busy = true;
        try {
          const items = await this.deps.follow([requestId]);
          const item = items?.find?.((i) => i.requestId === requestId) || items?.[0];
          if (this.stopped || finished) return;
          if (item?.message && this.target.project && !this.thread) {
            this.thread = item.message;
            this.deps.onThread?.(item.message);
          }
          if (item?.started) this.set({ since: Date.parse(item.started) || this.state.since });
          if (!item || item.status === "unknown") {
            if (clock() - began > UNKNOWN_MS) {
              say(["I lost track of that message. It's in the chat."]);
              done();
            }
            return;
          }
          const next = followReducer(state, [item]);
          state = next.state;
          for (const event of next.events) say(event.kind === "reply" ? speakable(event.text).sentences : [event.text]);
          if (next.done) done();
        } catch {
          // A failed look is tried again on the next change or tick.
        } finally {
          busy = false;
          if (again && !finished) {
            again = false;
            poll();
          }
        }
      };
      const unsubscribe = this.deps.subscribe(poll);
      const timer = timers.setInterval(poll, pollMs);
      const off = () => {
        unsubscribe?.();
        timers.clearInterval(timer);
        this.cleanup = this.cleanup.filter((undo) => undo !== stopWaiting);
      };
      // Stopping the session while waiting ends the wait (the run goes on;
      // its reply is in the chat).
      const stopWaiting = () => {
        off();
        resolve();
      };
      this.cleanup.push(stopWaiting);
      poll();
    });
  }
}
