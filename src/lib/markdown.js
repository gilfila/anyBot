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
export function renderMarkdownInline(text) {
  const parked = [];
  const park = (html) => `\u0000${parked.push(html) - 1}\u0000`;
  let result = escapeHtml(text);
  result = result.replace(INLINE_CODE_PATTERN, (_, code) => park(`<code>${code}</code>`));
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

