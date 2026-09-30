// The daily people review (0.3.39): a read-only breakdown of which bots need
// adjusting, and which might be let go. It is computed from what the
// database already holds (runs, the board, tool approvals, a few events), so
// it costs no tokens, and it changes nothing: every verdict comes with one
// suggested fix, and applying it is the owner's call.
//
// Pure over rows: `readRows` is the only function that reads the database
// (store.all only), and what it returns holds ids, counts, codes and times,
// never message or error text. The coordinator runs it once a local day at
// the owner's time (runtime/coordinator.mjs, peopleTick) and keeps 14 days of
// results in metadata `people.day:<YYYY-MM-DD>`; settings are in metadata
// `people.review`. The renderer imports the words and the table from here.
import { tokensOf } from "./budget.mjs";
import { classifyRunError } from "./diagnostics.mjs";

export const DAY_MS = 24 * 3600_000;
// Each review looks at the last 14 days, and at the last 24 hours on its own.
export const WINDOW_DAYS = 14;
export const HISTORY_DAYS = 14;
// No rate is judged on fewer than this many cases, and a rate is judged by its
// Wilson lower bound (95%), so 2 failures in 5 runs never flags a bot.
export const MIN_SAMPLE = 10;
// A scheduled review that ran more than this after its time is marked late.
export const LATE_MS = 5 * 60_000;
export const DEFAULT_SETTINGS = Object.freeze({ enabled: true, at: "06:45" });

// Verdicts, most severe first.
export const VERDICTS = Object.freeze(["fire", "adjust", "watch", "ok", "insufficient"]);
export const VERDICT_LABELS = Object.freeze({
  fire: "Fire candidate",
  adjust: "Adjust",
  watch: "Watch",
  ok: "OK",
  insufficient: "Not enough data",
});
const RANK = { fire: 4, adjust: 3, watch: 2, ok: 1, insufficient: 0 };
export const verdictRank = (verdict) => RANK[verdict] ?? -1;

// What a suggested fix changes. Only ever suggested; nothing is applied.
export const FIX_KINDS = Object.freeze(["instructions", "model", "effort", "harness", "manager", "workspace"]);
export const FIX_LABELS = Object.freeze({
  instructions: "Instructions",
  model: "Model",
  effort: "Effort",
  harness: "Harness",
  manager: "Manager",
  workspace: "Workspace",
});
export const FIXES = Object.freeze({
  "failures.timeout": { kind: "effort", text: "Lower its thinking effort, raise its run time limit, or split its tasks smaller." },
  "failures.output_limit": { kind: "instructions", text: "Add “write results to files, not long replies” to its instructions." },
  "failures.no_response": { kind: "harness", text: "Check its harness is signed in and up to date, or move it to another harness." },
  "failures.model": { kind: "model", text: "Pick a model its harness offers." },
  cost: { kind: "effort", text: "Lower its thinking effort or pick a smaller model: its finished tasks cost over twice what its peers' do." },
  rejections: { kind: "effort", text: "Raise its thinking effort, or have a different manager review its work earlier." },
  reviewCap: { kind: "effort", text: "Raise its thinking effort, and check that the task's brief says what done looks like." },
  redo: { kind: "instructions", text: "Add what you keep correcting to its instructions." },
  denials: { kind: "instructions", text: "Say in its instructions which actions you won't approve, so it stops asking for them." },
  stuck: { kind: "manager", text: "Have its manager (or you) unblock, restart or reassign its stuck cards." },
  busywork: { kind: "instructions", text: "Narrow its mission: when there's nothing to act on, it should say so briefly and stop." },
  launch: { kind: "workspace", text: "Check that its workspace folder still exists and that it may work there." },
  "fire.adjusted": {
    kind: "manager",
    text: "It stayed at Adjust for 14 days, and its last change didn't help. Move its work to a teammate or let it go; archiving it is your call.",
  },
  "fire.idle": {
    kind: "manager",
    text: "It had work for 14 days and did none of it, and {teammate} covers the same role. Merge its work into {teammate} or archive it; that's your call.",
  },
});

// classifyRunError's codes (runtime/diagnostics.mjs), split by whose fault
// they are. "exit" is its fallback for anything it doesn't recognise
// (environment crashes included), so it is left out as unclear.
export const BOT_FAILURES = new Set(["timeout", "output_limit", "no_response", "model"]);
export const ENV_FAILURES = new Set(["usage_limit", "auth", "not_installed", "launch"]);
const FAIL_WORDS = {
  timeout: "timed out",
  output_limit: "hit the output limit",
  no_response: "gave no answer",
  model: "named a model its harness doesn't have",
};

