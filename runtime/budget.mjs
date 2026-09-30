// The always-on team's brakes (0.3.38): which lane a run is in, its dispatch
// priority, the Team settings and state, daily run budgets, and a circuit
// breaker per harness for provider usage limits. The rules are pure; the
// coordinator (runtime/coordinator.mjs) applies them in dispatch().
//
// Lanes:
// - owner: work the owner started at the desktop (a message, a task start,
//   Run again, Run now) and everything handed on from it. Never budgeted or
//   held, and it may use the slots kept for the owner.
// - guest: work people started through a bridge (Slack, Buzz, a phone).
//   Budgeted and unattended with Team on, like autonomous work, but it is
//   people's work, so the breaker lets it try (it fails with the reason).
// - autonomous: work a routine, Autopilot or a bot started.
//
// Only counts, ids and codes are stored (metadata `team` and
// `breaker:<harness>`), never conversation text.
import { ownerAuthority } from "./origin.mjs";

export const DAY_MS = 24 * 3600_000;
const MINUTE = 60_000;

// Any Bot can't yet prove that switching off Codex's MCP servers for a run
// works (tests/live-codex-mcp-off.mjs is the check), and MCP servers run
// outside Codex's sandbox. Until it can, Team refuses unattended Codex runs.
export const CODEX_MCP_OFF_VERIFIED = false;

// Settings ------------------------------------------------------------------

export const LEVELS = ["cos", "director", "manager", "employee", "unleveled"];
export const TEAM_DEFAULTS = Object.freeze({
  // Team on (owner commands only). Off by default: every install gets this
  // update, and nothing changes until the owner turns it on.
  enabled: false,
  // The kill switch (team.stop, or turning Team off). While stopped, nothing
  // starts on its own; `resumeEnabled` is what team.resume goes back to and
  // `savedAutopilot` the rooms whose Autopilot it turned off ({id: 0|1}).
  stopped: false,
  resumeEnabled: false,
  savedAutopilot: {},
  // A timed pause (team.pause), epoch ms.
  pausedUntil: 0,
  // Bots working at once (null: the app's default, 8) and slots kept for the owner.
  concurrency: null,
  ownerReserve: 2,
  // Runs a day that nobody at the desk started.
  orgRunsPerDay: 40,
  projectRunsPerDay: 40,
  // Per bot, by level. Levels arrive later; until then every bot is "unleveled".
  levelRuns: Object.freeze({ cos: 16, director: 20, manager: 24, employee: 12, unleveled: 12 }),
  // Input plus output tokens a day for that work; 0 = no token limit.
  orgTokensPerDay: 0,
  // Bots whose permission mode lets them act without asking that may still
  // take unattended work.
  dontAskAllowed: Object.freeze([]),
});

const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const ID = /^[\w-]{1,100}$/;

// The stored settings, read back. Anything missing or out of range takes its
// default, so a bad row never stops dispatch.
export function teamConfig(raw) {
  let value = {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed;
  } catch {
    value = {};
  }
  const d = TEAM_DEFAULTS;
  const levelRuns = { ...d.levelRuns };
  for (const level of LEVELS) if (isInt(value.levelRuns?.[level], 1, 1000)) levelRuns[level] = value.levelRuns[level];
  const saved = {};
  if (value.savedAutopilot && typeof value.savedAutopilot === "object")
    for (const [id, flag] of Object.entries(value.savedAutopilot)) if (ID.test(id) && (flag === 0 || flag === 1)) saved[id] = flag;
  return {
    enabled: value.enabled === true,
    stopped: value.stopped === true,
    resumeEnabled: value.resumeEnabled === true,
    savedAutopilot: saved,
    pausedUntil: isInt(value.pausedUntil, 0, Number.MAX_SAFE_INTEGER) ? value.pausedUntil : 0,
    concurrency: isInt(value.concurrency, 1, 12) ? value.concurrency : null,
    ownerReserve: isInt(value.ownerReserve, 0, 11) ? value.ownerReserve : d.ownerReserve,
    orgRunsPerDay: isInt(value.orgRunsPerDay, 1, 10000) ? value.orgRunsPerDay : d.orgRunsPerDay,
    projectRunsPerDay: isInt(value.projectRunsPerDay, 1, 10000) ? value.projectRunsPerDay : d.projectRunsPerDay,
    levelRuns,
    orgTokensPerDay: isInt(value.orgTokensPerDay, 0, 1e12) ? value.orgTokensPerDay : 0,
    dontAskAllowed: Array.isArray(value.dontAskAllowed) ? [...new Set(value.dontAskAllowed.filter((id) => typeof id === "string" && ID.test(id)))].slice(0, 500) : [],
  };
}

