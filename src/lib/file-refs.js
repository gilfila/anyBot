// Local file paths in employee output. src/lib/markdown.js links the ones
// the main process says exist (files.check). Pure and React-free so node:test
// can load it (tests/file-refs.test.mjs).
//
// Matching runs on HTML-ESCAPED text (the markdown pipeline escapes first),
// and each hit is unescaped to get the raw path. Detection is not a security
// boundary: desktop/file-access.cjs refuses unsafe paths and re-checks every
// open, reveal, and preview.
export const MAX_CANDIDATES = 64;
export const MAX_PATH_CHARS = 1024;
const MAX_EXTRA_TOKENS = 4;
// Past this the unquoted scan is skipped; code spans and quotes still link.
const MAX_SCAN_CHARS = 20_000;

export function unescapeHtml(text) {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[entity]);
}

// One path-segment character in escaped text: never whitespace, the NUL
// placeholder marker, a backtick, the Windows-illegal * ? | : < > ", a
// separator, or a bare "&" (so &quot; &#39; &lt; &gt; end a path).
const SEGCH = String.raw`(?:&amp;|[^\s\u0000\x60*?|:<>"\\/&])`;
// Bounded like an NTFS name, so a long run of text can't backtrack for long.
const SEG = `${SEGCH}{1,255}`;
const SEP = String.raw`[\\/]+`;
const LINE = String.raw`:\d{1,7}(?::\d{1,4})?`;
const BEFORE = String.raw`(?<![\p{L}\p{N}_\\/.:~@#$%&-])`;
// Write (?:SEP)?, never ${SEP}?: that turns + lazy and drops the last segment.
const BODY = `(?:${SEG}(?:${SEP}${SEG})*(?:${SEP})?)?`;
const ALTS = {
  url: String.raw`\bfile:///[A-Za-z]:/${BODY}`,
  win: String.raw`${BEFORE}[A-Za-z]:${SEP}${BODY}`,
  home: String.raw`${BEFORE}~${SEP}${SEG}(?:${SEP}${SEG})*(?:${SEP})?`,
  posix: String.raw`${BEFORE}/${SEG}(?:/${SEG})+/?`,
  rel: String.raw`${BEFORE}(?:${SEG}${SEP})+${SEG}`,
};
const KINDS = Object.keys(ALTS);
const PATH_PATTERN = new RegExp(KINDS.map((kind, i) => `(?<${kind}>${ALTS[kind]})(?<l${i}>${LINE})?`).join("|"), "gu");
// A continuation token must end cleanly (space, end, placeholder, or an
// escaped quote or bracket), so "C:\a.md C:\b.md" never yields "C:\a.md C".
const END = String.raw`(?=[\s\u0000]|$|&(?:quot|#39|lt|gt);)`;
const CONTINUE = new RegExp(String.raw` (${SEGCH}(?:${SEGCH}|${SEP}){0,1023})${END}`, "uy");
// "evil.exe::$DATA", "host:path": a colon glued to more text is neither a
// line suffix nor punctuation, so the whole hit is dropped.
const GLUED_COLON = /^:[^\s\d]/;
const SEGMENT_CHAR = new RegExp(`^${SEGCH}`, "u");
const EXT = /\.(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,10}$/;

// Quoted paths may contain spaces. The opener must follow the start, a space,
// or one of ( [ { : = , (so apostrophes in prose don't pair up), and the text
// after it must already look like a path.
const START = String.raw`(?=[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[^\s\u0000&*?|<>:,;](?:[^\u0000&*?|<>:,;\\/\n]{0,60}[^\s\u0000&*?|<>:,;\\/])?[\\/]|file:///)`;
export const QUOTED_PATTERN = new RegExp(
  String.raw`(?<=^|[\s(\[{:=,])(?:&quot;${START}((?:(?!&quot;)[^\u0000\n]){1,1024}?)&quot;|&#39;${START}((?:(?!&#39;)[^\u0000\n]){1,1024}?)&#39;|\u201c${START}([^\u201d\u0000\n]{1,1024}?)\u201d)`,
  "g",
);

const lastSegment = (path) => path.split(/[\\/]+/).filter(Boolean).pop() || "";

// Drops trailing sentence punctuation and unbalanced closing brackets:
// "(…transcribe.ts)" keeps transcribe.ts, "a (1).md" is kept whole.
export function trimTrailing(text) {
  let out = text;
  for (;;) {
    if (/[.,;!?]$/.test(out)) {
      out = out.slice(0, -1);
      continue;
    }
    const close = out.at(-1);
    const open = { ")": "(", "]": "[", "}": "{" }[close];
    if (open && out.split(open).length < out.split(close).length) {
      out = out.slice(0, -1);
      continue;
    }
    return out;
  }
}

