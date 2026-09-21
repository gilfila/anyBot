export const empty = {
  employees: [],
  conversations: [],
  messages: [],
  runs: [],
  routines: [],
  artifacts: [],
  harnesses: [],
  runtime: { paused: false, active: 0 },
};
export const time = (date) =>
  new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
