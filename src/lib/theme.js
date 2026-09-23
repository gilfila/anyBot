import { useSyncExternalStore } from "react";
import { DECOR_TOKENS, TOKENS, themeById } from "../themes/themes.js";

// The active theme lives on <html>: token overrides as inline custom
// properties, decoration presets as data attributes that themes.css keys
// off. The choice is a per-computer preference kept in localStorage.
const THEME_KEY = "anybot-theme";
const MOTION_KEY = "anybot-motion";
const listeners = new Set();
let state = { theme: themeById("paper"), motion: "on" };

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private storage can be unavailable; the choice then lasts this session.
  }
};
const publish = () => listeners.forEach((listener) => listener());

export function applyTheme(theme, root = document.documentElement) {
  for (const key of [...TOKENS, ...DECOR_TOKENS]) root.style.removeProperty(`--${key}`);
  // Studio paper is the stylesheet default; other themes override tokens.
  if (theme.id !== "paper") for (const [key, value] of Object.entries(theme.tokens)) root.style.setProperty(`--${key}`, value);
  root.style.setProperty("--font-ui", theme.font);
  root.style.colorScheme = theme.scheme;
  // Scheme-dependent shades (chat bubbles) key off this.
  root.dataset.scheme = theme.scheme;
  root.dataset.theme = theme.id;
  root.dataset.backdrop = theme.decor.backdrop || "none";
  root.dataset.chrome = theme.decor.chrome || "none";
  root.dataset.bubbles = theme.decor.bubbles || "none";
}

export function initTheme() {
  state = { theme: themeById(read(THEME_KEY, "paper")), motion: read(MOTION_KEY, "on") === "off" ? "off" : "on" };
  applyTheme(state.theme);
  document.documentElement.dataset.motion = state.motion;
}
export function setTheme(id) {
  const theme = themeById(id);
  write(THEME_KEY, theme.id);
  state = { ...state, theme };
  applyTheme(theme);
  publish();
}
export function setMotion(value) {
  const motion = value === "off" ? "off" : "on";
  write(MOTION_KEY, motion);
  state = { ...state, motion };
  document.documentElement.dataset.motion = motion;
  publish();
}
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useThemeState = () => useSyncExternalStore(subscribe, () => state);

// Decorative animation runs only when the owner allows it and the OS
// doesn't ask for reduced motion.
export function prefersStill(motion) {
  return motion === "off" || (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}