// The owner's changes from Settings → Team, checked. Switching Team on or
// off, pausing and stopping have their own commands and are ignored here.
// `concurrency` is the app's default, for checking the reserve.
export function applyTeamSettings(config, payload = {}, { concurrency = 8 } = {}) {
  const next = { ...config, levelRuns: { ...config.levelRuns }, dontAskAllowed: [...config.dontAskAllowed] };
  const runs = (value, name) => {
    if (!isInt(value, 1, 10000)) throw new Error(`${name} must be a whole number of runs a day, from 1 to 10000`);
    return value;
  };
  if (payload.concurrency !== undefined) {
    if (!isInt(payload.concurrency, 1, 12)) throw new Error("Bots working at once must be a whole number from 1 to 12");
    next.concurrency = payload.concurrency;
  }
  if (payload.ownerReserve !== undefined) {
    if (!isInt(payload.ownerReserve, 0, 11)) throw new Error("Slots kept for you (the reserve) must be a whole number from 0 to 11");
    next.ownerReserve = payload.ownerReserve;
  }
  const slots = next.concurrency ?? concurrency;
  if (payload.ownerReserve !== undefined || payload.concurrency !== undefined)
    if (next.ownerReserve >= slots)
      throw new Error(`Slots kept for you (the reserve) must be fewer than the ${slots} bots that work at once, so unattended work has room`);
  if (payload.orgRunsPerDay !== undefined) next.orgRunsPerDay = runs(payload.orgRunsPerDay, "The team's limit");
  if (payload.projectRunsPerDay !== undefined) next.projectRunsPerDay = runs(payload.projectRunsPerDay, "Each project's limit");
  if (payload.levelRuns !== undefined) {
    if (!payload.levelRuns || typeof payload.levelRuns !== "object") throw new Error("Runs per bot must list levels");
    for (const [level, value] of Object.entries(payload.levelRuns)) {
      if (!LEVELS.includes(level)) throw new Error(`Unknown level: ${String(level).slice(0, 40)}`);
      if (!isInt(value, 1, 1000)) throw new Error("Each bot's limit must be a whole number of runs a day, from 1 to 1000");
      next.levelRuns[level] = value;
    }
  }
  if (payload.orgTokensPerDay !== undefined) {
    if (!isInt(payload.orgTokensPerDay, 0, 1e12)) throw new Error("The daily token limit must be a whole number of tokens (0 for none)");
    next.orgTokensPerDay = payload.orgTokensPerDay;
  }
  if (payload.dontAskAllowed !== undefined) {
    if (!Array.isArray(payload.dontAskAllowed) || payload.dontAskAllowed.some((id) => typeof id !== "string" || !ID.test(id)))
      throw new Error("Bots allowed to work unattended must be a list of bot ids");
    next.dontAskAllowed = [...new Set(payload.dontAskAllowed)].slice(0, 500);
  }
  return next;
}

// off: Team was never turned on (Any Bot works as before 0.3.38).
// running: Team is on. paused: a timed pause. stopped: the kill switch.
// Paused and stopped hold everything nobody at the desk started.
export function teamState(config, now) {
  if (config.stopped) return "stopped";
  if (config.pausedUntil > now) return "paused";
  return config.enabled ? "running" : "off";
}
export const halted = (state) => state === "stopped" || state === "paused";

