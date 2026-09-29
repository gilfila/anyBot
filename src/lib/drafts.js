// Unsent composer text, one per conversation, so opening another chat (or
// clicking the one you're in) never throws a message away. Kept in memory and
// mirrored to localStorage; storage that fails or holds junk is ignored.
const KEY = "anybot-drafts";
const MAX_DRAFTS = 50;
const MAX_TEXT = 20_000;

export function withDraft(drafts, conversationId, text) {
  if (!conversationId) return drafts;
  const value = String(text || "");
  if ((drafts[conversationId] || "") === value) return drafts;
  const next = { ...drafts };
  if (value) next[conversationId] = value;
  else delete next[conversationId];
  return next;
}

export function loadDrafts(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) || "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter(([, text]) => typeof text === "string" && text));
  } catch {
    return {};
  }
}

export function saveDrafts(drafts, storage = globalThis.localStorage) {
  try {
    const kept = Object.entries(drafts).slice(-MAX_DRAFTS).map(([id, text]) => [id, text.slice(0, MAX_TEXT)]);
    storage?.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Private mode or a full quota: drafts still last while the app is open.
  }
}
