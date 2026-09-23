import { randomUUID } from "node:crypto";
import { now } from "./store.mjs";

// Canvases: one shared, Slack-canvas-style page per conversation, stored as
// an ordered list of blocks. Blocks hold plain text (inline markdown is
// rendered escape-first in the renderer), never HTML. Tables hold rows of
// plain-text cells; link cards hold an http(s) URL.
export const BLOCK_TYPES = [
  "p",
  "h1",
  "h2",
  "h3",
  "bullet",
  "number",
  "todo",
  "quote",
  "callout",
  "code",
  "divider",
  "task",
  "file",
  "table",
  "link",
];
const MAX_BLOCKS = 800;
const MAX_ROWS = 100;
const MAX_COLUMNS = 12;
const MAX_CELL = 500;
const SAFE_URL = /^https?:\/\/[^\s<>"]{1,2000}$/i;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
// Cells are split on unescaped pipes; "\|" stays a literal pipe.
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
const tableRows = (value) => {
  if (!Array.isArray(value) || !value.length) throw new Error("Tables need at least one row");
  if (value.length > MAX_ROWS) throw new Error(`Tables hold at most ${MAX_ROWS} rows`);
  const width = Math.min(MAX_COLUMNS, Math.max(1, ...value.map((row) => (Array.isArray(row) ? row.length : 0))));
  return value.map((row) => {
    if (!Array.isArray(row)) throw new Error("Table rows must be lists of cells");
    return Array.from({ length: width }, (_, index) => {
      const cell = row[index] === undefined || row[index] === null ? "" : String(row[index]);
      if (cell.length > MAX_CELL) throw new Error(`Table cells hold at most ${MAX_CELL} characters`);
      return cell.replace(/\n/g, " ");
    });
  });
};
const MAX_TEXT = 8000;
const HISTORY = 20;
const HEADING = { h1: 1, h2: 2, h3: 3 };

export function normalizeBlocks(value) {
  if (!Array.isArray(value)) throw new Error("Document blocks must be a list");
  if (value.length > MAX_BLOCKS) throw new Error(`A document holds at most ${MAX_BLOCKS} blocks`);
  const seen = new Set();
  return value.map((block) => {
    if (!block || typeof block !== "object") throw new Error("Each block must be an object");
    if (!BLOCK_TYPES.includes(block.type)) throw new Error(`Unknown block type ${String(block.type).slice(0, 20)}`);
    let blockId = typeof block.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(block.id) ? block.id : randomUUID();
    if (seen.has(blockId)) blockId = randomUUID();
    seen.add(blockId);
    const text = typeof block.text === "string" ? block.text : "";
    if (text.length > MAX_TEXT) throw new Error(`A block holds at most ${MAX_TEXT} characters`);
    const out = { id: blockId, type: block.type, text };
    if (block.type === "todo") out.checked = block.checked === true;
    if (block.type === "table") {
      out.text = "";
      out.rows = tableRows(block.rows);
    }
    if (block.type === "link") {
      const url = typeof block.url === "string" ? block.url.trim() : "";
      if (!SAFE_URL.test(url)) throw new Error("Link cards need an http(s) address");
      out.url = url;
      out.text = text.slice(0, 300);
    }
    if (block.type === "task" || block.type === "file") {
      if (typeof block.ref !== "string" || !/^[A-Za-z0-9-]{6,64}$/.test(block.ref))
        throw new Error("Embeds need a valid reference");
      out.ref = block.ref;
    }
    if (typeof block.author === "string" && block.author.length <= 100) out.author = block.author;
    if (typeof block.at === "string" && block.at.length <= 40) out.at = block.at;
    return out;
  });
}

// Markdown from employees becomes blocks. Code fences keep their lines;
// everything else is one block per line.
export function markdownToBlocks(markdown, author = null) {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  const at = now();
  const push = (type, text, extra = {}) =>
    blocks.push({ id: randomUUID(), type, text, ...extra, ...(author ? { author, at } : {}) });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      push("code", body.join("\n"));
      continue;
    }
    if (!line.trim()) continue;
    // GFM table: a header row, a --- rule, then body rows.
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] || "")) {
      const rows = [tableCells(line)];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]) && rows.length < MAX_ROWS) rows.push(tableCells(lines[i++]));
      i -= 1;
      push("table", "", { rows: tableRows(rows) });
      continue;
    }
    let match;
    // A line that is only a link becomes a link card.
    if ((match = line.match(/^\s*\[([^\]]{1,300})\]\((https?:\/\/[^\s)]+)\)\s*$/))) {
      push("link", match[1].trim(), { url: match[2] });
      continue;
    }
    if ((match = line.match(/^\s*(https?:\/\/[^\s<>"]+)\s*$/))) {
      push("link", "", { url: match[1] });
      continue;
    }
    if ((match = line.match(/^(#{1,3})\s+(.*)$/))) push(`h${match[1].length}`, match[2].trim());
    else if ((match = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/))) push("todo", match[2], { checked: match[1] !== " " });
    else if ((match = line.match(/^\s*[-*+]\s+(.*)$/))) push("bullet", match[1]);
    else if ((match = line.match(/^\s*\d+[.)]\s+(.*)$/))) push("number", match[1]);
    else if ((match = line.match(/^\s*>\s?(.*)$/))) push("quote", match[1]);
    else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) push("divider", "");
    else push("p", line.trim());
  }
  return blocks;
}

export function blocksToMarkdown(blocks, { tasks = [] } = {}) {
  let number = 0;
  return blocks
    .map((block) => {
      number = block.type === "number" ? number + 1 : 0;
      switch (block.type) {
        case "h1":
          return `# ${block.text}`;
        case "h2":
          return `## ${block.text}`;
        case "h3":
          return `### ${block.text}`;
        case "bullet":
          return `- ${block.text}`;
        case "number":
          return `${number}. ${block.text}`;
        case "todo":
          return `- [${block.checked ? "x" : " "}] ${block.text}`;
        case "quote":
        case "callout":
          return `> ${block.text}`;
        case "code":
          return `\`\`\`\n${block.text}\n\`\`\``;
        case "divider":
          return "---";
        case "task": {
          const task = tasks.find((t) => t.id === block.ref);
          return task ? `[Task ${task.id.slice(0, 8)} (${task.status}): ${task.title}]` : "[Task removed]";
        }
        case "file":
          return `[File ${block.text || block.ref}]`;
        case "table": {
          const cell = (value) => value.replace(/\|/g, "\\|");
          const [head = [], ...body] = block.rows || [];
          return [
            `| ${head.map(cell).join(" | ")} |`,
            `| ${head.map(() => "---").join(" | ")} |`,
            ...body.map((row) => `| ${row.map(cell).join(" | ")} |`),
          ].join("\n");
        }
        case "link":
          return block.text ? `[${block.text}](${block.url})` : block.url;
        default:
          return block.text;
      }
    })
    .join("\n");
}

export class Docs {
  constructor(store) {
    this.store = store;
  }
  get(conversation) {
    const row = this.store.one("SELECT * FROM docs WHERE conversation=?", conversation);
    if (!row) {
      if (!this.store.one("SELECT id FROM conversations WHERE id=?", conversation)) throw new Error("Conversation not found");
      return { conversation, blocks: [], revision: 0, updated: "", updatedBy: "" };
    }
    return { ...row, blocks: JSON.parse(row.blocks) };
  }
  // Snapshot-sized summary so the renderer knows when to refetch.
  revisions() {
    return this.store.all("SELECT conversation,revision,updated,updatedBy FROM docs");
  }
  write(conversation, blocks, author, run = null) {
    const current = this.get(conversation);
    const stamp = now();
    if (current.revision > 0) {
      this.store.run(
        "INSERT INTO doc_history(id,conversation,blocks,revision,author,run,created) VALUES (?,?,?,?,?,?,?)",
        randomUUID(),
        conversation,
        JSON.stringify(current.blocks),
        current.revision,
        current.updatedBy,
        run,
        stamp,
      );
      this.store.run(
        `DELETE FROM doc_history WHERE conversation=? AND id NOT IN (
          SELECT id FROM doc_history WHERE conversation=? ORDER BY created DESC, rowid DESC LIMIT ${HISTORY})`,
        conversation,
        conversation,
      );
    }
    this.store.run(
      `INSERT INTO docs(conversation,blocks,revision,updatedBy,updated) VALUES (?,?,1,?,?)
       ON CONFLICT(conversation) DO UPDATE SET blocks=excluded.blocks, revision=docs.revision+1,
       updatedBy=excluded.updatedBy, updated=excluded.updated`,
      conversation,
      JSON.stringify(blocks),
      author,
      stamp,
    );
    this.store.event("doc.updated", { conversation, author, run });
  }
  // Owner saves carry the revision they edited; a mismatch means someone
  // (usually an employee) changed the page, and the renderer merges.
  save(payload) {
    const conversation = String(payload.conversation || "");
    const current = this.get(conversation);
    if (payload.revision !== current.revision) {
      const error = new Error("Document changed. Merging the latest version.");
      error.code = "DOC_CONFLICT";
      throw error;
    }
    this.write(conversation, normalizeBlocks(payload.blocks), "human");
    return this.get(conversation);
  }
  history(conversation) {
    return this.store.all(
      "SELECT id,revision,author,run,created FROM doc_history WHERE conversation=? ORDER BY created DESC, rowid DESC",
      conversation,
    );
  }
  restore(payload) {
    const version = this.store.one(
      "SELECT * FROM doc_history WHERE id=? AND conversation=?",
      String(payload.id || ""),
      String(payload.conversation || ""),
    );
    if (!version) throw new Error("Version not found");
    this.write(version.conversation, JSON.parse(version.blocks), "human");
  }
  // doc.append adds blocks to the end; doc.section replaces the content
  // under a heading (or appends the heading). Employees never rewrite the
  // whole page.
  applyAgentAction(action, run) {
    const members = JSON.parse(
      this.store.one("SELECT members FROM conversations WHERE id=?", run.conversation)?.members || "[]",
    );
    if (!members.includes(run.employee)) throw new Error("Only members of this conversation can edit its canvas");
    const markdown = typeof action.markdown === "string" ? action.markdown : "";
    if (!markdown.trim()) throw new Error(`${action.type} needs markdown`);
    if (markdown.length > 20000) throw new Error("Doc updates are limited to 20000 characters");
    const added = markdownToBlocks(markdown, run.employee);
    const { blocks } = this.get(run.conversation);
    let next;
    if (action.type === "doc.append") {
      next = [...blocks, ...added];
    } else {
      const heading = typeof action.heading === "string" ? action.heading.trim() : "";
      if (!heading || heading.length > 200) throw new Error("doc.section needs a heading");
      const start = blocks.findIndex((b) => HEADING[b.type] && b.text.trim().toLowerCase() === heading.toLowerCase());
      if (start < 0) {
        next = [...blocks, { id: randomUUID(), type: "h2", text: heading, author: run.employee, at: now() }, ...added];
      } else {
        const level = HEADING[blocks[start].type];
        let end = start + 1;
        while (end < blocks.length && !(HEADING[blocks[end].type] && HEADING[blocks[end].type] <= level)) end += 1;
        next = [...blocks.slice(0, start + 1), ...added, ...blocks.slice(end)];
      }
    }
    this.write(run.conversation, normalizeBlocks(next), run.employee, run.id);
    return action.type === "doc.append"
      ? `added ${added.length} block${added.length === 1 ? "" : "s"} to the canvas`
      : `updated the "${action.heading.trim()}" section`;
  }
}