// Lanes and priority ------------------------------------------------------------

// `origin`: where the run's own message came from; `rootOrigin`: where its
// piece of work began (Coordinator.runOrigin); `peopleStarted`: people began
// it, here or through a bridge (Coordinator.startedByPeople); `ownerRun`: the
// owner pressed Run again or Run now for it (or for the work it belongs to).
export function laneOf({ origin, rootOrigin, peopleStarted = false, ownerRun = false }) {
  if (ownerRun || ownerAuthority(origin) || ownerAuthority(rootOrigin)) return "owner";
  return peopleStarted ? "guest" : "autonomous";
}

// A run is autonomous when no person started its work (amended by M0: never
// from the root message's author).
export const isAutonomous = (coordinator, run) => !coordinator.startedByPeople(run);

// Priority for autonomous work by what it is (wakes bring their own later).
export const KIND_PRIORITY = Object.freeze({
  review: 20,
  decision: 20,
  desk: 20,
  schedule: 15,
  task: 10,
  stalled: 10,
  onboard: 10,
  child: 10,
  plan: 5,
  routine: 0,
});
export const AGE_BOOST_MS = 30 * MINUTE;

// Dispatch priority, highest first (the table in docs/plans/always-on-team.md).
// Below 25, half an hour in the queue adds 5, never past 20.
export function priorityOf({ origin, rootOrigin, ownerRun = false, peopleStarted = false, kind = "child", wakePriority, queuedMs = 0 }) {
  if (ownerRun || ownerAuthority(origin)) return 30;
  if (ownerAuthority(rootOrigin)) return 25;
  const base = Number.isInteger(wakePriority) ? wakePriority : peopleStarted ? 20 : (KIND_PRIORITY[kind] ?? 10);
  return queuedMs >= AGE_BOOST_MS ? Math.max(base, Math.min(20, base + 5)) : base;
}

// Days ------------------------------------------------------------------------

// Local midnight at the start of the day `time` falls in.
export function dayStart(time) {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// The next time the local clock shows "HH:MM", after `now`; null for a bad time.
export function nextClockTime(text, now) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || ""));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  const at = new Date(now);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

// Tokens a run used (input plus output, from runs.usage).
export function tokensOf(usage) {
  let value = usage;
  if (typeof usage === "string") {
    try {
      value = JSON.parse(usage);
    } catch {
      return 0;
    }
  }
  if (!value || typeof value !== "object") return 0;
  const count = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  return count(value["gen_ai.usage.input_tokens"]) + count(value["gen_ai.usage.output_tokens"]);
}

// Reset times -------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export const MAX_RESET_MS = 7 * DAY_MS;

// A zone's offset from UTC at `instant`, in ms (null for an unknown zone).
function zoneOffset(zone, instant) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      })
        .formatToParts(instant)
        .map((part) => [part.type, part.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second) - instant;
  } catch {
    return null;
  }
}
// The instant a wall-clock time in `zone` (null: this computer's) happens.
function wallTime({ year, month, day, hour, minute }, zone) {
  if (!zone) return new Date(year, month, day, hour, minute).getTime();
  const guess = Date.UTC(year, month, day, hour, minute);
  const first = zoneOffset(zone, guess);
  if (first === null) return null;
  const second = zoneOffset(zone, guess - first);
  return guess - (second ?? first);
}
// Today's date in `zone` (or locally).
function dateIn(now, zone) {
  const offset = zone ? zoneOffset(zone, now) : null;
  if (offset === null) {
    const d = new Date(now);
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  }
  const d = new Date(now + offset);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}
const hour12 = (hour, meridiem) => (Number(hour) % 12) + (/p/i.test(meridiem) ? 12 : 0);

