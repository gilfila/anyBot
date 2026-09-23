// Waits for a bot to answer one spoken turn and returns what to say back.
// Shared by the desktop app and the phone app so both behave the same: no
// fixed cap (harness runs take seconds to hours), a short "still working" cue
// on long runs, and failures reported out loud.
import { toSpeech } from "./speech.js";

const ACTIVE = new Set(["queued", "running", "cancelling"]);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// load() → { messages, runs } for the conversation (order: oldest first).
// before: message IDs that existed before the turn was sent.
export async function awaitReply({
  load,
  body,
  employee,
  before,
  live = () => true,
  say = async () => {},
  sleep = wait,
  now = Date.now,
  pollMs = 1000,
  firstCueMs = 45000,
  cueEveryMs = 90000,
}) {
  const sentBody = String(body).trim(); // the coordinator stores bodies trimmed
  const started = now();
  const limit = ((employee.timeoutMinutes || 10) + 2) * 60000;
  let nextCue = firstCueMs;
  while (live()) {
    await sleep(pollMs);
    if (!live()) return null;
    let state;
    try {
      state = await load();
    } catch {
      state = null; // A dropped poll is retried; the phone may be switching networks.
    }
    const messages = state?.messages || [];
    const sent = messages.findLast((m) => m.author === "human" && m.body === sentBody && !before.has(m.id));
    const run = sent && (state.runs || []).find((r) => r.message === sent.id && r.employee === employee.id && !r.parent);
    if (run && !ACTIVE.has(run.status)) {
      if (run.status !== "succeeded") return `${employee.name} couldn't finish that. The run ${run.status}.`;
      const reply = messages
        .slice(messages.indexOf(sent) + 1)
        .findLast((m) => m.author === employee.id);
      return reply ? toSpeech(reply.body) || "Done. The details are in the chat." : "Done.";
    }
    const elapsed = now() - started;
    if (elapsed > limit) return "This is taking a while. The answer will be in the chat.";
    if (elapsed > nextCue) {
      nextCue += cueEveryMs;
      await say("Still working on it.");
    }
  }
  return null;
}
