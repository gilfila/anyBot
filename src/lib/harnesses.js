const DAY = 24 * 60 * 60 * 1000;

// Failed runs of bots on this harness in the last week, newest first: the
// problems a harness has had in practice, next to what its config says.
export function recentHarnessFailures(harnessId, runs = [], employees = [], now = Date.now()) {
  const bots = new Map(employees.filter((e) => e.harness === harnessId).map((e) => [e.id, e]));
  return runs
    .filter((r) => bots.has(r.employee) && r.status === "failed" && r.ended && now - Date.parse(r.ended) < 7 * DAY)
    .sort((a, b) => Date.parse(b.ended) - Date.parse(a.ended))
    .map((r) => ({ id: r.id, bot: bots.get(r.employee).name, ended: r.ended, error: String(r.error || "The run failed.") }));
}
