// Pure block helpers for the project doc editor. No React here so the
// editing rules can be unit tested under node:test.

export const newId = () =>
  (globalThis.crypto?.randomUUID?.() || `b-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const TEXT_TYPES = ["p", "h1", "h2", "h3", "bullet", "number", "todo", "quote", "callout", "code"];
export const LIST_TYPES = ["bullet", "number", "todo"];

export const SLASH_ITEMS = [
  { type: "p", label: "Text", hint: "Plain paragraph", keys: "text paragraph" },
  { type: "h1", label: "Heading 1", hint: "Big section heading", keys: "h1 heading title" },
  { type: "h2", label: "Heading 2", hint: "Medium section heading", keys: "h2 heading subtitle" },
  { type: "h3", label: "Heading 3", hint: "Small section heading", keys: "h3 heading" },
  { type: "bullet", label: "Bulleted list", hint: "A simple list", keys: "bullet list ul" },
  { type: "number", label: "Numbered list", hint: "A list with numbers", keys: "number ordered list ol" },
  { type: "todo", label: "To-do", hint: "Track a checkbox", keys: "todo checkbox task check" },
  { type: "quote", label: "Quote", hint: "Capture a quote", keys: "quote blockquote" },
  { type: "callout", label: "Callout", hint: "Make it stand out", keys: "callout note info" },
  { type: "code", label: "Code", hint: "Monospace block", keys: "code snippet" },
  { type: "divider", label: "Divider", hint: "Separate sections", keys: "divider line hr rule" },
  { type: "task", label: "Task", hint: "Embed a board task", keys: "task board card embed" },
  { type: "file", label: "File", hint: "Embed a returned file", keys: "file artifact attachment embed" },
];

// Label prefix matches rank first, then label substrings, then keywords, so
// "/task" picks Task before To-do (whose keywords mention tasks).
export function filterSlash(query) {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  const rank = (item) => {
    const label = item.label.toLowerCase();
    if (label.startsWith(q)) return 0;
    if (label.includes(q)) return 1;
    if (item.keys.split(" ").some((key) => key.startsWith(q))) return 2;
    return 3;
  };
  return SLASH_ITEMS.filter((item) => rank(item) < 3).sort((a, b) => rank(a) - rank(b));
}

// Markdown shortcuts typed at the start of a block, triggered by a space.
const SHORTCUTS = [
  [/^###$/, "h3"],
  [/^##$/, "h2"],
  [/^#$/, "h1"],
  [/^[-*+]$/, "bullet"],
  [/^1[.)]$/, "number"],
  [/^\[\s?\]$/, "todo"],
  [/^>$/, "quote"],
  [/^```$/, "code"],
];
export function shortcutFor(prefix) {
  if (/^---$/.test(prefix)) return "divider";
  return SHORTCUTS.find(([pattern]) => pattern.test(prefix))?.[1] || null;
}

export function blankBlock(type = "p") {
  const block = { id: newId(), type, text: "" };
  if (type === "todo") block.checked = false;
  return block;
}

// Enter at `caret`: text after the caret moves to a new block. Lists keep
// going; an empty list item turns back into text (Notion's exit gesture).
export function splitBlock(blocks, index, caret) {
  const block = blocks[index];
  if (LIST_TYPES.includes(block.type) && !block.text.trim()) {
    const next = [...blocks];
    next[index] = { id: block.id, type: "p", text: "" };
    return { blocks: next, focus: block.id, caret: 0 };
  }
  const before = block.text.slice(0, caret);
  const after = block.text.slice(caret);
  const type = LIST_TYPES.includes(block.type) ? block.type : "p";
  const created = { ...blankBlock(type), text: after };
  const next = [...blocks];
  next[index] = { ...block, text: before };
  next.splice(index + 1, 0, created);
  return { blocks: next, focus: created.id, caret: 0 };
}

// Backspace at the start of a block: styled blocks become text first, then
// text merges into the previous text block.
export function backspaceBlock(blocks, index) {
  const block = blocks[index];
  if (block.type !== "p" && TEXT_TYPES.includes(block.type)) {
    const next = [...blocks];
    next[index] = { id: block.id, type: "p", text: block.text };
    return { blocks: next, focus: block.id, caret: 0 };
  }
  if (index === 0) return null;
  const previous = blocks[index - 1];
  const next = [...blocks];
  if (!TEXT_TYPES.includes(previous.type)) {
    if (block.text) return null;
    next.splice(index, 1);
    return { blocks: next, focus: previous.id, caret: null };
  }
  const joint = previous.text.length;
  next[index - 1] = { ...previous, text: previous.text + block.text };
  next.splice(index, 1);
  return { blocks: next, focus: previous.id, caret: joint };
}

export function changeType(blocks, index, type, extra = {}) {
  const block = blocks[index];
  const next = [...blocks];
  const changed = { id: block.id, type, text: TEXT_TYPES.includes(type) ? block.text : "", ...extra };
  if (type === "todo") changed.checked = false;
  next[index] = changed;
  // Dividers and embeds need a text block after them to keep typing.
  if (!TEXT_TYPES.includes(type) && !next[index + 1]) next.push(blankBlock());
  return next;
}

// Merge after a revision conflict: remote order wins, locally edited blocks
// keep the owner's version, locally deleted blocks stay deleted, and blocks
// the owner created are placed after their nearest surviving predecessor.
export function mergeBlocks(remote, local, dirty, deleted) {
  const localById = new Map(local.map((block) => [block.id, block]));
  const merged = remote
    .filter((block) => !deleted.has(block.id))
    .map((block) => (dirty.has(block.id) && localById.has(block.id) ? localById.get(block.id) : block));
  const present = new Set(merged.map((block) => block.id));
  local.forEach((block, index) => {
    if (present.has(block.id) || !dirty.has(block.id)) return;
    let anchor = -1;
    for (let i = index - 1; i >= 0; i--) {
      anchor = merged.findIndex((b) => b.id === local[i].id);
      if (anchor >= 0) break;
    }
    merged.splice(anchor + 1, 0, block);
    present.add(block.id);
  });
  return merged;
}
