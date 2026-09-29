export const empty = {
  employees: [],
  conversations: [],
  messages: [],
  runs: [],
  routines: [],
  artifacts: [],
  tasks: [],
  docs: [],
  reportsUnread: 0,
  harnesses: [],
  runtime: { paused: false, active: 0 },
  update: null,
};
export const time = (date) =>
  new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const ACTIONABLE_UPDATE_STATES = new Set([
  "available",
  "checking",
  "downloading",
  "downloaded",
  "error",
]);

export function shouldShowUpdateChrome(update) {
  if (!update) return false;
  const state = update.state;
  if (!state) return false;
  return ACTIONABLE_UPDATE_STATES.has(state);
}

// Bots with a run in progress: what restarting for an update, or quitting,
// would stop (queued work waits and starts after the restart).
export function workingBots(data) {
  const names = new Map(data.employees.map((employee) => [employee.id, employee.name]));
  return [
    ...new Set(
      data.runs
        .filter((run) => run.status === "running" || run.status === "cancelling")
        .map((run) => names.get(run.employee) || "A bot"),
    ),
  ];
}
