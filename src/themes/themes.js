// Themes are data: token values (OKLCH, the same names as :root in
// style.css), a UI font, and named decoration presets. Built-in themes and,
// later, owner-made themes go through the same validation and apply path.
// Kept free of React and the DOM so it can be unit tested under node:test.

export const TOKENS = [
  "paper",
  "paper-2",
  "paper-3",
  "card",
  "ink",
  "ink-2",
  "ink-3",
  "ink-4",
  "rule",
  "rule-strong",
  "accent",
  "accent-hover",
  "accent-ink",
  "accent-soft",
  "accent-wash",
  "ok",
  "ok-soft",
  "warn",
  "warn-soft",
  "danger",
  "danger-soft",
  "block",
  "block-2",
  "block-rule",
  "block-muted",
  "block-text",
  "block-accent",
  "block-ok",
  "block-error",
  "cat-agent",
  "cat-task",
  "cat-project",
];
// Extra tokens a theme may set for its decorations (translucent surfaces
// that let the backdrop show through, neon colors).
export const DECOR_TOKENS = ["glass", "glass-2", "neon-1", "neon-2", "neon-3"];

// Decoration presets: the only way a theme changes more than colors. A
// custom theme picks from these by name; it can't supply CSS or scripts.
export const DECOR = {
  backdrop: ["none", "rain", "meadow", "grid"],
  chrome: ["none", "terminal", "glass", "neon"],
  bubbles: ["none", "terminal", "leaf", "hologram"],
};

const SANS = '"Segoe UI Variable Text", "Segoe UI", Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const MONO = '"Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", monospace';