// When a usage limit lifts, read from the harness's own error text (epoch
// ms), or null when there's none, it has passed, or it's more than a week
// away. The breaker then uses its own backoff. Unverified against every
// wording a provider may print, so the backoff stays the fallback.
export function parseResetTime(text, now) {
  const source = String(text ?? "");
  if (!source) return null;
  const valid = (value) => (Number.isFinite(value) && value > now && value - now <= MAX_RESET_MS ? value : null);
  // "…usage limit reached|1759152000" (epoch seconds).
  const epoch = /\|(\d{10})\b/.exec(source);
  if (epoch) return valid(Number(epoch[1]) * 1000);
  // Codex: "try again at Oct 3rd, 2026 3:05 PM" / "try again at 3:05 PM" (local time).
  const dated = /try again at ([A-Za-z]{3})[a-z]* (\d{1,2})(?:st|nd|rd|th)?,? (\d{4}),? (\d{1,2}):(\d{2}) ?([AP]M)/i.exec(source);
  if (dated) {
    const month = MONTHS.indexOf(dated[1].toLowerCase());
    if (month < 0) return null;
    return valid(wallTime({ year: +dated[3], month, day: +dated[2], hour: hour12(dated[4], dated[6]), minute: +dated[5] }, null));
  }
  const clock = /try again at (\d{1,2}):(\d{2}) ?([AP]M)/i.exec(source);
  if (clock) {
    const today = dateIn(now, null);
    let at = wallTime({ ...today, hour: hour12(clock[1], clock[3]), minute: +clock[2] }, null);
    if (at <= now) at = wallTime({ ...today, day: today.day + 1, hour: hour12(clock[1], clock[3]), minute: +clock[2] }, null);
    return valid(at);
  }
  // Claude Code: "resets 3pm (America/Los_Angeles)", "resets Oct 2, 4:30pm (…)".
  const resets = /resets (?:([A-Za-z]{3})[a-z]* (\d{1,2}),? )?(\d{1,2})(?::(\d{2}))? ?([ap]m)(?: \(([^)]{1,60})\))?/i.exec(source);
  if (resets) {
    const zone = resets[6] && zoneOffset(resets[6], now) !== null ? resets[6] : null;
    const hour = hour12(resets[3], resets[5]);
    const minute = Number(resets[4] || 0);
    const today = dateIn(now, zone);
    if (resets[1]) {
      const month = MONTHS.indexOf(resets[1].toLowerCase());
      if (month < 0) return null;
      let at = wallTime({ year: today.year, month, day: +resets[2], hour, minute }, zone);
      if (at !== null && at <= now) at = wallTime({ year: today.year + 1, month, day: +resets[2], hour, minute }, zone);
      return valid(at);
    }
    let at = wallTime({ ...today, hour, minute }, zone);
    if (at !== null && at <= now) at = wallTime({ ...today, day: today.day + 1, hour, minute }, zone);
    return valid(at);
  }
  // "try again in 2 hours 3 minutes", "in 45 seconds", "in 5 days 3 hours".
  const relative = /(?:try again|retry|resets?) in ((?:\d+ ?(?:days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)[ ,and]*)+)/i.exec(source);
  if (relative) {
    const units = { d: DAY_MS, h: 3600_000, m: MINUTE, s: 1000 };
    let total = 0;
    for (const [, amount, unit] of relative[1].matchAll(/(\d+) ?(days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)/gi))
      total += Number(amount) * units[unit[0].toLowerCase()];
    return total ? valid(now + total) : null;
  }
  const iso = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))\b/.exec(source);
  if (iso) return valid(Date.parse(iso[1]));
  return null;
}

// The breaker ---------------------------------------------------------------------

// Only these structured failure codes (runtime/adapters.mjs: from the CLI's
// own error fields, never from free text) count toward opening a breaker.
export const BREAKER_CODES = new Set(["usage_limit", "auth"]);
export const BREAKER_WINDOW_MS = 10 * MINUTE;
export const BREAKER_TRIPS = 2;
export const BACKOFF_MINUTES = Object.freeze([15, 30, 60, 120]);
const breakerKey = (harness) => `breaker:${harness}`;
const CLOSED = { state: "closed", failures: [], openUntil: 0, backoffStep: 0, probeRun: null, code: "", openedAt: 0 };

