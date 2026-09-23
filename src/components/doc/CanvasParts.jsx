import React, { useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  ExternalLink,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Globe,
  LayoutTemplate,
  Pencil,
  Plus,
  Rows2,
  Trash2,
} from "lucide-react";
import { renderMarkdownInline } from "../../lib/markdown.js";
import { RobotAvatar } from "../RobotAvatar.jsx";
import { CANVAS_TEMPLATES, SAFE_URL, hostOf, tableOps } from "./blocks.js";

const ago = (value) => {
  if (!value) return "";
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};
const size = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`);
const fileIcon = (name) => {
  const ext = name.split(".").pop().toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return FileImage;
  if (["csv", "tsv", "xlsx", "xls"].includes(ext)) return FileSpreadsheet;
  if (["html", "htm", "js", "jsx", "ts", "tsx", "py", "json", "css", "mjs", "cjs", "sh", "ps1"].includes(ext)) return FileCode;
  return FileText;
};

// A table block: rendered markdown cells at rest, one input per cell while
// focused. Tab/Enter move between cells and grow the table at the end.
export function TableBlock({ block, focused, onFocus, onChange, onRemove }) {
  const rows = block.rows?.length ? block.rows : [[""]];
  const [cell, setCell] = useState({ r: 0, c: 0 });
  const refs = useRef(new Map());
  useLayoutEffect(() => {
    if (focused) refs.current.get(`${cell.r}:${cell.c}`)?.focus();
  }, [focused, cell.r, cell.c]);
  const width = rows[0].length;
  const move = (r, c) => {
    let next = rows;
    if (r >= rows.length) next = tableOps.addRow(rows, rows.length);
    if (next !== rows) onChange(next);
    setCell({ r: Math.max(0, r), c: Math.max(0, Math.min(width - 1, c)) });
  };
  const onKey = (event, r, c) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const step = event.shiftKey ? -1 : 1;
      let nr = r;
      let nc = c + step;
      if (nc >= width) [nr, nc] = [r + 1, 0];
      if (nc < 0) [nr, nc] = [r - 1, width - 1];
      if (nr >= 0) move(nr, nc);
    } else if (event.key === "Enter") {
      event.preventDefault();
      move(r + 1, c);
    } else if (event.key === "ArrowUp" && r > 0) {
      event.preventDefault();
      setCell({ r: r - 1, c });
    } else if (event.key === "ArrowDown" && r + 1 < rows.length) {
      event.preventDefault();
      setCell({ r: r + 1, c });
    } else if (event.key === "Escape") event.currentTarget.blur();
  };
  const tool = (label, Icon, action, disabled = false) => (
    <button type="button" className="canvas-table-tool" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={action}>
      <Icon size={13} />
      {label}
    </button>
  );
  return (
    <div className={`canvas-table${focused ? " is-editing" : ""}`}>
      {focused && (
        <div className="canvas-table-tools" role="toolbar" aria-label="Table">
          {tool("Row", Plus, () => {
            onChange(tableOps.addRow(rows, cell.r + 1));
            setCell({ r: cell.r + 1, c: cell.c });
          })}
          {tool("Column", Plus, () => {
            onChange(tableOps.addColumn(rows, cell.c + 1));
            setCell({ r: cell.r, c: cell.c + 1 });
          }, width >= 12)}
          {tool("Delete row", Rows2, () => {
            onChange(tableOps.removeRow(rows, cell.r));
            setCell({ r: Math.max(0, cell.r - 1), c: cell.c });
          }, rows.length <= 1)}
          {tool("Delete column", Columns2, () => {
            onChange(tableOps.removeColumn(rows, cell.c));
            setCell({ r: cell.r, c: Math.max(0, cell.c - 1) });
          }, width <= 1)}
          {tool("Delete table", Trash2, onRemove)}
        </div>
      )}
      <div className="canvas-table-scroll">
        <table>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((value, c) => {
                  const Cell = r === 0 ? "th" : "td";
                  return (
                    <Cell key={c} className={focused && cell.r === r && cell.c === c ? "is-active" : ""}>
                      {focused ? (
                        <input
                          ref={(node) => (node ? refs.current.set(`${r}:${c}`, node) : refs.current.delete(`${r}:${c}`))}
                          value={value}
                          maxLength={500}
                          aria-label={`Row ${r + 1}, column ${c + 1}`}
                          placeholder={r === 0 ? "Header" : ""}
                          onFocus={() => setCell({ r, c })}
                          onChange={(event) => onChange(tableOps.set(rows, r, c, event.target.value))}
                          onKeyDown={(event) => onKey(event, r, c)}
                        />
                      ) : (
                        <div
                          className="canvas-cell"
                          onMouseDown={(event) => {
                            if (event.target.closest("a")) return;
                            event.preventDefault();
                            setCell({ r, c });
                            onFocus();
                          }}
                          dangerouslySetInnerHTML={{ __html: renderMarkdownInline(value) || "&nbsp;" }}
                        />
                      )}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// A link card. New cards open in edit mode; the card itself is an ordinary
// external link (the desktop shell opens http(s) links in the browser).
export function LinkBlock({ block, focused, onFocus, onChange, onDone }) {
  const [editing, setEditing] = useState(!block.url);
  const urlRef = useRef(null);
  const valid = SAFE_URL.test(block.url || "");
  useLayoutEffect(() => {
    if (focused && editing) urlRef.current?.focus();
  }, [focused, editing]);
  if (editing || !valid)
    return (
      <div className="canvas-link-edit" onMouseDown={(event) => event.stopPropagation()}>
        <Globe size={15} />
        <input
          ref={urlRef}
          value={block.url || ""}
          placeholder="Paste a link (https://…)"
          aria-label="Link address"
          onFocus={onFocus}
          onChange={(event) => onChange({ url: event.target.value.trim() })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && valid) {
              event.preventDefault();
              event.currentTarget.nextSibling?.focus();
            }
          }}
        />
        <input
          value={block.text || ""}
          placeholder="Title (optional)"
          aria-label="Link title"
          maxLength={300}
          onFocus={onFocus}
          onChange={(event) => onChange({ text: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && valid) {
              event.preventDefault();
              setEditing(false);
              onDone();
            }
          }}
        />
        <button
          type="button"
          className="secondary"
          disabled={!valid}
          onClick={() => {
            setEditing(false);
            onDone();
          }}
        >
          Done
        </button>
        {block.url && !valid && <span className="canvas-link-hint">Use an http(s) address</span>}
      </div>
    );
  return (
    <div className="canvas-link-card">
      <a href={block.url} target="_blank" rel="noopener noreferrer" title={block.url}>
        <span className="canvas-link-icon">
          <Globe size={16} />
        </span>
        <span className="canvas-link-text">
          <strong>{block.text || hostOf(block.url)}</strong>
          <small>{block.url.replace(/^https?:\/\/(www\.)?/, "")}</small>
        </span>
        <ExternalLink size={14} className="canvas-link-open" />
      </a>
      <button type="button" className="icon-button" aria-label="Edit link" title="Edit link" onClick={() => setEditing(true)}>
        <Pencil size={13} />
      </button>
    </div>
  );
}

function Section({ title, count, open, onToggle, children, action }) {
  return (
    <section className={`canvas-strip${open ? " is-open" : ""}`}>
      <header>
        <button type="button" className="canvas-strip-toggle" aria-expanded={open} onClick={onToggle}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {title}
          <span className="segmented-count">{count}</span>
        </button>
        {action}
      </header>
      {open && children}
    </section>
  );
}

// Every file the bots returned in this conversation, with who made it.
export function CanvasFiles({ files, runs, employees, open, onToggle, onOpen, onReveal, onInsert }) {
  const producer = (file) => employees.find((e) => e.id === runs.find((r) => r.id === file.run)?.employee);
  const sorted = [...files].sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return (
    <Section title="Files & outputs" count={files.length} open={open} onToggle={onToggle}>
      {!files.length ? (
        <p className="canvas-strip-empty">Files your bots return in this conversation show up here.</p>
      ) : (
        <ul className="canvas-files">
          {sorted.map((file) => {
            const Icon = fileIcon(file.name);
            const who = producer(file);
            return (
              <li key={file.id}>
                <button type="button" className="canvas-file" onClick={() => onOpen(file)} title={`Open ${file.name}`}>
                  <Icon size={18} />
                  <span>
                    <strong>{file.name}</strong>
                    <small>
                      {who ? `${who.name} · ` : ""}
                      {size(file.bytes)} · {ago(file.created)}
                    </small>
                  </span>
                </button>
                <div className="canvas-item-actions">
                  <button type="button" className="icon-button" aria-label={`Show ${file.name} in folder`} title="Show in folder" onClick={() => onReveal(file)}>
                    <FolderOpen size={14} />
                  </button>
                  <button type="button" className="icon-button" aria-label={`Add ${file.name} to the canvas`} title="Add to canvas" onClick={() => onInsert({ type: "file", ref: file.id, text: file.name })}>
                    <Plus size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// Every link shared in the chat, newest first.
export function CanvasLinks({ links, employees, open, onToggle, onInsert }) {
  return (
    <Section title="Links from the chat" count={links.length} open={open} onToggle={onToggle}>
      {!links.length ? (
        <p className="canvas-strip-empty">Links shared in this conversation show up here.</p>
      ) : (
        <ul className="canvas-files">
          {links.slice(0, 60).map((link) => {
            const who = link.author === "human" ? { name: "You" } : employees.find((e) => e.id === link.author);
            return (
              <li key={link.url}>
                <a className="canvas-file" href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}>
                  {who?.id ? <RobotAvatar small employee={who} /> : <Globe size={18} />}
                  <span>
                    <strong>{link.label || hostOf(link.url)}</strong>
                    <small>
                      {hostOf(link.url)}
                      {who ? ` · ${who.name}` : ""} · {ago(link.created)}
                    </small>
                  </span>
                </a>
                <div className="canvas-item-actions">
                  <button type="button" className="icon-button" aria-label="Add link to the canvas" title="Add to canvas" onClick={() => onInsert({ type: "link", url: link.url, text: link.label })}>
                    <Plus size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export function CanvasTemplates({ onPick }) {
  return (
    <div className="canvas-templates">
      <span>
        <LayoutTemplate size={14} />
        Start from
      </span>
      {CANVAS_TEMPLATES.map((template) => (
        <button type="button" key={template.id} className="secondary" title={template.hint} onClick={() => onPick(template.id)}>
          {template.label}
        </button>
      ))}
    </div>
  );
}