// The thresholds, all in one table. `min` is the least data before the rule
// is judged; rates use the Wilson lower bound (see MIN_SAMPLE).
export const RULES = Object.freeze([
  {
    code: "failures",
    label: "Failed runs",
    counts: "Its runs that timed out, hit the output limit, gave no answer or named a model its harness doesn't have, out of its runs that finished or failed that way.",
    min: `${MIN_SAMPLE} runs`,
    watch: "15% or more",
    adjust: "25% or more",
    why: "Usage limits, sign-in problems, a missing harness, a folder it can't start in and Any Bot stopping are outages, not the bot, so they never count; an exit with no known cause is left out as unclear.",
  },
  {
    code: "cost",
    label: "Cost per finished task",
    counts: "Tokens of every run on the tasks it led to Done (failed attempts and reviews included), per task.",
    min: "3 finished tasks, and 3 peers with as many on the same harness, model and effort",
    watch: "",
    adjust: "More than twice its peers' median",
    why: "Only peers on the same harness, model and thinking effort are comparable; a deep-thinking bot costs more by design.",
  },
  {
    code: "rejections",
    label: "Reviews sent back",
    counts: "Reviews of tasks it led that sent the work back (by its reviewer or you), out of all reviews of its work.",
    min: `${MIN_SAMPLE} reviews`,
    watch: "20% or more",
    adjust: "34% or more",
    why: "Work that keeps coming back from review costs a round each time.",
  },
  {
    code: "reviewCap",
    label: "Review limit reached",
    counts: "Tasks it led that hit the 3-round review limit.",
    min: "None",
    watch: "1 or more",
    adjust: "",
    why: "Three rounds without agreement means the brief or the work needs a look.",
  },
  {
    code: "redo",
    label: "Work you redid",
    counts: "Your Request changes on tasks it led and your Stops of its running work, out of its finished runs plus those Stops.",
    min: `${MIN_SAMPLE} runs`,
    watch: "10% or more",
    adjust: "20% or more",
    why: "Only what you did counts, never words in a message. A retry follows a failure the failure rate already counts, so it isn't counted again.",
  },
  {
    code: "denials",
    label: "Tool requests you declined",
    counts: "Tool approvals you declined, out of those you answered.",
    min: `${MIN_SAMPLE} answered requests for Adjust`,
    watch: "3 or more declined",
    adjust: "30% or more",
    why: "A bot that keeps asking for what you won't allow needs clearer instructions. Requests that expired unanswered never count: nobody was there to answer.",
  },
  {
    code: "stuck",
    label: "Stuck cards",
    counts: "Its cards In progress with nothing running, or waiting on its review, for over a day, and tasks Autopilot kept restarting.",
    min: "None",
    watch: "2 or more",
    adjust: "",
    why: "A card left after an outage (its last run hit a usage limit, for example) isn't counted, nor is one at the review limit, which is yours to decide.",
  },
  {
    code: "busywork",
    label: "Busywork",
    counts: "Its reviews, and its turns another bot's message started, that nobody at the desk started and that changed nothing (no board change, file, hand-off, canvas, memory, fact or report), out of all such runs.",
    min: `${MIN_SAMPLE} runs`,
    watch: "40% or more",
    adjust: "",
    why: "Those runs exist to act. Work you asked for is never busywork, and a task run, a routine's reply or a hand-off's answer is a product in itself, so they aren't counted.",
  },
  {
    code: "launch",
    label: "Couldn't start",
    counts: "Its runs that couldn't start in its folder.",
    min: "None",
    watch: "3 or more",
    adjust: "",
    why: "Not the bot's fault, but its setup: usually a workspace folder that moved.",
  },
]);
export const FIRE_RULES = Object.freeze([
  "A threshold alone never makes a fire candidate, and thin data never does.",
  "Adjust every day for 14 days, and a change to the bot at least 7 days ago didn't improve its main problem by 25%.",
  "Or: with Team on and work assigned to it (a task in a project on Autopilot, or a routine), it ran nothing for 14 days in a row without being held by limits, and a teammate under the same manager has the same role. Bots that report to you directly are never judged idle this way.",
  "A bot changed in the last 7 days is held at Watch while the change settles.",
]);
const THRESHOLDS = {
  failures: { watch: 0.15, adjust: 0.25 },
  cost: { adjust: 2 },
  rejections: { watch: 0.2, adjust: 0.34 },
  redo: { watch: 0.1, adjust: 0.2 },
  denials: { watch: 3, adjust: 0.3 },
  stuck: { watch: 2 },
  busywork: { watch: 0.4 },
  launch: { watch: 3 },
};
const IMPROVED = 0.25;
const COOLDOWN_MS = 7 * DAY_MS;
const OVERLAP = 0.6;
const PEERS = 3;
const TASKS = 3;

