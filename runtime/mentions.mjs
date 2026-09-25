// @mentions: which bots a message is talking to. Shared by the coordinator
// (who gets activated) and the composer (autocomplete and highlighting).
//
// A mention is "@" at the start of the text or after a non-word character
// (so tony@example.com is not one), followed by a bot's name, matched
// case-insensitively and ending before a letter or digit. Names may contain
// spaces ("Sage Two"); the longest name that fits wins. Mentions inside code
// (fenced or inline) and quoted lines ("> …") don't count: a bot quoting
// "@Alex said…" or showing example syntax shouldn't start anyone.
const WORD = /[\p{L}\p{N}_]/u;

export function withoutQuotedText(text) {
  return String(text || "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/~~~[\s\S]*?(~~~|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/^[ \t]*>.*$/gm, " ")
    .replace(/^(?: {4}|\t).*$/gm, " ");
}

export function mentionedIds(text, bots) {
  const body = withoutQuotedText(text);
  const lower = body.toLowerCase();
  const candidates = bots.filter((b) => b && b.name).sort((a, b) => b.name.length - a.name.length);
  const found = [];
  for (let at = body.indexOf("@"); at !== -1; at = body.indexOf("@", at + 1)) {
    if (at > 0 && (WORD.test(body[at - 1]) || body[at - 1] === "@")) continue;
    const rest = lower.slice(at + 1);
    const bot = candidates.find((b) => rest.startsWith(b.name.toLowerCase()) && !WORD.test(rest.charAt(b.name.length)));
    if (bot && !found.includes(bot.id)) found.push(bot.id);
  }
  return found;
}

// The "@query" being typed right before the caret, if any, for the
// autocomplete menu. Returns { start, query } (start is the "@" index).
export function mentionQuery(text, caret) {
  const before = String(text || "").slice(0, caret);
  const match = before.match(/(^|[^\p{L}\p{N}_@])@([^\s@][^@\n]{0,30})?$/u);
  if (!match) return null;
  return { start: caret - (match[2] || "").length - 1, query: match[2] || "" };
}

// Bots whose name starts with the query (then contains it), for the menu.
export function mentionMatches(query, bots) {
  const q = String(query || "").toLowerCase();
  const starts = bots.filter((b) => b.name.toLowerCase().startsWith(q));
  const contains = bots.filter((b) => !starts.includes(b) && b.name.toLowerCase().includes(q));
  return [...starts, ...contains];
}