// One per harness: opens after BREAKER_TRIPS limit or sign-in failures within
// BREAKER_WINDOW_MS, for 15, 30, 60, then 120 minutes (or until the reset time
// the provider gave). Then it is half-open: one probe run may go; its success
// closes it, its limit failure opens it again for longer. Any success on that
// harness closes it, and the owner can reset it. It holds autonomous runs
// only; the coordinator lets the owner's and guests' runs try.
// `kv` is metadata: get(key), set(key, value), delete(key), list(prefix).
export class Breaker {
  constructor(kv, clock = Date.now) {
    this.kv = kv;
    this.clock = clock;
  }
  load(harness) {
    try {
      const value = JSON.parse(this.kv.get(breakerKey(harness)) || "null");
      if (!value || typeof value !== "object") return { ...CLOSED, failures: [] };
      return {
        state: ["open", "closed"].includes(value.state) ? value.state : "closed",
        failures: Array.isArray(value.failures) ? value.failures.filter(Number.isFinite).slice(-20) : [],
        openUntil: Number.isFinite(value.openUntil) ? value.openUntil : 0,
        backoffStep: isInt(value.backoffStep, 0, BACKOFF_MINUTES.length - 1) ? value.backoffStep : 0,
        probeRun: typeof value.probeRun === "string" ? value.probeRun : null,
        code: typeof value.code === "string" ? value.code : "",
        openedAt: Number.isFinite(value.openedAt) ? value.openedAt : 0,
      };
    } catch {
      return { ...CLOSED, failures: [] };
    }
  }
  save(harness, value) {
    if (value.state === "closed" && !value.failures.length) this.kv.delete(breakerKey(harness));
    else this.kv.set(breakerKey(harness), JSON.stringify(value));
  }
  // The state as it is now: an open breaker whose time is up is half-open.
  get(harness) {
    const value = this.load(harness);
    const state = value.state === "open" && this.clock() >= value.openUntil ? "half" : value.state;
    return { harness, ...value, state };
  }
  list() {
    return this.kv
      .list("breaker:")
      .map(({ key }) => this.get(key.slice("breaker:".length)))
      .map(({ harness, state, openUntil, code, failures, openedAt }) => ({ harness, state, openUntil, code, failures: failures.length, openedAt }))
      .sort((a, b) => a.harness.localeCompare(b.harness));
  }
  open(harness, value, step, code, resetAt) {
    const now = this.clock();
    const until = Number.isFinite(resetAt) && resetAt > now && resetAt - now <= MAX_RESET_MS ? resetAt : now + BACKOFF_MINUTES[step] * MINUTE;
    const next = { state: "open", failures: [], openUntil: until, backoffStep: step, probeRun: null, code: code || value.code, openedAt: now };
    this.save(harness, next);
    return { opened: true, state: this.get(harness) };
  }
  // A failed run on `harness`. Only BREAKER_CODES count.
  record(harness, { code, resetAt, run } = {}) {
    if (!BREAKER_CODES.has(code)) return { opened: false, state: this.get(harness) };
    const value = this.load(harness);
    const now = this.clock();
    if (value.state === "open") {
      const probeFailed = run && run === value.probeRun;
      if (probeFailed || now >= value.openUntil)
        return this.open(harness, value, Math.min(value.backoffStep + 1, BACKOFF_MINUTES.length - 1), code, resetAt);
      // Already open (an owner's run hit it too): only a later reset time moves it.
      if (Number.isFinite(resetAt) && resetAt > value.openUntil && resetAt - now <= MAX_RESET_MS) this.save(harness, { ...value, openUntil: resetAt });
      return { opened: false, state: this.get(harness) };
    }
    const failures = [...value.failures.filter((at) => now - at < BREAKER_WINDOW_MS), now];
    if (failures.length >= BREAKER_TRIPS) return this.open(harness, value, 0, code, resetAt);
    this.save(harness, { ...value, failures });
    return { opened: false, state: this.get(harness) };
  }
  // A run on `harness` succeeded: the provider is answering again.
  succeeded(harness) {
    const value = this.load(harness);
    if (value.state === "closed") {
      if (value.failures.length) this.save(harness, { ...CLOSED, failures: [] });
      return { closed: false };
    }
    this.save(harness, { ...CLOSED, failures: [] });
    return { closed: true };
  }
  // Whether an autonomous run on `harness` may start: "closed", "probe" (the
  // one run a half-open breaker lets through) or "open".
  admit(harness, isActive = () => false) {
    const value = this.get(harness);
    if (value.state === "closed") return "closed";
    if (value.state === "open") return "open";
    return value.probeRun && isActive(value.probeRun) ? "open" : "probe";
  }
  probeStarted(harness, run) {
    const value = this.load(harness);
    if (value.state === "open") this.save(harness, { ...value, probeRun: run });
  }
  // The owner's "Try now".
  reset(harness) {
    const value = this.load(harness);
    const closed = value.state !== "closed";
    this.save(harness, { ...CLOSED, failures: [] });
    return { closed };
  }
}