// The Wilson score interval's lower bound for k successes in n (95%).
export function wilsonLower(k, n, z = 1.96) {
  if (!n) return 0;
  const p = k / n;
  const z2 = z * z;
  return Math.max(0, (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n));
}

// A run's outcome: ok, bot (its own failure), env (an outage, or Any Bot
// stopping), unclear, cancelled, or still queued/running.
export function outcomeOf(status, error) {
  if (status === "succeeded") return { cls: "ok" };
  if (status === "interrupted") return { cls: "env", code: "interrupted" };
  if (status === "cancelled") return { cls: "cancelled" };
  if (status !== "failed") return { cls: String(status) };
  const code = classifyRunError(error);
  return { cls: BOT_FAILURES.has(code) ? "bot" : ENV_FAILURES.has(code) ? "env" : "unclear", code };
}

// Settings ------------------------------------------------------------------------

const TIME = /^(\d{1,2}):(\d{2})$/;
function clockTime(value) {
  const match = TIME.exec(String(value ?? ""));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}
// Stored settings read back; anything missing or bad takes its default.
export function peopleSettings(raw) {
  let value = {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = parsed;
  } catch {
    value = {};
  }
  return {
    enabled: value.enabled !== false,
    at: clockTime(value.at) || DEFAULT_SETTINGS.at,
    lastSlot: Number.isFinite(value.lastSlot) ? value.lastSlot : null,
  };
}
// The owner's changes (Settings), checked.
export function applyPeopleSettings(settings, payload = {}) {
  const next = { ...settings };
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== "boolean") throw new Error("The people review is on or off: true or false");
    next.enabled = payload.enabled;
  }
  if (payload.at !== undefined) {
    const at = clockTime(payload.at);
    if (!at) throw new Error("The review's time must be a time like 06:45");
    next.at = at;
  }
  return next;
}

// Days and slots (local time, like the owner's clock) ------------------------------

const pad = (n) => String(n).padStart(2, "0");
export function dayKey(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// `at` ("HH:MM") on the local day `time` falls in.
export function slotOn(time, at) {
  const [hours, minutes] = (clockTime(at) || DEFAULT_SETTINGS.at).split(":").map(Number);
  const d = new Date(time);
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}
// The latest review time the clock has passed: today's, or yesterday's.
export function dueSlot(now, at) {
  const today = slotOn(now, at);
  if (today <= now) return today;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return slotOn(yesterday.getTime(), at);
}
// The next review time after `now`.
export function nextSlot(now, at) {
  const today = slotOn(now, at);
  if (today > now) return today;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return slotOn(tomorrow.getTime(), at);
}
// The local day keys of the `count` days before `day` ("YYYY-MM-DD"), newest first.
function daysBefore(day, count) {
  const [y, m, d] = day.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => dayKey(new Date(y, m - 1, d - i - 1, 12).getTime()));
}

// Reading the database -------------------------------------------------------------

