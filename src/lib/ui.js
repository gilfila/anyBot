export const empty = {
  employees: [],
  conversations: [],
  messages: [],
  runs: [],
  routines: [],
  artifacts: [],
  tasks: [],
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