// Budgets -------------------------------------------------------------------------

// Runs started today (local day), counted when dispatch starts them: per bot,
// per project and for the whole team, plus their tokens, for work nobody at
// the desk started. The owner's runs are counted, never capped. Kept in memory
// and recounted from the runs table at startup and each new day.
export class Budget {
  // `laneOf(row)` gives a stored run's lane.
  constructor(store, { clock = Date.now, laneOf: lane }) {
    this.store = store;
    this.clock = clock;
    this.lane = lane;
    this.day = null;
    this.counts = null;
  }
  today() {
    const day = dayStart(this.clock());
    if (this.day !== day) this.recount(day);
    return this.counts;
  }
  recount(day) {
    this.day = day;
    const counts = { day, org: 0, owner: 0, tokens: 0, bots: new Map(), projects: new Map(), started: new Set() };
    const since = new Date(day).toISOString();
    for (const row of this.store.all("SELECT * FROM runs WHERE started >= ? ORDER BY rowid", since)) {
      const lane = this.lane(row);
      this.add(counts, row, lane);
      if (lane !== "owner") counts.tokens += tokensOf(row.usage);
    }
    this.counts = counts;
  }
  add(counts, run, lane) {
    counts.started.add(run.id);
    if (lane === "owner") {
      counts.owner += 1;
      return;
    }
    counts.org += 1;
    counts.bots.set(run.employee, (counts.bots.get(run.employee) || 0) + 1);
    counts.projects.set(run.conversation, (counts.projects.get(run.conversation) || 0) + 1);
  }
  started(run, lane) {
    const counts = this.today();
    if (!counts.started.has(run.id)) this.add(counts, run, lane);
  }
  // A run's tokens, once the harness reported them.
  usage(run, lane, usage) {
    const counts = this.today();
    if (lane !== "owner" && counts.started.has(run.id)) counts.tokens += tokensOf(usage);
  }
  // The first limit this run would pass, or null. Levels arrive later, so
  // every bot has the "unleveled" limit for now.
  over(run, employee, config) {
    const counts = this.today();
    const checks = [
      ["tokens", config.orgTokensPerDay, counts.tokens],
      ["org", config.orgRunsPerDay, counts.org],
      ["project", config.projectRunsPerDay, counts.projects.get(run.conversation) || 0],
      ["bot", config.levelRuns[employee.level] ?? config.levelRuns.unleveled, counts.bots.get(employee.id) || 0],
    ];
    for (const [scope, cap, used] of checks) if (cap > 0 && used >= cap) return { scope, cap, used };
    return null;
  }
  // Plain numbers for the snapshot.
  summary() {
    const counts = this.today();
    return {
      day: new Date(counts.day).toISOString(),
      org: counts.org,
      owner: counts.owner,
      tokens: counts.tokens,
      bots: Object.fromEntries(counts.bots),
      projects: Object.fromEntries(counts.projects),
    };
  }
}
