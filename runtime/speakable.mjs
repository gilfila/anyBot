// What a bot's reply sounds like read aloud (desktop voice chat; the phone
// reuses it in V2). Pure, so node:test, the renderer and the mobile app can
// all import it.
//
// Dropped: Any Bot's machine blocks (anybot, anybot-actions,
// anybot-artifacts), every other code block, tables, HTML tags, images,
// rules. Kept as words: link text, emphasis and headings without their
// marks, list items and quotes as sentences. A bare URL is read as "the
// link" and a file path as its file name. Then up to about 600 characters,
// cut at the end of a sentence, and "The rest is in the chat."
//
// Replies are bot output of any size, and this runs on the window's main
// thread: only the first READ_LIMIT characters are looked at (plenty for
// 600 spoken ones), and no pattern below rescans a long line from every
// position.

export const SPEAK_LIMIT = 600;
export const READ_LIMIT = 8000;
export const REST_OF_IT = "The rest is in the chat.";
export const ONLY_DETAILS = "The details are in the chat.";

// A fence left open runs to the end of the reply.
const FENCE = /^([ \t]*)(`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?(?:\n[ \t]*\2[^\n]*|(?![\s\S]))|(?![\s\S]))/gm;
const URL = /\b(?:https?|ftp|file):\/\/[^\s<>()"'`]+|\bwww\.[^\s<>()"'`]+/gi;
const PATHS = [
  // C:\x or C:/x
  /[A-Za-z]:[\\/][^\s"'`<>|*?]*/g,
  // \\server\share\x
  /\\\\[^\s\\"'`<>|]+\\[^\s"'`<>|*?]*/g,
  // ~/x/y and /x/y (at least two parts)
  /(?<![\w.])~?\/(?:[\w.-]+\/)+[\w.-]*/g,
  // ./x and ../x
  /(?<![\w.])\.{1,2}[\\/][^\s"'`<>|*?]*/g,
  // src/app.js, docs/voice.md: a relative path that ends in a file name
  /(?<![\w.:/\\-])[\w.-]+(?:\/[\w.-]+)*\/[\w-]+\.[A-Za-z][A-Za-z0-9]{0,5}\b/g,
  // What's left of a path with spaces in it (C:\My Files\a.txt). Whole
  // tokens only: from any position it would rescan the rest of a long one.
  /(?<!\S)\S*\\\S+/g,
];
// Not after e.g., Mr. and the like.
const SENTENCE_END = /(?<!\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|St|No|approx)\.)(?<=[.!?…]["')\]]?)\s+(?=\S)/i;

// The last part of a path, without trailing punctuation, or "the folder".
function fileName(path) {
  const trail = /[.,;:!?)]+$/.exec(path)?.[0] || "";
  const bare = trail ? path.slice(0, -trail.length) : path;
  const name = bare.split(/[\\/]/).filter(Boolean).at(-1) || "";
  return `${name && !/^[A-Za-z]:$/.test(name) ? name : "the folder"}${trail}`;
}
const looksLikePath = (text) => PATHS.slice(0, 5).some((re) => new RegExp(`^${re.source}$`).test(text.trim()));
const withStop = (line) => (/[.!?…:;]["')\]]?$/.test(line) ? line : `${line}.`);

// Markdown to plain lines: headings, list items and paragraph lines.
function plainLines(markdown) {
  let text = String(markdown || "").replace(/\r\n?/g, "\n");
  let dropped = false;
  text = text.replace(FENCE, () => {
    dropped = true;
    return "\n";
  });
  const lines = [];
  for (let line of text.split("\n")) {
    const raw = line.trim();
    if (!raw) continue;
    // Tables and rules.
    if (/^\|/.test(raw)) {
      dropped = true;
      continue;
    }
    if (/^[-*_]{3,}$/.test(raw.replace(/\s/g, ""))) continue;
    line = raw
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/^(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/, "")
      .replace(/<[^>\n]{1,200}>/g, (tag) => (/^<(?:https?:|www\.)/i.test(tag) ? " the link " : " "))
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`\n]+)`/g, (_, code) => (looksLikePath(code) ? fileName(code.trim()) : code))
      .replace(URL, "the link");
    for (const re of PATHS) line = line.replace(re, (path) => fileName(path));
    line = line
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
      // Leftover marks, but not 5*3 or snake_case.
      .replace(/[`#|]+|(?<![\p{L}\p{N}])[*_]+|[*_]+(?![\p{L}\p{N}])/gu, " ")
      .replace(/\s+/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim();
    if (/[\p{L}\p{N}]/u.test(line)) lines.push(line);
  }
  return { lines, dropped };
}

// Each line ends in a stop, and splits after . ! ? or … and a space.
function sentencesOf(lines) {
  const out = [];
  for (const line of lines)
    for (const part of withStop(line).split(SENTENCE_END)) {
      const sentence = part.trim();
      if (sentence) out.push(sentence);
    }
  return out;
}

// One sentence longer than the limit: cut on a word.
function cutWords(sentence, limit) {
  const room = limit - 1;
  const head = sentence.slice(0, room);
  const space = head.lastIndexOf(" ");
  return `${(space > room / 2 ? head.slice(0, space) : head).replace(/[\s.,;:!?-]+$/, "")}…`;
}

// The start of a long reply, ending on a whole line when it can.
function start(markdown) {
  const text = String(markdown || "");
  if (text.length <= READ_LIMIT) return { text, cut: false };
  const head = text.slice(0, READ_LIMIT);
  const line = head.lastIndexOf("\n");
  return { text: line > 0 ? head.slice(0, line) : head, cut: true };
}

// { sentences: one utterance each, text, clipped }.
export function speakable(markdown, { limit = SPEAK_LIMIT } = {}) {
  const { text: read, cut } = start(markdown);
  const { lines, dropped } = plainLines(read);
  const all = sentencesOf(lines);
  if (!all.length) {
    const sentences = dropped || cut ? [ONLY_DETAILS] : [];
    return { sentences, text: sentences.join(" "), clipped: false };
  }
  const sentences = [];
  let length = 0;
  let clipped = cut;
  for (const sentence of all) {
    const extra = (sentences.length ? 1 : 0) + sentence.length;
    if (length + extra > limit) {
      clipped = true;
      if (!sentences.length) sentences.push(cutWords(sentence, limit));
      break;
    }
    sentences.push(sentence);
    length += extra;
  }
  if (clipped) sentences.push(REST_OF_IT);
  return { sentences, text: sentences.join(" "), clipped };
}
