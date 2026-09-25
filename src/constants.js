export const presets = [
  {
    name: "Alex",
    role: "Chief of staff",
    harness: "claude",
    summary: "Turn a big objective into a clear plan and coordinate the team.",
    color: "peach",
  },
  {
    name: "Morgan",
    role: "Software engineer",
    harness: "codex",
    summary:
      "Build, investigate, and turn technical ideas into working software.",
    color: "blue",
  },
  {
    name: "Sage",
    role: "Research analyst",
    harness: "antigravity",
    summary:
      "Explore questions, compare options, and bring back useful findings.",
    color: "purple",
  },
  {
    name: "Robin",
    role: "Operations specialist",
    harness: "hermes",
    summary: "Take on repeatable work and keep the details moving.",
    color: "green",
  },
];
export const names = {
  claude: "Claude Code",
  codex: "Codex CLI",
  antigravity: "Antigravity CLI",
  hermes: "Hermes Agent",
  cursor: "Cursor Agent CLI",
};
export const customModelValue = "__anybot_custom_model__";

export { avatarColors, avatarHeadStyles, avatarEyeStyles, avatarHeadStyles as avatarShapes, avatarEyeStyles as avatarFaces } from "./lib/avatar-config.js";