// Queued work held by the Team's limits, not by its own bot.
const HELD = new Set(["budget", "breaker", "paused", "stopped", "reserve", "slots", "owner-first"]);
const REVIEW_CAP_NOTE = "Review limit reached. The owner decides from here.";
const BOUNCE_NOTE = "Autopilot started this task ";
const ids = (value) => {
  try {
    const list = JSON.parse(value || "[]");
    return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
};
const payloadOf = (value) => {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

// Everything the review needs, from the last 14 days, as ids, counts, codes
// and times. `laneOf(run)` is the coordinator's lane (owner, guest or
// autonomous); `waits` is dispatch's reason each queued run waits.
export function readRows(store, { now, laneOf = () => "owner", team = "off", waits = new Map() }) {
  const since = new Date(now - WINDOW_DAYS * DAY_MS).toISOString();
  const bots = store.all("SELECT id,role,harness,model,effort,manager,created FROM employees WHERE archived=0 ORDER BY created, rowid");
  // Runs that left a trace: a board change, a file, a hand-off, a canvas,
  // memory or knowledge write, or a report of its own.
  const traced = new Set();
  for (const sql of [
    "SELECT DISTINCT run FROM task_activity WHERE created >= ? AND run IS NOT NULL",
    "SELECT DISTINCT run FROM artifacts WHERE created >= ?",
    "SELECT DISTINCT parent AS run FROM runs WHERE created >= ? AND parent IS NOT NULL",
    "SELECT DISTINCT run FROM memories WHERE created >= ? AND run IS NOT NULL",
    "SELECT DISTINCT run FROM kg_entities WHERE updated >= ? AND run IS NOT NULL",
    "SELECT DISTINCT run FROM kg_edges WHERE updated >= ? AND run IS NOT NULL",
    "SELECT DISTINCT run FROM reports WHERE created >= ? AND run IS NOT NULL",
    "SELECT DISTINCT json_extract(payload,'$.run') AS run FROM events WHERE type='doc.updated' AND created >= ?",
  ])
    for (const row of store.all(sql, since)) if (typeof row.run === "string") traced.add(row.run);
  const runs = store
    .all(
      `SELECT r.id,r.employee,r.message,r.parent,r.root,r.task,r.status,r.usage,r.created,r.started,
              CASE WHEN r.status='failed' THEN r.error ELSE '' END AS error,
              m.author AS author, m.kind AS kind, t.reviewer AS reviewer
       FROM runs r LEFT JOIN messages m ON m.id=r.message LEFT JOIN tasks t ON t.id=r.task
       WHERE r.created >= ?`,
      since,
    )
    .map((run) => {
      const { cls, code } = outcomeOf(run.status, run.error);
      // Runs that can be busywork: a review, or a turn another bot's message
      // started outside any task or hand-off. Their product is an action; a
      // task run, a routine's reply or a hand-off's answer is a product itself.
      const review = run.author === "system" && run.kind === "handoff" && Boolean(run.task) && run.reviewer === run.employee;
      const chatter = !run.task && !run.parent && Boolean(run.author) && run.author !== "human" && run.author !== "system";
      const candidate = cls === "ok" && (review || chatter);
      // Only those need their lane (the walk to where the work began costs a few queries).
      const lane = candidate ? laneOf(run) : "";
      return {
        id: run.id,
        employee: run.employee,
        cls,
        code,
        created: run.created,
        started: run.started,
        lane,
        candidate,
        idle: candidate && lane === "autonomous" && !traced.has(run.id),
        tokens: tokensOf(run.usage),
      };
    });
  // Moves on the board: reviews of a lead's work, the review limit, Autopilot
  // restarting a task, and tasks reaching Done.
  const taskEvents = [];
  const done = new Map();
  for (const row of store.all(
    `SELECT a.task,a.author,a.kind,a.body,a.created,t.assignees,t.reviewer FROM task_activity a JOIN tasks t ON t.id=a.task
     WHERE a.kind IN ('status','notice') AND a.created >= ?`,
    since,
  )) {
    const lead = ids(row.assignees)[0];
    if (!lead) continue;
    const by = row.author === "human" ? "owner" : row.author === "system" ? "system" : "bot";
    let type = null;
    if (row.kind === "status" && row.body === "review → done") type = "approved";
    else if (row.kind === "status" && row.body === "review → in_progress") type = "changes";
    else if (row.kind === "notice" && row.body === REVIEW_CAP_NOTE) type = "cap";
    else if (row.kind === "notice" && row.body.startsWith(BOUNCE_NOTE)) type = "bounce";
    if (type) taskEvents.push({ task: row.task, lead, type, by, at: row.created });
    if (row.kind === "status" && row.body.endsWith("→ done")) done.set(row.task, { task: row.task, lead, at: row.created });
  }
  const tokens = new Map();
  if (done.size)
    for (const row of store.all(
      `SELECT task,usage FROM runs WHERE task IN (SELECT a.task FROM task_activity a WHERE a.kind='status' AND a.created >= ? AND a.body LIKE '%→ done')`,
      since,
    ))
      tokens.set(row.task, (tokens.get(row.task) || 0) + tokensOf(row.usage));
  const finishedTasks = [...done.values()].map((task) => ({ ...task, tokens: tokens.get(task.task) || 0 }));
  // Cards stuck for over a day (a snapshot, not a count over the window).
  const dayAgo = new Date(now - DAY_MS).toISOString();
  const stuck = [];
  for (const task of store.all(
    `SELECT t.id,t.status,t.assignees,t.reviewer FROM tasks t JOIN conversations c ON c.id=t.conversation
     WHERE t.status IN ('in_progress','review') AND c.archived=0 AND t.updated < ?
       AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task=t.id AND r.status IN ('queued','running','cancelling'))`,
    dayAgo,
  )) {
    // Left there by an outage (or Any Bot stopping): not the bot's.
    const last = store.one("SELECT status,error FROM runs WHERE task=? ORDER BY rowid DESC LIMIT 1", task.id);
    if (last && outcomeOf(last.status, last.error).cls === "env") continue;
    if (task.status === "in_progress") {
      const lead = ids(task.assignees)[0];
      if (lead) stuck.push({ task: task.id, employee: lead, type: "in_progress" });
    } else if (task.reviewer) {
      const rounds = store.one("SELECT count(*) AS n FROM task_activity WHERE task=? AND kind='review-requested'", task.id).n;
      // At the review limit it's the owner's to decide, not the reviewer's.
      if (rounds < 3) stuck.push({ task: task.id, employee: task.reviewer, type: "review" });
    }
  }
  const approvals = store.all("SELECT employee,status,created AS at FROM approvals WHERE created >= ?", since);
  const stops = store
    .all("SELECT payload,created FROM events WHERE type='run.stopped' AND created >= ?", since)
    .map((row) => ({ employee: payloadOf(row.payload).employee, at: row.created }))
    .filter((row) => typeof row.employee === "string");
  const adjustments = store
    .all("SELECT payload,created FROM events WHERE type IN ('employee.updated','employee.manager') AND created >= ?", since)
    .map((row) => {
      const payload = payloadOf(row.payload);
      return { employee: payload.employeeId || payload.employee, at: row.created };
    })
    .filter((row) => typeof row.employee === "string");
  // Work that starts without the owner: an enabled routine, or a task in a
  // project on Autopilot.
  const assigned = new Set(store.all("SELECT DISTINCT employee FROM routines WHERE enabled=1").map((row) => row.employee));
  for (const row of store.all(
    `SELECT t.assignees FROM tasks t JOIN conversations c ON c.id=t.conversation
     WHERE t.status IN ('backlog','in_progress') AND c.autopilot=1 AND c.archived=0`,
  ))
    for (const person of ids(row.assignees)) assigned.add(person);
  // Queued work held by limits, or waiting over an hour.
  const hourAgo = new Date(now - 3600_000).toISOString();
  const starved = new Set();
  for (const run of store.all("SELECT id,employee,created FROM runs WHERE status='queued'"))
    if (HELD.has(waits.get(run.id)?.reason) || run.created < hourAgo) starved.add(run.employee);
  return {
    now,
    team,
    bots,
    runs,
    taskEvents,
    finishedTasks,
    stuck,
    approvals,
    stops,
    adjustments,
    assigned: [...assigned],
    starved: [...starved],
  };
}

// Metrics -----------------------------------------------------------------------------

const blank = () => ({ runs: 0, started: 0, ok: 0, botFailed: 0, envFailed: 0, unclear: 0, failCodes: {}, launch: 0, tokens: 0, unattended: 0, idleRuns: 0 });
function collect(rows) {
  const since = rows.now - WINDOW_DAYS * DAY_MS;
  const daySince = rows.now - DAY_MS;
  const metrics = new Map(
    rows.bots.map((bot) => [
      bot.id,
      {
        w: {
          ...blank(),
          tasks: 0,
          taskTokens: 0,
          reviews: 0,
          changes: 0,
          ownerChanges: 0,
          caps: 0,
          stops: 0,
          approved: 0,
          denied: 0,
          expired: 0,
          stuck: 0,
          lastRun: null,
        },
        d: blank(),
        adjustments: [],
      },
    ]),
  );
  const inWindow = (at) => {
    const time = Date.parse(at);
    return Number.isFinite(time) && time >= since && time <= rows.now;
  };
  for (const run of rows.runs) {
    const entry = metrics.get(run.employee);
    if (!entry || !inWindow(run.created)) continue;
    const scopes = Date.parse(run.created) >= daySince ? [entry.w, entry.d] : [entry.w];
    for (const m of scopes) {
      if (["ok", "bot", "env", "unclear"].includes(run.cls)) m.runs += 1;
      if (run.started) m.started += 1;
      if (run.cls === "ok") m.ok += 1;
      if (run.cls === "bot") {
        m.botFailed += 1;
        m.failCodes[run.code] = (m.failCodes[run.code] || 0) + 1;
      }
      if (run.cls === "env") m.envFailed += 1;
      if (run.cls === "unclear") m.unclear += 1;
      if (run.code === "launch") m.launch += 1;
      m.tokens += run.tokens || 0;
      if (run.cls === "ok" && run.candidate && run.lane === "autonomous") {
        m.unattended += 1;
        if (run.idle) m.idleRuns += 1;
      }
    }
    if (run.started && (!entry.w.lastRun || run.started > entry.w.lastRun)) entry.w.lastRun = run.started;
  }
  for (const event of rows.taskEvents) {
    const w = metrics.get(event.lead)?.w;
    if (!w || !inWindow(event.at)) continue;
    if (event.type === "approved") w.reviews += 1;
    if (event.type === "changes") {
      w.reviews += 1;
      w.changes += 1;
      if (event.by === "owner") w.ownerChanges += 1;
    }
    if (event.type === "cap") w.caps += 1;
    if (event.type === "bounce") w.stuck += 1;
  }
  for (const task of rows.finishedTasks) {
    const w = metrics.get(task.lead)?.w;
    // Tasks whose runs reported no tokens can't be priced.
    if (!w || !inWindow(task.at) || !(task.tokens > 0)) continue;
    w.tasks += 1;
    w.taskTokens += task.tokens;
  }
  for (const item of rows.stuck) {
    const w = metrics.get(item.employee)?.w;
    if (w) w.stuck += 1;
  }
  for (const approval of rows.approvals) {
    const w = metrics.get(approval.employee)?.w;
    if (!w || !inWindow(approval.at)) continue;
    if (approval.status === "approved") w.approved += 1;
    if (approval.status === "denied") w.denied += 1;
    if (approval.status === "expired") w.expired += 1;
  }
  for (const stop of rows.stops) {
    const w = metrics.get(stop.employee)?.w;
    if (w && inWindow(stop.at)) w.stops += 1;
  }
  for (const adjustment of rows.adjustments) {
    const entry = metrics.get(adjustment.employee);
    const at = Date.parse(adjustment.at);
    if (entry && Number.isFinite(at)) entry.adjustments.push(at);
  }
  for (const { w } of metrics.values()) {
    w.redo = w.ownerChanges + w.stops;
    w.costPerTask = w.tasks ? Math.round(w.taskTokens / w.tasks) : null;
  }
  return metrics;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
// Each bot's peers' median cost per task: bots on the same harness, model and
// effort with enough finished tasks, itself left out.
function peerMedians(bots, metrics) {
  const group = (bot) => `${bot.harness}\u0001${bot.model || ""}\u0001${bot.effort || ""}`;
  const priced = bots.filter((bot) => metrics.get(bot.id).w.tasks >= TASKS);
  const out = new Map();
  for (const bot of priced) {
    const peers = priced.filter((other) => other.id !== bot.id && group(other) === group(bot)).map((other) => metrics.get(other.id).w.costPerTask);
    if (peers.length >= PEERS) out.set(bot.id, median(peers));
  }
  return out;
}

const words = (role) => new Set(String(role || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []);
function overlap(a, b) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared += 1;
  return shared / (x.size + y.size - shared);
}

// The bot's entries in the `count` days of history before `day`, newest
// first; null when any day is missing.
function persisted(history, id, day, count) {
  const byDay = new Map(history.map((entry) => [entry.day, entry]));
  const out = [];
  for (const key of daysBefore(day, count)) {
    const entry = byDay.get(key);
    const bot = entry?.bots?.find((b) => b.id === id);
    if (!bot) return null;
    out.push({ ...bot, team: entry.team });
  }
  return out;
}

// Verdicts ------------------------------------------------------------------------------

function judge(bot, entry, { rows, peers, history, day, bots }) {
  const { w, d } = entry;
  const now = rows.now;
  const reasons = [];
  const scores = {};
  const notes = [];
  let enough = false;
  const add = (code, level, detail) => reasons.push(detail === undefined ? { code, level } : { code, level, detail });
  const rate = (code, k, n) => {
    if (n < MIN_SAMPLE) return null;
    enough = true;
    const lower = wilsonLower(k, n);
    scores[code] = Number(lower.toFixed(4));
    const t = THRESHOLDS[code];
    return t.adjust !== undefined && lower >= t.adjust ? "adjust" : t.watch !== undefined && lower >= t.watch ? "watch" : null;
  };
  const failed = rate("failures", w.botFailed, w.ok + w.botFailed);
  if (failed) {
    const dominant = Object.entries(w.failCodes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    add("failures", failed, dominant);
  }
  const peerMedian = peers.get(bot.id);
  if (peerMedian !== undefined && peerMedian > 0) {
    enough = true;
    w.peerMedian = Math.round(peerMedian);
    const ratio = w.costPerTask / peerMedian;
    scores.cost = Number(ratio.toFixed(4));
    if (ratio > THRESHOLDS.cost.adjust) add("cost", "adjust");
  }
  const rejected = rate("rejections", w.changes, w.reviews);
  if (rejected) add("rejections", rejected);
  if (w.caps >= 1) add("reviewCap", "watch");
  const redone = rate("redo", w.redo, w.ok + w.stops);
  if (redone) add("redo", redone);
  const decided = w.approved + w.denied;
  const declined = decided >= MIN_SAMPLE ? rate("denials", w.denied, decided) : null;
  if (declined === "adjust") add("denials", "adjust");
  else if (w.denied >= THRESHOLDS.denials.watch) add("denials", "watch");
  if (w.stuck >= THRESHOLDS.stuck.watch) add("stuck", "watch");
  if (rate("busywork", w.idleRuns, w.unattended)) add("busywork", "watch");
  if (w.launch >= THRESHOLDS.launch.watch) add("launch", "watch");

  // Reasons in table order; the verdict is the most severe.
  const order = RULES.map((r) => r.code);
  reasons.sort((a, b) => RANK[b.level] - RANK[a.level] || order.indexOf(a.code) - order.indexOf(b.code));
  const raw = reasons.some((r) => r.level === "adjust") ? "adjust" : reasons.length ? "watch" : enough ? "ok" : "insufficient";
  const primary = reasons[0] || null;
  const score = primary && scores[primary.code] !== undefined ? scores[primary.code] : null;

  // Idle only counts when the bot could have worked on its own: Team on, and
  // work assigned to it. Held by limits is a capacity note.
  const eligible = rows.team === "running" && rows.assigned.includes(bot.id);
  const starved = rows.starved.includes(bot.id);
  const idle = eligible && !starved && d.started === 0;
  if (w.started === 0) notes.push(!eligible ? "not-scheduled" : starved ? "starved" : "idle");
  else if (starved) notes.push("starved");

  const recent = entry.adjustments.some((at) => at > now - COOLDOWN_MS && at <= now);
  let verdict = raw;
  let fix = primary ? fixFor(primary) : null;
  if (recent && raw === "adjust") {
    verdict = "watch";
    notes.push("cooldown");
  }
  if (!recent) {
    // (a) Adjust for 14 days, and a change 7 or more days ago didn't help.
    if (raw === "adjust" && score !== null) {
      const past = persisted(history, bot.id, day, HISTORY_DAYS - 1);
      const change = entry.adjustments.filter((at) => at <= now - COOLDOWN_MS && at >= now - WINDOW_DAYS * DAY_MS).sort((a, b) => b - a)[0];
      if (past && past.every((b) => b.raw === "adjust") && change !== undefined) {
        const before = history
          .filter((h) => h.day <= dayKey(change))
          .sort((a, b) => b.day.localeCompare(a.day))
          .map((h) => h.bots?.find((b) => b.id === bot.id))
          .find((b) => b && b.code === primary.code && Number.isFinite(b.score));
        if (before && before.score > 0 && (before.score - score) / before.score < IMPROVED) {
          verdict = "fire";
          reasons.unshift({ code: "fire", level: "fire", detail: "adjusted" });
          fix = { kind: FIXES["fire.adjusted"].kind, key: "fire.adjusted" };
        }
      }
    }
    // (b) Idle with work to do for 14 days, and a teammate in the same role.
    if (verdict !== "fire" && idle) {
      const past = persisted(history, bot.id, day, HISTORY_DAYS - 1);
      const teammate =
        bot.manager &&
        bots.find((other) => other.id !== bot.id && other.manager === bot.manager && overlap(bot.role, other.role) >= OVERLAP);
      if (past && past.every((b) => b.idle === true && b.team === "running") && teammate) {
        verdict = "fire";
        reasons.unshift({ code: "fire", level: "fire", detail: "idle" });
        fix = { kind: FIXES["fire.idle"].kind, key: "fire.idle", detail: teammate.id };
      }
    }
  }
  if (verdict === "ok" || verdict === "insufficient") fix = null;
  return {
    id: bot.id,
    v: verdict,
    raw,
    code: primary?.code || null,
    score,
    idle,
    reasons,
    fix,
    notes,
    m: w,
    d,
  };
}
function fixFor(reason) {
  const key = reason.code === "failures" ? `failures.${reason.detail}` : reason.code;
  const fix = FIXES[key] || FIXES["failures.timeout"];
  return { kind: fix.kind, key: FIXES[key] ? key : "failures.timeout" };
}

// The review: one entry per active bot. `history` holds earlier reviews
// (newest first); one for the same day is replaced, so it isn't used.
export function buildReview(rows, { history = [], slot = null, manual = false } = {}) {
  const now = rows.now;
  const day = dayKey(slot ?? now);
  const earlier = history.filter((entry) => entry && typeof entry.day === "string" && Array.isArray(entry.bots) && entry.day !== day);
  const metrics = collect(rows);
  const peers = peerMedians(rows.bots, metrics);
  const previous = earlier.filter((entry) => entry.day < day).sort((a, b) => b.day.localeCompare(a.day))[0];
  const bots = rows.bots.map((bot) => {
    const judged = judge(bot, metrics.get(bot.id), { rows, peers, history: earlier, day, bots: rows.bots });
    const was = previous?.bots.find((b) => b.id === bot.id)?.v;
    return was ? { ...judged, was } : judged;
  });
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, bots.filter((b) => b.v === v).length]));
  return {
    day,
    at: new Date(now).toISOString(),
    slot,
    late: slot !== null && now - slot > LATE_MS,
    manual,
    team: rows.team,
    counts,
    bots,
  };
}
// The short form kept for the trend: the day and each bot's verdict.
export function reviewSummary(review) {
  return {
    day: review.day,
    at: review.at,
    late: review.late,
    manual: review.manual,
    counts: review.counts,
    verdicts: Object.fromEntries(review.bots.map((b) => [b.id, b.v])),
  };
}

// Words -------------------------------------------------------------------------------------

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tokens = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n || 0)));
export function reasonWords(reason, m, nameOf = () => "a teammate") {
  switch (reason.code) {
    case "failures":
      return `${m.botFailed} of ${m.ok + m.botFailed} runs failed through the bot${reason.detail && FAIL_WORDS[reason.detail] ? `, mostly because it ${FAIL_WORDS[reason.detail]}` : ""}`;
    case "cost":
      return `${tokens(m.costPerTask)} tokens a finished task, ${(m.costPerTask / m.peerMedian).toFixed(1)}× its peers' ${tokens(m.peerMedian)}`;
    case "rejections":
      return `${m.changes} of ${m.reviews} reviews sent its work back`;
    case "reviewCap":
      return `${plural(m.caps, "task")} hit the 3-round review limit`;
    case "redo":
      return `You sent back or stopped ${m.redo} of ${m.ok + m.stops} runs`;
    case "denials":
      return `You declined ${m.denied} of ${m.approved + m.denied} tool requests you answered`;
    case "stuck":
      return `${plural(m.stuck, "card")} stuck for over a day`;
    case "busywork":
      return `${m.idleRuns} of ${m.unattended} reviews and bot-started turns changed nothing`;
    case "launch":
      return `${plural(m.launch, "run")} couldn't start in its folder`;
    case "fire":
      return reason.detail === "idle"
        ? "Had work for 14 days in a row and ran none of it"
        : "At Adjust for 14 days, and its last change didn't help";
    default:
      return String(reason.code);
  }
}
export function fixWords(fix, nameOf = () => "a teammate") {
  if (!fix) return "";
  const text = FIXES[fix.key]?.text || "";
  return text.replaceAll("{teammate}", fix.detail ? nameOf(fix.detail) : "a teammate");
}
export const NOTE_WORDS = Object.freeze({
  cooldown: "Changed in the last 7 days, so held at Watch while that settles",
  idle: "Had work waiting but ran nothing in 14 days",
  starved: "Its work was held by the Team's limits",
  "not-scheduled": "No runs in 14 days, and nothing starts it on its own",
});
export function totalsLine(review) {
  const c = review.counts;
  const when = new Date(review.at).toLocaleString("en-US", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${when}${review.late ? " (ran late)" : ""}: ${c.ok} OK · ${c.watch} Watch · ${c.adjust} Adjust · ${c.fire} Fire candidates · ${c.insufficient} Not enough data`;
}

// The canvas section: a totals line, then a table of flagged bots. Names are
// resolved here, from `people` ({id: {name, manager}}), never stored.
const FLAGGED = new Set(["fire", "adjust", "watch"]);
export function sectionBlocks(review, people = {}) {
  const nameOf = (id) => people[id]?.name || "A former bot";
  const flagged = review.bots
    .filter((b) => FLAGGED.has(b.v) && people[b.id])
    .sort((a, b) => RANK[b.v] - RANK[a.v] || nameOf(a.id).localeCompare(nameOf(b.id)))
    .slice(0, 99);
  const blocks = [
    { type: "p", text: totalsLine(review) },
    { type: "p", text: "Read-only: nothing was changed. Org → People has every bot's numbers and how verdicts are decided." },
  ];
  if (!flagged.length) blocks.push({ type: "p", text: "No bot needs attention today." });
  else
    blocks.push({
      type: "table",
      rows: [
        ["Bot", "Manager", "Verdict", "Why", "Suggested fix"],
        ...flagged.map((b) => [
          nameOf(b.id),
          people[b.id]?.manager || "You",
          `${VERDICT_LABELS[b.v]}${b.was && b.was !== b.v ? ` (was ${VERDICT_LABELS[b.was] || b.was})` : ""}`,
          [...b.reasons.map((r) => reasonWords(r, b.m, nameOf)), ...b.notes.map((note) => NOTE_WORDS[note]).filter(Boolean)].join("; ").slice(0, 480),
          b.fix ? `${FIX_LABELS[b.fix.kind]}: ${fixWords(b.fix, nameOf)}`.slice(0, 480) : "",
        ]),
      ],
    });
  return blocks;
}