// Anchored check for a whole string (a code span, quoted text, or a link
// href), already unescaped. Returns { raw, line } or null. `bare` accepts a
// lone file name (package.json); `href` also percent-decodes.
export function pathShape(input, { platform = "win32", bare = false, href = false } = {}) {
  let raw = String(input).trim();
  if (!raw || raw.length > MAX_PATH_CHARS || /[\u0000-\u001f\u007f*?|<>"]/.test(raw)) return null;
  let line = "";
  const hash = raw.match(/#L(\d{1,7})(?:-L?\d{1,7})?$/);
  if (hash) {
    line = `:${hash[1]}`;
    raw = raw.slice(0, hash.index);
  }
  const suffix = raw.match(/:(\d{1,7})(?::\d{1,4})?$/);
  if (suffix && suffix.index > 1) {
    line = raw.slice(suffix.index);
    raw = raw.slice(0, suffix.index);
  }
  if (/^file:/i.test(raw)) {
    if (!/^file:\/\/\/[A-Za-z]:\//i.test(raw)) return null;
    raw = raw.slice(8);
    href = true;
  }
  if (href && raw.includes("%")) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  if (!raw || /[\u0000-\u001f\u007f*?|<>"]/.test(raw)) return null;
  if (/^[\\/]{2}/.test(raw)) return null; // UNC, \\?\ and \\.\ device paths
  const drive = /^[A-Za-z]:[\\/]/.test(raw);
  if (!drive && raw.includes(":")) return null; // URLs, streams, C:relative, host:path
  if (drive && raw.slice(2).includes(":")) return null; // an alternate data stream
  const okSegment = (s) => s === "." || s === ".." || /^[^\s](?:.*[^\s.])?$/.test(s);
  const parts = raw.replace(/^[A-Za-z]:/, "").split(/[\\/]+/);
  const trailing = parts.length > 1 && parts.at(-1) === "";
  const named = parts.filter((s, i) => !(s === "" && (i === 0 || i === parts.length - 1)));
  if (named.some((s) => s === "")) return null;
  if (drive || /^~[\\/]/.test(raw)) return named.slice(drive ? 0 : 1).every(okSegment) ? { raw, line } : null;
  if (/^[\\/]/.test(raw)) {
    if (platform === "win32") return null; // \foo is the root of the current drive
    if (named.length < 2 || !named.every(okSegment) || !(EXT.test(raw) || trailing)) return null;
    return { raw, line };
  }
  if (/^[-~]/.test(raw)) return null; // --flags and ~user
  if (!named.length || !named.every(okSegment)) return null;
  if (named.length === 1 && !(bare || trailing)) return null;
  if (!(EXT.test(named.at(-1)) || trailing)) return null;
  if (named.every((s) => s === "." || s === "..")) return null;
  return { raw, line };
}

// Unquoted paths in escaped text. Each hit keeps where it starts and the raw
// variants to check, shortest first; the renderer links the longest variant
// that exists. Drive, home, and posix paths may run on through up to four
// single-space tokens ("…/2026-09-28 21-47-22.mp4").
export function scanUnquoted(escaped, { platform = "win32" } = {}) {
  const hits = [];
  if (escaped.length > MAX_SCAN_CHARS) return hits;
  for (const m of escaped.matchAll(PATH_PATTERN)) {
    const kind = KINDS.find((k) => m.groups[k]);
    const body = m.groups[kind];
    const line = m.groups[`l${KINDS.indexOf(kind)}`] || "";
    const after = escaped.slice(m.index + m[0].length);
    if (kind === "posix" && platform === "win32") continue;
    if (GLUED_COLON.test(after)) continue;
    if (!line && SEGMENT_CHAR.test(after)) continue; // a segment over 255 characters
    const trimmed = line ? body : trimTrailing(body);
    if ((kind === "rel" || kind === "posix") && !EXT.test(lastSegment(trimmed))) continue;
    const start = m.index;
    const hit = { start, kind, variants: [] };
    const add = (escapedPath, end) => {
      const shape = pathShape(unescapeHtml(escapedPath), { platform });
      if (shape && !hit.variants.some((v) => v.raw === shape.raw)) hit.variants.push({ raw: shape.raw, end });
    };
    add(trimmed, start + trimmed.length + line.length);
    if (!line && trimmed === body && kind !== "rel") {
      let cursor = start + body.length;
      let extended = body;
      for (let i = 0; i < MAX_EXTRA_TOKENS; i++) {
        CONTINUE.lastIndex = cursor;
        const token = CONTINUE.exec(escaped);
        if (!token) break;
        extended += ` ${token[1]}`;
        cursor += token[0].length;
        if (extended.length > MAX_PATH_CHARS) break;
        const cut = trimTrailing(extended);
        add(cut, start + cut.length);
        if (cut !== extended) break;
      }
    }
    if (hit.variants.length) hits.push(hit);
  }
  return hits;
}

export function fileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const KIND_LABELS = { image: "Image", text: "Text", video: "Video", audio: "Audio", document: "Document", archive: "Archive" };
const extension = (name) => (String(name).match(/\.[^.\\/]+$/)?.[0] || "").toLowerCase();

// The link's tooltip, from main's answer (files.check): the canonical path,
// what it is, and what a click does.
export function fileTooltip(ref) {
  const folder = ref.state === "folder";
  const what = folder ? "Folder" : [KIND_LABELS[ref.kind] || "File", fileSize(ref.size)].filter(Boolean).join(" · ");
  const ext = extension(ref.name);
  let how;
  // A folder named like a file (setup.exe/) gets that file's rules.
  const named = `folders named like ${ext || "files"}${ext ? " files" : ""}`;
  if (ref.action === "menu")
    how =
      ref.reason === "folder-name"
        ? `Any Bot doesn't open or show ${named}. Right-click to copy the path.`
        : folder
          ? "Any Bot doesn't open special folders. Right-click to copy the path."
          : "Any Bot doesn't open shortcut files. Right-click to copy the path.";
  else if (ref.action === "reveal")
    how = folder
      ? `Any Bot doesn't open ${named}. Click to show it in its folder.`
      : ref.reason === "runs-programs"
        ? `This ${ext ? `${ext} ` : ""}file can run programs, so Any Bot won't open it. Click to show it in its folder.`
        : `Any Bot doesn't open ${ext || "these"} files. Click to show it in its folder.`;
  else {
    how = ref.action === "preview" ? "Click to preview" : folder ? "Click to open the folder" : "Click to open";
    if (ref.reveal) how += " · Shift+click to show in folder";
    how += " · Right-click for more";
  }
  return [ref.path, what, how].filter(Boolean).join("\n");
}
