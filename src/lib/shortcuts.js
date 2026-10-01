// App-wide keyboard shortcuts, listed in Settings and in the matching
// buttons' tooltips. Chosen to clash with nothing Electron's default menu or
// the text fields already use (Ctrl+Z/X/C/V/A, Ctrl+R, Ctrl+W, Ctrl+Enter in
// the canvas). Pure, so node:test can run it (tests/shortcuts.test.mjs).
export const SHORTCUTS = [
  { action: "search", keys: "Ctrl+K", label: "Search bots and projects (Enter opens the first match)" },
  { action: "approval", keys: "Ctrl+Shift+A", label: "Go to the next request waiting for your approval" },
  { action: "sidebar", keys: "Ctrl+B", label: "Show or hide the sidebar" },
  { action: null, keys: "Esc", label: "Close a dialog, a menu, or the open task" },
];

export const shortcutKeys = (action) => SHORTCUTS.find((item) => item.action === action)?.keys || "";

// The action a keydown event asks for, or null. Ctrl or ⌘; never with Alt,
// so AltGr characters on international keyboards type as usual.
export function shortcutFor(event) {
  if (!event || !(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = String(event.key || "").toLowerCase();
  if (event.shiftKey) return key === "a" ? "approval" : null;
  if (key === "k") return "search";
  if (key === "b") return "sidebar";
  return null;
}

// A keydown listener for something that closes on Esc (the HTML preview,
// the open task, the bot menu). It marks the key as used, so the voice
// chat's own Esc (src/lib/voice.js voiceKey) leaves the voice chat running.
// `skip(event)`: an Esc this layer leaves alone (its own text fields).
export function closeOnEscape(close, { skip } = {}) {
  return (event) => {
    if (event.key !== "Escape" || skip?.(event)) return;
    event.preventDefault();
    close();
  };
}

// The pending approval to show next: the oldest one after `current` (the
// one on screen), wrapping around, so pressing again steps through them.
export function nextApproval(approvals = [], current = null) {
  const pending = approvals
    .filter((approval) => approval.status === "pending")
    .sort((a, b) => String(a.created).localeCompare(String(b.created)));
  if (!pending.length) return null;
  const index = pending.findIndex((approval) => approval.id === current);
  return pending[(index + 1) % pending.length];
}
