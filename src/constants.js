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
    harness: "gemini",
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
  gemini: "Gemini CLI",
  hermes: "Hermes Agent",
  cursor: "Cursor Agent CLI",
};
export const customModelValue = "__anybot_custom_model__";

export const avatarColors = [
  { id: "peach", name: "Peach", fill: "#f5d4c0", stroke: "#c9956d", accent: "#e87b3a" },
  { id: "blue", name: "Blue", fill: "#c5ddf7", stroke: "#5b9bd5", accent: "#2e7dd1" },
  { id: "purple", name: "Purple", fill: "#ddd0f0", stroke: "#9b7bc4", accent: "#7c4dbd" },
  { id: "green", name: "Green", fill: "#c8e6c8", stroke: "#6aad6a", accent: "#3d9140" },
  { id: "coral", name: "Coral", fill: "#f9caca", stroke: "#e06b6b", accent: "#d93636" },
  { id: "mint", name: "Mint", fill: "#b8ece0", stroke: "#4dbf9a", accent: "#1fa578" },
  { id: "lavender", name: "Lavender", fill: "#e0d0f5", stroke: "#a882d9", accent: "#8b52cf" },
  { id: "gold", name: "Gold", fill: "#f7e8b8", stroke: "#d4a628", accent: "#c99000" },
  { id: "sky", name: "Sky", fill: "#c0e4f7", stroke: "#5db0e0", accent: "#1a94d1" },
  { id: "rose", name: "Rose", fill: "#f9c8dc", stroke: "#e06b9a", accent: "#d93670" },
];

export const avatarHeadStyles = [
  { id: "dome", name: "Dome", description: "Rounded helmet shape" },
  { id: "square", name: "Square", description: "Boxy robot head" },
  { id: "hexagon", name: "Hexagon", description: "Angular hex shape" },
  { id: "visor", name: "Visor", description: "Wide visor style" },
  { id: "bubble", name: "Bubble", description: "Spherical bubble head" },
  { id: "angular", name: "Angular", description: "Sharp geometric design" },
];

export const avatarEyeStyles = [
  { id: "round", name: "Round", description: "Classic round robot eyes" },
  { id: "oval", name: "Oval", description: "Tall oval eye sensors" },
  { id: "visor", name: "Visor", description: "Single visor display" },
  { id: "led", name: "LED", description: "Rectangular LED panels" },
  { id: "dots", name: "Dots", description: "Small dot sensors" },
  { id: "slits", name: "Slits", description: "Wide horizontal slits" },
];

export const avatarShapes = avatarHeadStyles;
export const avatarFaces = avatarEyeStyles;
