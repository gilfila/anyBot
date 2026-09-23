import { bubbleColors } from "./bubbles.js";

// Storage stays compatible with the employee.avatar JSON field.
export const avatarColors = [
  { id: "cobalt", name: "Cobalt", fill: "#3864F4", css: "var(--bot-cobalt)" },
  { id: "coral", name: "Coral", fill: "#F46B4E", css: "var(--bot-coral)" },
  { id: "citron", name: "Citron", fill: "#D2E64A", css: "var(--bot-citron)" },
  { id: "violet", name: "Violet", fill: "#9B83ED", css: "var(--bot-violet)" },
];
export const avatarHeadStyles = [
  {
    id: "scout",
    name: "Scout",
    description: "Your expressive little teammate",
  },
  { id: "orbit", name: "Orbit", description: "A floating companion" },
  { id: "tinker", name: "Tinker", description: "A hands-on maker" },
];
export const avatarEyeStyles = [
  { id: "open", name: "Curious" },
  { id: "focused", name: "Focused" },
  { id: "bright", name: "Friendly" },
];
const oldColors = {
  peach: "coral",
  blue: "cobalt",
  purple: "violet",
  green: "citron",
  mint: "citron",
  lavender: "violet",
  gold: "citron",
  sky: "cobalt",
  rose: "coral",
};
const oldShapes = {
  dome: "scout",
  square: "tinker",
  hexagon: "tinker",
  visor: "orbit",
  bubble: "orbit",
  angular: "tinker",
};
const oldFaces = {
  round: "open",
  oval: "open",
  visor: "focused",
  led: "focused",
  dots: "open",
  slits: "focused",
};
const harnessColors = {
  claude: "coral",
  codex: "cobalt",
  gemini: "violet",
  hermes: "citron",
  cursor: "violet",
};

function hash(name) {
  let n = 0;
  for (const c of String(name || "bot"))
    n = ((n << 5) - n + c.charCodeAt(0)) | 0;
  return Math.abs(n);
}
function pick(value, choices, aliases, fallback) {
  const mapped = Object.hasOwn(aliases, value) ? aliases[value] : value;
  return choices.some(({ id }) => id === mapped) ? mapped : fallback;
}
export function parseAvatarConfig(value, name = "bot", harness) {
  let parsed;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    /* legacy free text */
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    parsed = {};
  const seed = hash(name);
  return {
    version: 2,
    color: pick(
      parsed.color,
      avatarColors,
      oldColors,
      harnessColors[harness] || avatarColors[seed % 4].id,
    ),
    shape: pick(
      parsed.shape,
      avatarHeadStyles,
      oldShapes,
      avatarHeadStyles[seed % 3].id,
    ),
    face: pick(parsed.face, avatarEyeStyles, oldFaces, "open"),
    // Chat bubble tint (src/lib/bubbles.js); "auto" matches the robot.
    bubble: pick(parsed.bubble, bubbleColors, {}, "auto"),
  };
}
export function stringifyAvatarConfig(config) {
  return JSON.stringify(parseAvatarConfig(config));
}

// Assistant replies are final run output; task/handoff/system messages are not.
// Use conversation order (also used by App's unread dots), not wall-clock guesses.
export function employeeAvatarStates(
  { employees = [], messages = [], runs = [] },
  lastSeen = {},
  openConversation = null,
) {
  const states = Object.fromEntries(employees.map((e) => [e.id, "idle"]));
  const byConversation = new Map();
  for (const message of messages) {
    if (!byConversation.has(message.conversation))
      byConversation.set(message.conversation, []);
    byConversation.get(message.conversation).push(message);
  }
  for (const [id, list] of byConversation) {
    if (id === openConversation) continue;
    const seen = list.findIndex((m) => m.id === lastSeen?.[id]);
    for (const m of list.slice(seen + 1)) {
      if (m.kind === "assistant" && Object.hasOwn(states, m.author))
        states[m.author] = "unread";
    }
  }
  const latest = new Map();
  for (const run of runs) latest.set(run.employee, run);
  for (const [id, run] of latest) {
    if (["failed", "cancelled"].includes(run.status)) states[id] = "idle";
  }
  // Queued/cancelling suppress the completed-work greeting. Any running job wins,
  // even if another queued job for that employee appears later in the snapshot.
  for (const run of runs)
    if (["queued", "cancelling"].includes(run.status))
      states[run.employee] = "idle";
  for (const run of runs)
    if (run.status === "running") states[run.employee] = "working";
  for (const employee of employees)
    if (employee.archived) states[employee.id] = "idle";
  return states;
}

export function avatarPose(activity) {
  return activity === "working"
    ? { yaw: (-55 * Math.PI) / 180, hologram: 1, wave: false }
    : activity === "unread"
      ? { yaw: 0, hologram: 0, wave: true }
      : { yaw: (-30 * Math.PI) / 180, hologram: 0, wave: false };
}