export const THEMES = [
  {
    id: "paper",
    name: "Studio paper",
    description: "Warm paper, ink type, one vermilion signal. The default.",
    scheme: "light",
    font: SANS,
    decor: { backdrop: "none", chrome: "none", bubbles: "none" },
    // Mirrors :root in src/style.css (tests keep the two in sync).
    tokens: {
      paper: "oklch(0.968 0.008 85)",
      "paper-2": "oklch(0.945 0.011 82)",
      "paper-3": "oklch(0.915 0.014 80)",
      card: "oklch(0.99 0.004 85)",
      ink: "oklch(0.215 0.01 60)",
      "ink-2": "oklch(0.4 0.014 62)",
      "ink-3": "oklch(0.53 0.016 68)",
      "ink-4": "oklch(0.68 0.016 72)",
      rule: "oklch(0.885 0.014 80)",
      "rule-strong": "oklch(0.8 0.018 78)",
      accent: "oklch(0.56 0.185 35)",
      "accent-hover": "oklch(0.5 0.17 35)",
      "accent-ink": "oklch(0.5 0.17 35)",
      "accent-soft": "oklch(0.9 0.05 40)",
      "accent-wash": "oklch(0.95 0.025 45)",
      ok: "oklch(0.5 0.1 150)",
      "ok-soft": "oklch(0.92 0.04 150)",
      warn: "oklch(0.56 0.12 70)",
      "warn-soft": "oklch(0.93 0.05 85)",
      danger: "oklch(0.47 0.16 28)",
      "danger-soft": "oklch(0.925 0.04 28)",
      block: "oklch(0.225 0.01 60)",
      "block-2": "oklch(0.275 0.012 60)",
      "block-rule": "oklch(0.4 0.012 60)",
      "block-muted": "oklch(0.68 0.015 70)",
      "block-text": "oklch(0.91 0.01 80)",
      "block-accent": "oklch(0.8 0.11 65)",
      "block-ok": "oklch(0.82 0.12 145)",
      "block-error": "oklch(0.72 0.15 28)",
      "cat-agent": "oklch(0.575 0.163 255.5)",
      "cat-task": "oklch(0.671 0.175 40.6)",
      "cat-project": "oklch(0.669 0.141 162.1)",
    },
  },
  {
    id: "matrix",
    name: "Matrix",
    description: "Phosphor green on black, terminal type, and code raining down behind your team.",
    scheme: "dark",
    font: MONO,
    decor: { backdrop: "rain", chrome: "terminal", bubbles: "terminal" },
    tokens: {
      paper: "oklch(0.14 0.02 150)",
      "paper-2": "oklch(0.165 0.026 150)",
      "paper-3": "oklch(0.23 0.04 150)",
      card: "oklch(0.18 0.03 150)",
      ink: "oklch(0.9 0.17 145)",
      "ink-2": "oklch(0.82 0.15 145)",
      "ink-3": "oklch(0.7 0.12 145)",
      "ink-4": "oklch(0.52 0.08 146)",
      rule: "oklch(0.28 0.05 150)",
      "rule-strong": "oklch(0.4 0.08 148)",
      accent: "oklch(0.87 0.21 142)",
      "accent-hover": "oklch(0.8 0.2 142)",
      "accent-ink": "oklch(0.9 0.2 142)",
      "accent-soft": "oklch(0.34 0.09 145)",
      "accent-wash": "oklch(0.21 0.045 148)",
      ok: "oklch(0.86 0.18 145)",
      "ok-soft": "oklch(0.27 0.06 148)",
      warn: "oklch(0.88 0.16 95)",
      "warn-soft": "oklch(0.28 0.05 95)",
      danger: "oklch(0.74 0.19 28)",
      "danger-soft": "oklch(0.27 0.06 28)",
      block: "oklch(0.1 0.015 150)",
      "block-2": "oklch(0.13 0.02 150)",
      "block-rule": "oklch(0.3 0.05 150)",
      "block-muted": "oklch(0.62 0.1 145)",
      "block-text": "oklch(0.9 0.17 145)",
      "block-accent": "oklch(0.9 0.14 100)",
      "block-ok": "oklch(0.88 0.19 145)",
      "block-error": "oklch(0.74 0.19 28)",
      // Validated as a set on this theme's paper (dark band, all pairs, CVD).
      "cat-agent": "oklch(0.64 0.15 250)",
      "cat-task": "oklch(0.65 0.16 60)",
      "cat-project": "oklch(0.64 0.13 180)",
      glass: "oklch(0.14 0.02 150 / 0.7)",
      "glass-2": "oklch(0.165 0.026 150 / 0.8)",
    },
  },
  {
    id: "solarpunk",
    name: "Solarpunk",
    description: "A sunlit valley of orchards, gardens, and harvests, with robots tending the crops.",
    scheme: "light",
    font: '"Segoe UI Variable Display", Candara, "Segoe UI", system-ui, sans-serif',
    decor: { backdrop: "meadow", chrome: "glass", bubbles: "leaf" },
    tokens: {
      paper: "oklch(0.975 0.02 95)",
      "paper-2": "oklch(0.955 0.03 115)",
      "paper-3": "oklch(0.92 0.045 118)",
      card: "oklch(0.99 0.012 95)",
      ink: "oklch(0.28 0.05 160)",
      "ink-2": "oklch(0.4 0.05 160)",
      "ink-3": "oklch(0.5 0.05 155)",
      "ink-4": "oklch(0.66 0.045 150)",
      rule: "oklch(0.9 0.035 120)",
      "rule-strong": "oklch(0.82 0.055 125)",
      accent: "oklch(0.56 0.15 45)",
      "accent-hover": "oklch(0.5 0.14 45)",
      "accent-ink": "oklch(0.5 0.14 45)",
      "accent-soft": "oklch(0.9 0.07 75)",
      "accent-wash": "oklch(0.96 0.04 85)",
      ok: "oklch(0.5 0.12 150)",
      "ok-soft": "oklch(0.93 0.05 150)",
      warn: "oklch(0.54 0.12 75)",
      "warn-soft": "oklch(0.94 0.06 90)",
      danger: "oklch(0.5 0.17 28)",
      "danger-soft": "oklch(0.93 0.04 28)",
      block: "oklch(0.27 0.04 165)",
      "block-2": "oklch(0.31 0.045 165)",
      "block-rule": "oklch(0.43 0.05 165)",
      "block-muted": "oklch(0.72 0.04 150)",
      "block-text": "oklch(0.95 0.02 100)",
      "block-accent": "oklch(0.86 0.13 85)",
      "block-ok": "oklch(0.85 0.13 145)",
      "block-error": "oklch(0.76 0.14 30)",
      "cat-agent": "oklch(0.56 0.14 250)",
      "cat-task": "oklch(0.64 0.16 50)",
      "cat-project": "oklch(0.6 0.12 175)",
      glass: "oklch(0.985 0.02 95 / 0.5)",
      "glass-2": "oklch(0.965 0.03 115 / 0.8)",
    },
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    description: "A rainy neon megacity at night, animated borders, and hologram chat boxes.",
    scheme: "dark",
    font: 'Bahnschrift, "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
    decor: { backdrop: "grid", chrome: "neon", bubbles: "hologram" },
    tokens: {
      paper: "oklch(0.16 0.04 285)",
      "paper-2": "oklch(0.19 0.05 290)",
      "paper-3": "oklch(0.26 0.07 295)",
      card: "oklch(0.2 0.055 290)",
      ink: "oklch(0.96 0.025 250)",
      "ink-2": "oklch(0.86 0.06 240)",
      "ink-3": "oklch(0.72 0.08 250)",
      "ink-4": "oklch(0.56 0.08 270)",
      rule: "oklch(0.32 0.08 300)",
      "rule-strong": "oklch(0.46 0.14 320)",
      accent: "oklch(0.7 0.27 340)",
      "accent-hover": "oklch(0.64 0.26 340)",
      "accent-ink": "oklch(0.8 0.19 340)",
      "accent-soft": "oklch(0.36 0.14 340)",
      "accent-wash": "oklch(0.25 0.08 330)",
      ok: "oklch(0.86 0.2 150)",
      "ok-soft": "oklch(0.3 0.08 160)",
      warn: "oklch(0.9 0.18 100)",
      "warn-soft": "oklch(0.32 0.07 100)",
      danger: "oklch(0.72 0.21 20)",
      "danger-soft": "oklch(0.3 0.09 20)",
      block: "oklch(0.12 0.04 280)",
      "block-2": "oklch(0.16 0.05 285)",
      "block-rule": "oklch(0.36 0.1 300)",
      "block-muted": "oklch(0.66 0.08 250)",
      "block-text": "oklch(0.93 0.05 200)",
      "block-accent": "oklch(0.86 0.15 200)",
      "block-ok": "oklch(0.86 0.2 150)",
      "block-error": "oklch(0.73 0.21 20)",
      "cat-agent": "oklch(0.63 0.14 225)",
      "cat-task": "oklch(0.66 0.15 90)",
      "cat-project": "oklch(0.6 0.25 355)",
      glass: "oklch(0.16 0.04 285 / 0.5)",
      "glass-2": "oklch(0.19 0.05 290 / 0.76)",
      "neon-1": "oklch(0.86 0.15 200)",
      "neon-2": "oklch(0.7 0.27 340)",
      "neon-3": "oklch(0.9 0.18 100)",
    },
  },
];

