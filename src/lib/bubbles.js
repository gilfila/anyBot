// Chat bubble tints. A bot keeps one of these ids as `bubble` in its avatar
// JSON. The bot picks the hue; the theme picks the shade (a pale tint in
// light themes, a deep one in dark themes), so text keeps its contrast in
// every theme. tests/bubbles.test.mjs checks every hue against every theme.
export const bubbleColors = [
  { id: "auto", name: "Match robot" },
  { id: "plain", name: "Plain", hue: 90, strength: 0 },
  { id: "sky", name: "Sky", hue: 230 },
  { id: "mint", name: "Mint", hue: 170 },
  { id: "sage", name: "Sage", hue: 135 },
  { id: "sand", name: "Sand", hue: 85 },
  { id: "peach", name: "Peach", hue: 50 },
  { id: "rose", name: "Rose", hue: 10 },
  { id: "lilac", name: "Lilac", hue: 305 },
  { id: "slate", name: "Slate", hue: 255, strength: 0.45 },
];

// "Match robot" follows the robot's pulse color.
const robotHues = { cobalt: 265, coral: 35, citron: 115, violet: 295 };

// Shade per color scheme; style.css mirrors these as --bubble-* on :root.
export const BUBBLE_SHADES = {
  light: { l: 0.965, c: 0.045, edgeL: 0.86, edgeC: 0.07 },
  dark: { l: 0.25, c: 0.045, edgeL: 0.42, edgeC: 0.08 },
};

export function bubbleTint(bubble, robotColor) {
  const choice = bubbleColors.find((color) => color.id === bubble && color.id !== "auto");
  if (choice) return { hue: choice.hue, strength: choice.strength ?? 1 };
  return { hue: robotHues[robotColor] ?? 90, strength: robotHues[robotColor] === undefined ? 0 : 1 };
}

// Custom properties for a bot's message; the CSS turns them into colors.
export function bubbleStyle(bubble, robotColor) {
  const { hue, strength } = bubbleTint(bubble, robotColor);
  return { "--bubble-h": hue, "--bubble-k": strength };
}

// The rendered background for a scheme, as an oklch() string (for tests
// and anything drawn outside CSS).
export function bubbleBackground(bubble, robotColor, scheme = "light") {
  const { hue, strength } = bubbleTint(bubble, robotColor);
  const shade = BUBBLE_SHADES[scheme] || BUBBLE_SHADES.light;
  return `oklch(${shade.l} ${+(shade.c * strength).toFixed(4)} ${hue})`;
}
