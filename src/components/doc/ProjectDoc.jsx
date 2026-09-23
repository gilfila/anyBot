import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Columns3, FileText, GripVertical, History, Lightbulb, Maximize2, RotateCcw, X } from "lucide-react";
import { escapeHtml, renderMarkdownInline } from "../../lib/markdown.js";
import { RobotAvatar } from "../RobotAvatar.jsx";
import { Status } from "../Status.jsx";
import { statusLabel } from "../board/meta.js";
import {
  TEXT_TYPES,
  backspaceBlock,
  blankBlock,
  changeType,
  filterSlash,
  fromTemplate,
  linksFromMessages,
  mergeBlocks,
  savable,
  shortcutFor,
  splitBlock,
} from "./blocks.js";
import { CanvasFiles, CanvasLinks, CanvasTemplates, LinkBlock, TableBlock } from "./CanvasParts.jsx";
import "./doc.css";
import "./canvas.css";

const SAVE_DELAY = 700;
const when = (value) =>
  value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

function Menu({ items, active, onPick, empty }) {
  return (
    <div className="doc-menu" role="listbox" onMouseDown={(event) => event.preventDefault()}>
      {items.length === 0 && <p className="doc-menu-empty">{empty}</p>}
      {items.map((item, index) => (
        <button
          type="button"
          role="option"
          aria-selected={index === active}
          key={item.key}
          className={index === active ? "active" : ""}
          onClick={() => onPick(item)}
        >
          <span className="doc-menu-label">{item.label}</span>
          {item.hint && <span className="doc-menu-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}

function DocBlock({ block, number, focused, caret, menu, author, onFocus, onKeyDown, onChange, onToggle, onRemove, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const inputRef = useRef(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!focused || !input) return;
    input.focus();
    const position = caret == null ? input.value.length : Math.min(caret, input.value.length);
    input.setSelectionRange(position, position);
  }, [focused, caret]);
  const isText = TEXT_TYPES.includes(block.type);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`doc-block type-${block.type}${focused ? " is-focused" : ""}${isDragging ? " is-dragging" : ""}${block.author ? " by-agent" : ""}`}
    >
      <button
        type="button"
        className="doc-handle"
        ref={setActivatorNodeRef}
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <div className="doc-block-main">
        {block.type === "todo" && (
          <input type="checkbox" className="doc-todo" aria-label="Done" checked={Boolean(block.checked)} onChange={onToggle} />
        )}
        {block.type === "number" && <span className="doc-number">{number}.</span>}
        {block.type === "bullet" && <span className="doc-bullet" aria-hidden="true" />}
        {block.type === "callout" && <Lightbulb size={16} className="doc-callout-icon" />}
        {isText ? (
          focused ? (
            <textarea
              ref={inputRef}
              rows={1}
              className="doc-input"
              value={block.text}
              aria-label={`${block.type} block`}
              placeholder={block.type === "p" ? "Type '/' for commands, '@' to link" : ""}
              spellCheck={block.type !== "code"}
              onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
              onKeyDown={(event) => onKeyDown(event, inputRef.current)}
            />
          ) : (
            <div
              className={`doc-text${block.text ? "" : " is-empty"}`}
              role="textbox"
              tabIndex={0}
              aria-label={`${block.type} block`}
              onFocus={() => onFocus(null)}
              onMouseDown={(event) => {
                event.preventDefault();
                // Mentions are links: keep the block rendered so the click
                // lands on the chip instead of a freshly mounted textarea.
                if (event.target.closest("[data-mention]")) return;
                onFocus(null);
              }}
              dangerouslySetInnerHTML={{
                __html:
                  block.type === "code"
                    ? escapeHtml(block.text) || "&nbsp;"
                    : renderMarkdownInline(block.text, { mentions: true }) || "&nbsp;",
              }}
            />
          )
        ) : (
          <div
            className="doc-embed-slot"
            tabIndex={0}
            onFocus={() => onFocus(null)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Backspace" || event.key === "Delete") {
                event.preventDefault();
                onRemove();
              }
            }}
          >
            {block.type === "divider" ? <hr /> : children}
          </div>
        )}
        {menu}
      </div>
      {author && (
        <span className="doc-author" title={`Added by ${author.name}${block.at ? ` · ${when(block.at)}` : ""}`}>
          <RobotAvatar small employee={author} />
        </span>
      )}
    </div>
  );
}

// The canvas: one shared, Slack-style page per conversation. `compact` is the
// side-panel version beside the chat.
export function ProjectDoc({ conversation, data, act, onOpenTask, onOpenArtifact, onRevealArtifact, compact = false, onExpand }) {
  const [doc, setDoc] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [focus, setFocus] = useState(null); // { id, caret }
  const [menu, setMenu] = useState(null); // { kind, blockId, query, active, start }
  const [state, setState] = useState("saved");
  const [history, setHistory] = useState(null);
  const [strips, setStrips] = useState({ files: true, links: !compact });
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const docRef = useRef(doc);
  docRef.current = doc;
  const dirty = useRef(new Set());
  const deleted = useRef(new Set());
  const timer = useRef(null);
  const saving = useRef(false);
  const projectTasks = data.tasks.filter((task) => task.conversation === conversation.id);
  const files = data.artifacts.filter((artifact) => artifact.conversation === conversation.id);
  const members = data.employees.filter((e) => conversation.members.includes(e.id));
  const links = useMemo(
    () => linksFromMessages(data.messages.filter((m) => m.conversation === conversation.id)),
    [data.messages, conversation.id],
  );
  const remoteRevision = data.docs?.find((d) => d.conversation === conversation.id)?.revision ?? 0;

  const load = useCallback(async () => {
    if (!window.anybot) return;
    const next = await window.anybot.request("docs.get", { conversation: conversation.id });
    dirty.current = new Set();
    deleted.current = new Set();
    setDoc(next);
    setBlocks(next.blocks.length ? next.blocks : [blankBlock()]);
    setState("saved");
  }, [conversation.id]);

  useEffect(() => {
    setFocus(null);
    setMenu(null);
    setHistory(null);
    load();
  }, [load]);

  // An employee (or another window) changed the page. Reload when we have
  // no unsaved edits; otherwise the next save merges.
  useEffect(() => {
    if (doc && remoteRevision > doc.revision && !dirty.current.size && !saving.current) load();
  }, [remoteRevision]);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current || !docRef.current || (!dirty.current.size && !deleted.current.size)) return;
    saving.current = true;
    setState("saving");
    const sentDirty = new Set(dirty.current);
    const sentDeleted = new Set(deleted.current);
    const payload = blocksRef.current
      .filter(savable)
      .filter((block, index, all) => !(index === all.length - 1 && block.type === "p" && !block.text && all.length > 1));
    try {
      const saved = await window.anybot.request("docs.save", {
        conversation: conversation.id,
        revision: docRef.current.revision,
        blocks: payload,
      });
      sentDirty.forEach((id) => dirty.current.delete(id));
      sentDeleted.forEach((id) => deleted.current.delete(id));
      setDoc(saved);
      setState(dirty.current.size ? "unsaved" : "saved");
    } catch (error) {
      if (/Document changed/.test(error.message)) {
        const remote = await window.anybot.request("docs.get", { conversation: conversation.id });
        const merged = mergeBlocks(remote.blocks, blocksRef.current, dirty.current, deleted.current);
        setDoc(remote);
        setBlocks(merged.length ? merged : [blankBlock()]);
        blocksRef.current = merged;
        docRef.current = remote;
        saving.current = false;
        return save();
      }
      setState("error");
    } finally {
      saving.current = false;
    }
    if (dirty.current.size) timer.current = setTimeout(save, SAVE_DELAY);
  }, [conversation.id]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    save();
  }, [save]);

  const commit = (next, changed = [], removed = []) => {
    changed.forEach((id) => dirty.current.add(id));
    removed.forEach((id) => {
      deleted.current.add(id);
      dirty.current.delete(id);
    });
    setBlocks(next);
    blocksRef.current = next;
    setState("unsaved");
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY);
  };

  const numbers = useMemo(() => {
    let n = 0;
    return blocks.map((block) => (block.type === "number" ? ++n : (n = 0)));
  }, [blocks]);

  const menuItems = (() => {
    if (!menu) return [];
    if (menu.kind === "slash")
      return filterSlash(menu.query).map((item) => ({ key: item.type, label: item.label, hint: item.hint, item }));
    const q = menu.query.toLowerCase();
    if (menu.kind === "mention")
      return [
        ...members.map((e) => ({ key: `agent:${e.id}`, label: `@${e.name}`, hint: e.role, token: `@[${e.name}](agent:${e.id})` })),
        ...projectTasks.map((t) => ({ key: `task:${t.id}`, label: t.title, hint: statusLabel(t.status), token: `@[${t.title.replace(/[\[\]\n]/g, "").slice(0, 80)}](task:${t.id})` })),
        ...files.map((f) => ({ key: `file:${f.id}`, label: f.name, hint: "File", token: `@[${f.name.replace(/[\[\]\n]/g, "").slice(0, 80)}](file:${f.id})` })),
      ]
        .filter((item) => item.label.toLowerCase().includes(q))
        .slice(0, 8);
    if (menu.kind === "task")
      return projectTasks
        .filter((t) => t.title.toLowerCase().includes(q))
        .slice(0, 8)
        .map((t) => ({ key: t.id, label: t.title, hint: statusLabel(t.status), ref: t.id }));
    return files
      .filter((f) => f.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((f) => ({ key: f.id, label: f.name, hint: "File", ref: f.id }));
  })();

  const pick = (choice) => {
    if (!menu || !choice) return;
    const index = blocksRef.current.findIndex((b) => b.id === menu.blockId);
    if (index < 0) return setMenu(null);
    const block = blocksRef.current[index];
    if (menu.kind === "slash") {
      const type = choice.item.type;
      if (type === "task" || type === "file") {
        setMenu({ kind: type, blockId: block.id, query: "", active: 0 });
        commit(blocksRef.current.map((b) => (b.id === block.id ? { ...b, text: "" } : b)), [block.id]);
        return;
      }
      const next = changeType(blocksRef.current.map((b) => (b.id === block.id ? { ...b, text: "" } : b)), index, type);
      commit(next, [block.id, ...(next.length > blocksRef.current.length ? [next.at(-1).id] : [])]);
      setMenu(null);
      setFocus(type === "divider" ? { id: next[index + 1].id, caret: 0 } : { id: block.id, caret: 0 });
      return;
    }
    if (menu.kind === "mention") {
      const text = `${block.text.slice(0, menu.start)}${choice.token} ${block.text.slice(menu.caret)}`;
      commit(blocksRef.current.map((b) => (b.id === block.id ? { ...b, text } : b)), [block.id]);
      setMenu(null);
      setFocus({ id: block.id, caret: menu.start + choice.token.length + 1 });
      return;
    }
    const next = changeType(blocksRef.current, index, menu.kind, { ref: choice.ref, text: menu.kind === "file" ? choice.label : "" });
    commit(next, [block.id, ...(next.length > blocksRef.current.length ? [next.at(-1).id] : [])]);
    setMenu(null);
    setFocus({ id: next[index + 1].id, caret: 0 });
  };

  const onChange = (block, index, value, caret) => {
    let next = blocksRef.current.map((b) => (b.id === block.id ? { ...b, text: value } : b));
    const changed = [block.id];
    // Markdown shortcuts: "# " at the start of a text block.
    const shortcut = block.type === "p" && value.match(/^(\S{1,3}) /);
    const type = shortcut && shortcutFor(shortcut[1]);
    if (type) {
      next = changeType(next.map((b) => (b.id === block.id ? { ...b, text: value.slice(shortcut[0].length) } : b)), index, type);
      if (next.length > blocksRef.current.length) changed.push(next.at(-1).id);
      commit(next, changed);
      setMenu(null);
      setFocus(type === "divider" ? { id: next[index + 1].id, caret: 0 } : { id: block.id, caret: 0 });
      return;
    }
    commit(next, changed);
    if (block.type !== "code" && value.startsWith("/") && !value.includes(" ", 0) && index >= 0 && TEXT_TYPES.includes(block.type)) {
      setMenu({ kind: "slash", blockId: block.id, query: value.slice(1), active: 0 });
      return;
    }
    const at = value.lastIndexOf("@", caret - 1);
    if (block.type !== "code" && at >= 0 && (at === 0 || /\s/.test(value[at - 1])) && !/[\s\]]/.test(value.slice(at + 1, caret))) {
      setMenu({ kind: "mention", blockId: block.id, query: value.slice(at + 1, caret), active: 0, start: at, caret });
      return;
    }
    if (menu && (menu.kind === "slash" || menu.kind === "mention")) setMenu(null);
    if (menu && (menu.kind === "task" || menu.kind === "file") && menu.blockId === block.id)
      setMenu({ ...menu, query: value, active: 0 });
  };

  const onKeyDown = (event, block, index, input) => {
    if (menu && menu.blockId === block.id) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setMenu({ ...menu, active: (menu.active + delta + menuItems.length) % Math.max(1, menuItems.length) });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(menuItems[menu.active]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(null);
        return;
      }
    }
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (block.type === "code") {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        const created = blankBlock();
        const next = [...blocksRef.current];
        next.splice(index + 1, 0, created);
        commit(next, [created.id]);
        setFocus({ id: created.id, caret: 0 });
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const result = splitBlock(blocksRef.current, index, start);
      commit(result.blocks, result.blocks.slice(index, index + 2).map((b) => b.id));
      setFocus({ id: result.focus, caret: result.caret });
      return;
    }
    if (event.key === "Backspace" && start === 0 && end === 0) {
      const result = backspaceBlock(blocksRef.current, index);
      if (!result) return;
      event.preventDefault();
      const removed = blocksRef.current.filter((b) => !result.blocks.some((n) => n.id === b.id)).map((b) => b.id);
      commit(result.blocks, [result.focus], removed);
      setFocus({ id: result.focus, caret: result.caret });
      return;
    }
    if (event.key === "ArrowUp" && start === 0 && index > 0) {
      event.preventDefault();
      setFocus({ id: blocksRef.current[index - 1].id, caret: null });
    }
    if (event.key === "ArrowDown" && start === input.value.length && index < blocksRef.current.length - 1) {
      event.preventDefault();
      setFocus({ id: blocksRef.current[index + 1].id, caret: 0 });
    }
    if (event.key === "Escape") input.blur();
  };

  const remove = (block, index) => {
    let next = blocksRef.current.filter((b) => b.id !== block.id);
    if (!next.length) next = [blankBlock()];
    commit(next, [], [block.id]);
    const target = next[Math.max(0, index - 1)];
    setFocus({ id: target.id, caret: null });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const openHistory = async () => {
    if (history) return setHistory(null);
    await save();
    const { versions } = await window.anybot.request("docs.history", { conversation: conversation.id });
    setHistory(versions);
  };

  const who = (author) =>
    author === "human" ? "You" : data.employees.find((e) => e.id === author)?.name || (author ? "Former employee" : "");
  // Files and chat links can be dropped into the page as embeds or cards.
  const insert = (extra) => {
    const created = { ...blankBlock(extra.type), ...extra };
    const current = blocksRef.current;
    const last = current.at(-1);
    const next = last && last.type === "p" && !last.text ? [...current.slice(0, -1), created, last] : [...current, created, blankBlock()];
    commit(next, [created.id, next.at(-1).id]);
  };
  const empty = blocks.every((block) => block.type === "p" && !block.text);

  if (!doc) return <div className="project-doc loading">Loading the canvas…</div>;

  return (
    <div
      className={`project-doc${compact ? " is-compact" : ""}`}
      onClick={(event) => {
        const mention = event.target.closest?.("[data-mention]");
        if (!mention) return;
        const [kind, ref] = mention.dataset.mention.split(":");
        if (kind === "task") onOpenTask(ref);
        if (kind === "file") {
          const artifact = files.find((f) => f.id === ref);
          if (artifact) onOpenArtifact(artifact);
        }
      }}
    >
      <div className="doc-page">
        <header className="doc-header">
          <div className="canvas-title-row">
            <span className="canvas-kicker">Canvas</span>
            {compact && onExpand && (
              <button type="button" className="doc-history-button" onClick={onExpand}>
                <Maximize2 size={13} />
                Open full canvas
              </button>
            )}
          </div>
          <h1>{conversation.title}</h1>
          <div className="doc-meta">
            <span>
              {doc.updated
                ? `Edited by ${who(doc.updatedBy)} · ${when(doc.updated)}`
                : "A shared page for this conversation. You and your bots can both read and write it."}
            </span>
            <span className={`doc-save-state ${state}`} role="status">
              {state === "saving" ? "Saving…" : state === "unsaved" ? "Unsaved" : state === "error" ? "Not saved. Retrying on next edit." : "Saved"}
            </span>
            <button type="button" className="doc-history-button" onClick={openHistory} aria-expanded={Boolean(history)}>
              <History size={14} />
              History
            </button>
          </div>
          {history && (
            <div className="doc-history">
              <div className="doc-history-head">
                <strong>Earlier versions</strong>
                <button type="button" className="icon-button" aria-label="Close history" onClick={() => setHistory(null)}>
                  <X size={14} />
                </button>
              </div>
              {!history.length && <p className="muted">No earlier versions yet.</p>}
              <ol>
                {history.map((version) => (
                  <li key={version.id}>
                    <span>
                      <strong>{who(version.author)}</strong> · {when(version.created)}
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      onClick={async () => {
                        if (await act("docs.restore", { conversation: conversation.id, id: version.id })) {
                          setHistory(null);
                          load();
                        }
                      }}
                    >
                      <RotateCcw size={13} />
                      Restore
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </header>
        <div className="canvas-strips">
          <CanvasFiles
            files={files}
            runs={data.runs}
            employees={data.employees}
            open={strips.files}
            onToggle={() => setStrips((s) => ({ ...s, files: !s.files }))}
            onOpen={onOpenArtifact}
            onReveal={(file) => onRevealArtifact?.(file)}
            onInsert={insert}
          />
          <CanvasLinks
            links={links}
            employees={data.employees}
            open={strips.links}
            onToggle={() => setStrips((s) => ({ ...s, links: !s.links }))}
            onInsert={insert}
          />
        </div>
        {empty && !focus && (
          <CanvasTemplates
            onPick={(id) => {
              const next = fromTemplate(id);
              commit(next, next.map((b) => b.id), blocksRef.current.map((b) => b.id));
              setFocus({ id: next[1]?.id || next[0].id, caret: 0 });
            }}
          />
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) return;
            const from = blocksRef.current.findIndex((b) => b.id === active.id);
            const to = blocksRef.current.findIndex((b) => b.id === over.id);
            commit(arrayMove(blocksRef.current, from, to), [active.id]);
          }}
        >
          <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            <div className="doc-blocks">
              {blocks.map((block, index) => {
                const task = block.type === "task" && data.tasks.find((t) => t.id === block.ref);
                const file = block.type === "file" && files.find((f) => f.id === block.ref);
                const author = block.author && data.employees.find((e) => e.id === block.author);
                const people = task ? task.assignees.map((id) => data.employees.find((e) => e.id === id)).filter(Boolean) : [];
                return (
                  <DocBlock
                    key={block.id}
                    block={block}
                    number={numbers[index]}
                    focused={focus?.id === block.id}
                    caret={focus?.id === block.id ? focus.caret : null}
                    author={author}
                    onFocus={() => setFocus({ id: block.id, caret: null })}
                    onChange={(value, caret) => onChange(block, index, value, caret)}
                    onKeyDown={(event, input) => onKeyDown(event, block, index, input)}
                    onToggle={() => commit(blocksRef.current.map((b) => (b.id === block.id ? { ...b, checked: !b.checked } : b)), [block.id])}
                    onRemove={() => remove(block, index)}
                    menu={
                      menu?.blockId === block.id && (
                        <Menu
                          items={menuItems}
                          active={Math.min(menu.active, Math.max(0, menuItems.length - 1))}
                          onPick={pick}
                          empty={menu.kind === "task" ? "No tasks on this board yet" : menu.kind === "file" ? "No files returned yet" : "No matches"}
                        />
                      )
                    }
                  >
                    {block.type === "task" &&
                      (task ? (
                        <button type="button" className="doc-task" onClick={() => onOpenTask(task.id)}>
                          <Columns3 size={15} />
                          <span className="doc-task-title">{task.title}</span>
                          <Status status={task.status === "in_progress" ? "working" : task.status} />
                          <span className="task-people">
                            {people.slice(0, 3).map((p) => (
                              <RobotAvatar small key={p.id} employee={p} />
                            ))}
                          </span>
                        </button>
                      ) : (
                        <span className="doc-task missing">This task was deleted.</span>
                      ))}
                    {block.type === "file" && (
                      <button type="button" className="doc-file" disabled={!file} onClick={() => file && onOpenArtifact(file)}>
                        <FileText size={15} />
                        {file?.name || block.text || "File no longer available"}
                      </button>
                    )}
                    {block.type === "table" && (
                      <TableBlock
                        block={block}
                        focused={focus?.id === block.id}
                        onFocus={() => setFocus({ id: block.id, caret: null })}
                        onChange={(rows) => commit(blocksRef.current.map((b) => (b.id === block.id ? { ...b, rows } : b)), [block.id])}
                        onRemove={() => remove(block, index)}
                      />
                    )}
                    {block.type === "link" && (
                      <LinkBlock
                        block={block}
                        focused={focus?.id === block.id}
                        onFocus={() => setFocus({ id: block.id, caret: null })}
                        onChange={(patch) => commit(blocksRef.current.map((b) => (b.id === block.id ? { ...b, ...patch } : b)), [block.id])}
                        onDone={() => {
                          const next = blocksRef.current[index + 1];
                          if (next) setFocus({ id: next.id, caret: 0 });
                        }}
                      />
                    )}
                  </DocBlock>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
        <button
          type="button"
          className="doc-tail"
          aria-label="Add a block at the end"
          onClick={() => {
            const last = blocksRef.current.at(-1);
            if (last && last.type === "p" && !last.text) return setFocus({ id: last.id, caret: 0 });
            const created = blankBlock();
            commit([...blocksRef.current, created], [created.id]);
            setFocus({ id: created.id, caret: 0 });
          }}
        />
      </div>
    </div>
  );
}
