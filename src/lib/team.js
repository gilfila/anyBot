// The always-on team in the app (snapshot.team, runtime/coordinator.mjs
// teamStatus): plain words for its state, for why a queued run is waiting,
// and for a harness waiting on a usage limit. Pure, so node:test can run it
// (tests/team-ui.test.mjs).

export const TEAM_STATE_LABELS = { off: "Off", running: "On", paused: "Paused", stopped: "Stopped" };

// "14:20" in the owner's clock.
export const clockTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// What a run that nobody at the desk started is, in a phrase.
export const KIND_WORDS = { routine: "a routine", task: "an Autopilot task", review: "a review", child: "a hand-off" };

// "Claude Code usage limit" / "Codex sign-in problem".
export const breakerTitle = (breaker, harnessName = (id) => id) =>
  `${harnessName(breaker.harness)} ${breaker.code === "auth" ? "sign-in problem" : "usage limit"}`;

// Harnesses whose breaker is on: open, or half-open (its time is up; with
// `probing`, one run is checking whether the limit has lifted, otherwise the
// next routine, Autopilot task or hand-off on it will check).
export const openBreakers = (team) => (team?.breakers || []).filter((b) => b.state === "open" || b.state === "half");

// A breaker in a few words, for the sidebar: "until 14:20", "checking" or
// "may have lifted".
export const breakerShort = (breaker) =>
  breaker.state !== "half" ? `until ${clockTime(breaker.openUntil)}` : breaker.probing ? "checking" : "may have lifted";

// A breaker in a sentence: what waits, until when, and what still tries.
// Only routines, Autopilot and hand-offs wait; people's messages (yours, and
// ones from Slack, Buzz or a phone) still try, so they hear the reason.
export function breakerNote(breaker, harnessName = (id) => id) {
  const name = harnessName(breaker.harness);
  const title = breakerTitle(breaker, harnessName);
  if (breaker.state === "half" && breaker.probing)
    return `${title}: one run is checking whether it has lifted; routines, Autopilot and hand-offs on ${name} wait for it.`;
  if (breaker.state === "half") return `${title}: it may have lifted; the next routine, Autopilot task or hand-off on ${name} checks.`;
  return `${title}: routines, Autopilot and hand-offs on ${name} wait until ${clockTime(breaker.openUntil)}; messages from you, Slack, Buzz or your phone still try.`;
}

// What Resume offers. After Team was switched off (or stopped while on), a
// plain Resume would turn Team back on, so it says so, next to Resume with
// Team off. `payload` goes to team.resume.
export function resumeChoices(team) {
  if (team?.state === "stopped" && team.resumeEnabled)
    return [
      { label: "Turn Team back on", payload: { enabled: true } },
      { label: "Resume with Team off", payload: { enabled: false } },
    ];
  if (team?.state === "stopped" || team?.state === "paused") return [{ label: "Resume", payload: undefined }];
  return [];
}

// One line on the Team's state, with what matters next.
export function teamLine(team) {
  if (!team) return "";
  if (team.state === "stopped") return "Stopped: nothing starts on its own until you resume the team.";
  if (team.state === "paused") return `Paused until ${clockTime(team.pausedUntil)}: nothing starts on its own until then.`;
  if (team.state === "running") {
    const used = team.today?.org ?? 0;
    const cap = team.settings?.orgRunsPerDay ?? 0;
    return `On: ${used} of ${cap} runs today that nobody at the desk started.`;
  }
  return "Off: routines and Autopilot run without daily limits (they still wait while a harness is on a usage limit).";
}

// Why a queued run hasn't started: { text, interrupt } where `interrupt` is
// the run the owner may interrupt so their own queued message goes first
// (work nobody at the desk started), or null. `name(id)` names a bot, `harnessName(id)` a harness.
export function waitText(wait, { name = () => "A bot", harnessName = (id) => id, now = Date.now() } = {}) {
  if (!wait) return null;
  const minutes = (since) => {
    const value = Math.max(0, Math.round((now - Date.parse(since)) / 60000));
    return Number.isFinite(value) ? (value < 1 ? "just now" : `${value}m`) : "";
  };
  switch (wait.reason) {
    case "bot-busy":
    case "folder-busy": {
      const who = name(wait.blockerEmployee);
      const own = wait.lane === "owner";
      const what = own ? "your earlier message" : wait.lane === "guest" ? "a message from Slack, Buzz or a phone" : KIND_WORDS[wait.kind] || "work nobody at the desk started";
      const started = minutes(wait.since);
      const doing = `${who} is on ${what}${started ? ` (started ${started === "just now" ? "just now" : `${started} ago`})` : ""}`;
      const text = wait.reason === "bot-busy" ? `${doing}.` : `Waiting for its folder: ${doing} there.`;
      // Only your own queued message may interrupt, and only work you didn't start.
      return { text, interrupt: wait.mine && !own ? wait.blocker : null };
    }
    case "slots":
      return { text: `All ${wait.slots} slots are busy; it starts when one frees up.`, interrupt: null };
    case "reserve":
      return { text: `Waiting for a slot: ${wait.slots} are for work nobody at the desk started, the rest are kept for you.`, interrupt: null };
    case "budget": {
      const text = {
        bot: `Today's limit of ${wait.cap} runs for this bot is used up; this waits until midnight.`,
        project: `This project's ${wait.cap} runs for today are used up; this waits until midnight.`,
        org: `The team's ${wait.cap} runs for today are used up; this waits until midnight.`,
        tokens: `The team's token limit for today is used up; this waits until midnight.`,
      }[wait.scope];
      return { text: text || "Today's limit is used up; this waits until midnight.", interrupt: null };
    }
    case "breaker":
      return {
        text:
          wait.state === "half"
            ? `${breakerTitle({ harness: wait.harness, code: wait.code }, harnessName)}: one run is checking whether it has lifted; this starts after it.`
            : `${breakerTitle({ harness: wait.harness, code: wait.code }, harnessName)}: this waits until ${clockTime(wait.until)}.`,
        interrupt: null,
      };
    case "owner-first":
      return { text: "Waiting while your message goes first.", interrupt: null };
    case "paused":
      return { text: "The team is paused; this starts when the pause ends.", interrupt: null };
    case "stopped":
      return { text: "The team is stopped; this starts when you resume it.", interrupt: null };
    default:
      return null;
  }
}

// A routine's last occurrence, in words where the stored status isn't plain.
export const occurrenceLabel = (status) => (status === "skipped-stopped" ? "skipped (the team was stopped or paused)" : status);
