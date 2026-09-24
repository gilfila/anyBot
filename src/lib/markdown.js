// Inline markdown for employee output. Kept free of React so it can be unit
// tested under node:test (see tests/markdown.test.mjs).
const INLINE_CODE_PATTERN = /`([^`]+)`/g;
const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g;
const ITALIC_PATTERN = /\*([^*]+)\*/g;
const SAFE_LINK_PATTERN = /^(https?:|mailto:)/i;
// Runs on escaped text, so stop at escaped quotes/brackets as well as spaces.
const BARE_URL_PATTERN = /\bhttps?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s<])+/g;
const TRAILING_URL_PUNCTUATION = /[.,:;!?)\]]+$/;

// GFM tables: a header row of pipes, a --- rule, then body rows. The
// runtime keeps its own copy in runtime/docs.mjs (it can't import src/).
export const TABLE_ROW = /^\s*\|.*\|\s*$/;
export const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
export function tableCells(line) {
  const cells = [];
  let cell = "";
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") {
      cell += "|";
      i += 1;
    } else if (body[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += body[i];
  }
  cells.push(cell.trim());
  return cells;
}

export function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Employee output is untrusted (it can echo web pages, files, or prompt
// injections), so escape first and only then add the markdown we render.
// Code spans and links are parked in placeholders so later patterns cannot
// reach inside them.
// Doc pages link tasks, employees, and files with @[label](kind:id) tokens.
const MENTION_PATTERN = /@\[([^\]\n]{1,80})\]\((task|agent|file):([A-Za-z0-9-]{6,64})\)/g;

// A formatting bug must not blank a message: fall back to escaped text and
// tell the host (main.jsx wires this to the diagnostics log).
let renderErrorHandler = () => {};
export function onRenderError(handler) {
  renderErrorHandler = typeof handler === "function" ? handler : () => {};
}
export function renderMarkdownInline(text, options) {
  try {
    return renderInline(text, options);
  } catch (error) {
    try {
      renderErrorHandler(error);
    } catch {
      // The fallback below still renders.
    }
    return escapeHtml(String(text ?? ""));
  }
}

// "@Name" for any of `people` (bot names), matched like runtime/mentions.mjs:
// not inside a word or an email address, and the longest name wins.
let peopleCache = { key: null, pattern: null };
function peoplePattern(people) {
  const key = people.join("\u0001");
  if (peopleCache.key !== key) {
    const names = [...new Set(people.map((name) => escapeHtml(String(name || "").trim())).filter(Boolean))]
      .sort((a, b) => b.length - a.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    peopleCache = {
      key,
      pattern: names.length ? new RegExp(`(^|[^\\p{L}\\p{N}_@])@(${names.join("|")})(?![\\p{L}\\p{N}_])`, "giu") : null,
    };
  }
  return peopleCache.pattern;
}

function renderInline(text, { mentions = false, people = [] } = {}) {
  const parked = [];
  const park = (html) => `\u0000${parked.push(html) - 1}\u0000`;
  let result = escapeHtml(text);
  result = result.replace(INLINE_CODE_PATTERN, (_, code) => park(`<code>${code}</code>`));
  const named = people.length ? peoplePattern(people) : null;
  if (named) result = result.replace(named, (_, lead, name) => lead + park(`<span class="mention mention-agent">@${name}</span>`));
  if (mentions)
    result = result.replace(MENTION_PATTERN, (_, label, kind, ref) =>
      park(`<span class="mention mention-${kind}" data-mention="${kind}:${ref}">@${label}</span>`),
    );
  result = result.replace(LINK_PATTERN, (match, label, href) =>
    SAFE_LINK_PATTERN.test(href)
      ? park(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)
      : label,
  );
  result = result.replace(BARE_URL_PATTERN, (match) => {
    const trailing = match.match(TRAILING_URL_PUNCTUATION)?.[0] || "";
    const href = match.slice(0, match.length - trailing.length);
    return park(`<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`) + trailing;
  });
  result = result.replace(BOLD_PATTERN, "<strong>$1</strong>");
  result = result.replace(ITALIC_PATTERN, "<em>$1</em>");
  return result.replace(/\u0000(\d+)\u0000/g, (_, index) => parked[Number(index)]);
}

