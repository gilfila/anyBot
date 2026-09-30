// Org → People (the daily people review, runtime/people-review.mjs): one row
// per bot from the latest review, with names from the roster, and sorting.
// Pure, so node:test can run it (tests/people-ui.test.mjs).
import { FIX_LABELS, NOTE_WORDS, VERDICT_LABELS, fixWords, reasonWords, verdictRank } from "../../runtime/people-review.mjs";

// Every active bot: the ones the latest review judged, then any added since.
export function peopleRows(latest, employees = []) {
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  const nameOf = (id) => byId.get(id)?.name || "a teammate";
  const reviewed = (latest?.bots || [])
    .filter((bot) => byId.has(bot.id) && !byId.get(bot.id).archived)
    .map((bot) => {
      const m = bot.m || {};
      const ended = (m.ok || 0) + (m.botFailed || 0);
      return {
        id: bot.id,
        employee: byId.get(bot.id),
        name: nameOf(bot.id),
        v: bot.v,
        rank: verdictRank(bot.v),
        label: VERDICT_LABELS[bot.v] || bot.v,
        was: bot.was && bot.was !== bot.v ? VERDICT_LABELS[bot.was] || bot.was : null,
        runs: m.runs ?? 0,
        today: bot.d?.runs ?? 0,
        failRate: ended ? (m.botFailed || 0) / ended : null,
        // Counts, since the verdict judges the rate's low end, not the rate.
        failed: ended ? `${m.botFailed || 0} of ${ended}` : null,
        cost: m.costPerTask ?? null,
        reviews: m.reviews ?? 0,
        sentBack: m.changes ?? 0,
        redo: m.redo ?? 0,
        stuck: m.stuck ?? 0,
        reasons: (bot.reasons || []).map((reason) => reasonWords(reason, m, nameOf)),
        notes: (bot.notes || []).map((note) => NOTE_WORDS[note]).filter(Boolean),
        fix: bot.fix ? { kind: FIX_LABELS[bot.fix.kind] || bot.fix.kind, text: fixWords(bot.fix, nameOf) } : null,
      };
    });
  const seen = new Set(reviewed.map((row) => row.id));
  const added = employees
    .filter((employee) => !employee.archived && !seen.has(employee.id))
    .map((employee) => ({
      id: employee.id,
      employee,
      name: employee.name,
      v: null,
      rank: -1,
      label: "Not reviewed yet",
      was: null,
      runs: null,
      today: null,
      failRate: null,
      failed: null,
      cost: null,
      reviews: null,
      sentBack: null,
      redo: null,
      stuck: null,
      reasons: [],
      notes: [],
      fix: null,
    }));
  return [...reviewed, ...added];
}

// Sort keys: the verdict (worst first when descending), the name, or a
// number, where a blank sorts last either way. Ties go by name.
const NUMBERS = { runs: "runs", failures: "failRate", cost: "cost", sentBack: "sentBack", redo: "redo", stuck: "stuck" };
export function sortPeople(rows, key = "verdict", dir = "desc") {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a, b) => a.name.localeCompare(b.name);
  return [...rows].sort((a, b) => {
    if (key === "name") return sign * byName(a, b);
    if (key === "verdict") return sign * (a.rank - b.rank) || byName(a, b);
    const field = NUMBERS[key] || "runs";
    const x = a[field];
    const y = b[field];
    if (x === null || x === undefined) return y === null || y === undefined ? byName(a, b) : 1;
    if (y === null || y === undefined) return -1;
    return sign * (x - y) || byName(a, b);
  });
}

// A bot's verdict on each reviewed day, oldest first (null: not reviewed then).
export function trendOf(history = [], id) {
  return [...history]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((entry) => ({ day: entry.day, v: entry.verdicts?.[id] ?? null }));
}