export const themeById = (id) => THEMES.find((theme) => theme.id === id) || THEMES[0];

// --- Color math (OKLCH → sRGB → WCAG contrast) --------------------------
const OKLCH = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i;
export function parseOklch(value) {
  const match = String(value).trim().match(OKLCH);
  if (!match) return null;
  const l = Number(match[1]) / (match[2] ? 100 : 1);
  const alpha = match[5] === undefined ? 1 : Number(match[5]) / (match[6] ? 100 : 1);
  return { l, c: Number(match[3]), h: Number(match[4]), alpha };
}
export function oklchToSrgb({ l, c, h }) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return linear.map((v) => Math.min(1, Math.max(0, v)));
}
const luminance = (color) => {
  const [r, g, b] = oklchToSrgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(foreground, background) {
  const a = luminance(parseOklch(foreground));
  const b = luminance(parseOklch(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function toHex(value) {
  const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return `#${oklchToSrgb(parseOklch(value))
    .map((v) => Math.round(encode(v) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

// Readability rules every theme must meet (WCAG AA for body text, AAA for
// primary text). A custom theme import will run the same checks.
export const CONTRAST_RULES = [
  ["ink", "paper", 7],
  ["ink", "card", 7],
  ["ink-2", "paper", 4.5],
  ["ink-2", "card", 4.5],
  ["ink-3", "paper", 3],
  ["paper", "ink", 7],
  ["accent-ink", "paper", 4.5],
  ["paper", "accent", 3],
  ["danger", "paper", 4.5],
  ["ok", "paper", 3],
  ["warn", "paper", 3],
  ["block-text", "block", 7],
  ["block-muted", "block", 3],
];

export function validateTheme(theme) {
  const problems = [];
  if (!theme || typeof theme !== "object") return ["A theme must be an object"];
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(theme.id || "")) problems.push("id must be 2–32 lowercase letters, digits, or dashes");
  if (typeof theme.name !== "string" || !theme.name.trim() || theme.name.length > 40) problems.push("name must be 1–40 characters");
  if (!["light", "dark"].includes(theme.scheme)) problems.push('scheme must be "light" or "dark"');
  for (const key of TOKENS) {
    const value = theme.tokens?.[key];
    const color = parseOklch(value);
    if (!color) problems.push(`token ${key} must be an oklch() color`);
    else if (color.alpha < 1) problems.push(`token ${key} must be opaque`);
  }
  for (const key of Object.keys(theme.tokens || {}))
    if (!TOKENS.includes(key) && !DECOR_TOKENS.includes(key)) problems.push(`unknown token ${key}`);
    else if (DECOR_TOKENS.includes(key) && !parseOklch(theme.tokens[key])) problems.push(`token ${key} must be an oklch() color`);
  for (const [slot, allowed] of Object.entries(DECOR))
    if (!allowed.includes(theme.decor?.[slot] ?? "none")) problems.push(`decor.${slot} must be one of ${allowed.join(", ")}`);
  if (problems.length) return problems;
  for (const [fg, bg, min] of CONTRAST_RULES) {
    const ratio = contrast(theme.tokens[fg], theme.tokens[bg]);
    if (ratio < min) problems.push(`${fg} on ${bg} contrast ${ratio.toFixed(2)} is below ${min}`);
  }
  return problems;
}
