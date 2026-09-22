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
  { id: "peach", name: "Peach", fill: "#f8e5d9", stroke: "#e8c4aa", accent: "#d4a484" },
  { id: "blue", name: "Blue", fill: "#dfeafa", stroke: "#b5cff0", accent: "#89afd8" },
  { id: "purple", name: "Purple", fill: "#ede5f7", stroke: "#d4c4eb", accent: "#b8a1d8" },
  { id: "green", name: "Green", fill: "#e4efe4", stroke: "#bfd9bf", accent: "#9bc49b" },
  { id: "coral", name: "Coral", fill: "#fce4e4", stroke: "#f0b8b8", accent: "#e89999" },
  { id: "mint", name: "Mint", fill: "#e0f5ef", stroke: "#b3e0d2", accent: "#7fc9b5" },
  { id: "lavender", name: "Lavender", fill: "#f0e8f8", stroke: "#d9c8f0", accent: "#c4a8e8" },
  { id: "gold", name: "Gold", fill: "#faf3e0", stroke: "#e8d5a8", accent: "#d4b870" },
  { id: "sky", name: "Sky", fill: "#e8f4fc", stroke: "#bde0f5", accent: "#8cc8eb" },
  { id: "rose", name: "Rose", fill: "#fce8f0", stroke: "#f0c0d8", accent: "#e898b8" },
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
