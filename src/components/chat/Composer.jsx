import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, AtSign, FolderPlus, Mic, Paperclip } from "lucide-react";
import { RobotAvatar } from "../RobotAvatar.jsx";
import { AttachmentTray } from "./Attachments.jsx";
import { addAttachments, baseName, isImageName, MAX_ATTACHMENTS, MAX_THUMBNAIL } from "../../lib/attachments.js";
import { mentionedIds, mentionMatches, mentionQuery } from "../../../runtime/mentions.mjs";

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = (list) => (list.length > 2 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list.join(" and "));
const dataUrl = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes("Files");

// The message box. In a project, @mentions decide who works: type "@" for
// a menu, or click a bot under "To" to add (or remove) its mention.
// Files and folders can be dropped on it, pasted, or picked; `onSend`
// receives their paths and returns false when the send failed.
//   mode "project": a new message; one that names no bot is a note
//   mode "thread":  a reply; with no mention it goes to the thread's bots
//   mode "direct":  a one-bot chat; the bot always answers
export function Composer({
  bots,
  draft,
  setDraft,
  onSend,
  mode = "project",
  participants = [],
  busy = false,
  connected = true,
  placeholder,
  dictating = false,
  onDictate,
  label = "Message your team",
}) {
  const box = useRef(null);
  const listId = useId();
  const [menu, setMenu] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const bridge = typeof window !== "undefined" ? window.anybot : null;
  const canAttach = Boolean(bridge?.getPathForFile && bridge?.chooseAttachments);
  const ready = Boolean(draft.trim() || attachments.length);
  const attach = (items) => {
    setAttachments((current) => {
      const { list, dropped } = addAttachments(current, items);
      setNotice(dropped ? `Up to ${MAX_ATTACHMENTS} attachments per message; ${dropped} left out.` : "");
      return list;
    });
  };
  // A File from a drop or paste: its path on disk, a thumbnail for small
  // images. A pasted screenshot has no file yet, so the runtime saves one.
  const fromFile = async (file, folder = false) => {
    let path = bridge.getPathForFile(file);
    if (!path && !folder && file.type.startsWith("image/")) {
      const url = await dataUrl(file);
      path = (await bridge.request("attachments.savePasted", { mime: file.type, data: url.split(",")[1] || "" }))?.path;
      return path ? { path, name: baseName(path), kind: "file", size: file.size, thumbnail: file.size <= MAX_THUMBNAIL ? url : "" } : null;
    }
    if (!path) return null;
    const thumbnail = !folder && isImageName(path) && file.size <= MAX_THUMBNAIL ? await dataUrl(file) : "";
    return { path, name: baseName(path), kind: folder ? "folder" : "file", size: folder ? 0 : file.size, thumbnail };
  };
  const addFiles = async (entries) => {
    try {
      const items = (await Promise.all(entries.map(({ file, folder }) => fromFile(file, folder)))).filter(Boolean);
      if (items.length) attach(items);
      else if (entries.length) setNotice("Those items can't be attached. Drop files or folders from your computer.");
    } catch (error) {
      setNotice(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ""));
    }
  };
  const pick = async (kind) => {
    const paths = await bridge.chooseAttachments(kind);
    if (paths?.length) attach(paths.map((path) => ({ path, name: baseName(path), kind: kind === "folders" ? "folder" : "file" })));
    box.current?.focus();
  };
  const submit = async () => {
    if (busy || !ready) return;
    const sent = await onSend(attachments.map((item) => item.path));
    if (sent !== false) {
      setAttachments([]);
      setNotice("");
    }
  };
  const mentioned = mentionedIds(draft, bots);
  const nameOf = (id) => bots.find((b) => b.id === id)?.name;

  const look = (value, caret) => {
    const found = mode === "direct" ? null : mentionQuery(value, caret);
    const matches = found ? mentionMatches(found.query, bots) : [];
    setMenu(found && matches.length ? { ...found, caret, matches, index: 0 } : null);
  };
  // Put the caret after an inserted mention in the same commit as the new
  // text, before the next keystroke lands (a later frame could land mid-word).
  const caretTo = useRef(null);
  useLayoutEffect(() => {
    if (caretTo.current === null || !box.current) return;
    box.current.focus();
    box.current.setSelectionRange(caretTo.current, caretTo.current);
    caretTo.current = null;
  }, [draft]);
  const place = (position) => {
    caretTo.current = position;
  };
  const choose = (bot) => {
    const before = draft.slice(0, menu.start);
    const after = draft.slice(menu.caret);
    const insert = `@${bot.name} `;
    setDraft(before + insert + after.replace(/^ /, ""));
    setMenu(null);
    place(before.length + insert.length);
  };
  // "To" chips add or remove a bot's mention.
  const toggle = (bot) => {
    if (mentioned.includes(bot.id)) {
      const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_@])@${escapeRegExp(bot.name)}(?![\\p{L}\\p{N}_])\\s?`, "giu");
      setDraft(draft.replace(pattern, "$1").replace(/ {2,}/g, " "));
      return;
    }
    const caret = box.current ? box.current.selectionStart : draft.length;
    const before = draft.slice(0, caret);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const insert = `${lead}@${bot.name} `;
    setDraft(before + insert + draft.slice(caret));
    place(before.length + insert.length);
  };

  const hint =
    mode === "direct"
      ? ""
      : mentioned.length
        ? `Goes to ${names(mentioned.map(nameOf))}`
        : mode === "thread"
          ? participants.length
            ? `Goes to ${names(participants.map(nameOf).filter(Boolean))}, ${participants.length === 1 ? "who is" : "who are"} in this thread`
            : "Type @ to bring a bot into this thread"
          : "No bot mentioned, so this posts as a note. Type @ to put a bot to work.";

  return (
    <form
      className={dragging ? "composer dragging" : "composer"}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragOver={(e) => {
        if (!canAttach || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!canAttach || !hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        const entries = [...e.dataTransfer.items]
          .filter((item) => item.kind === "file")
          .map((item) => ({ file: item.getAsFile(), folder: Boolean(item.webkitGetAsEntry?.()?.isDirectory) }))
          .filter((entry) => entry.file);
        addFiles(entries);
      }}
    >
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <Paperclip size={18} />
          Drop to attach files or folders
        </div>
      )}
      {mode !== "direct" && (
        <div className="recipient-row">
          <span>To</span>
          {bots.map((bot) => (
            <button
              type="button"
              key={bot.id}
              className={mentioned.includes(bot.id) ? "recipient chosen" : "recipient"}
              aria-pressed={mentioned.includes(bot.id)}
              title={mentioned.includes(bot.id) ? `Remove @${bot.name}` : `Mention @${bot.name}`}
              onClick={() => toggle(bot)}
            >
              <AtSign size={12} aria-hidden="true" />
              {bot.name}
            </button>
          ))}
        </div>
      )}
      <div className="composer-field">
        {menu && (
          <ul className="mention-menu" id={listId} role="listbox" aria-label="Mention a bot">
            {menu.matches.map((bot, index) => (
              <li
                key={bot.id}
                role="option"
                aria-selected={index === menu.index}
                className={index === menu.index ? "active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(bot);
                }}
              >
                <RobotAvatar size={30} employee={bot} />
                <span>
                  <strong>{bot.name}</strong>
                  <small>{bot.role}</small>
                </span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={box}
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={Boolean(menu)}
          aria-controls={menu ? listId : undefined}
          placeholder={placeholder || (mode === "direct" ? "Message…" : "Give your team something to work on. Type @ to mention a bot.")}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            look(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => look(draft, e.target.selectionStart)}
          onBlur={() => setMenu(null)}
          onPaste={(e) => {
            if (!canAttach) return;
            const files = [...(e.clipboardData?.files || [])];
            if (!files.length) return;
            e.preventDefault();
            addFiles(files.map((file) => ({ file, folder: false })));
          }}
          onKeyDown={(e) => {
            if (menu) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setMenu({ ...menu, index: (menu.index + step + menu.matches.length) % menu.matches.length });
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                choose(menu.matches[menu.index]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMenu(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <AttachmentTray items={attachments} onRemove={(path) => setAttachments((list) => list.filter((item) => item.path !== path))} />
      {notice && <p className="attachment-notice" role="status">{notice}</p>}
      <div className="composer-bottom">
        <span className={mode !== "direct" && !mentioned.length && mode === "project" ? "composer-hint is-note" : "composer-hint"}>
          {hint || "Enter to send · Shift + Enter for a new line"}
        </span>
        <div className="composer-actions">
          {canAttach && (
            <>
              <button type="button" className="dictation attach" aria-label="Attach files" title="Attach files (or drop them here)" onClick={() => pick("files")}>
                <Paperclip size={16} />
              </button>
              <button type="button" className="dictation attach" aria-label="Attach a folder" title="Attach a folder" onClick={() => pick("folders")}>
                <FolderPlus size={16} />
              </button>
            </>
          )}
          {onDictate && (
            <button
              type="button"
              className={dictating ? "dictation active" : "dictation"}
              aria-label={dictating ? "Stop dictation" : "Dictate message"}
              title="Dictate with Flow-compatible speech input"
              onClick={onDictate}
            >
              <Mic size={17} />
            </button>
          )}
          <button className="send" aria-label="Send message" disabled={busy || !connected || !ready}>
            <ArrowUp size={19} />
          </button>
        </div>
      </div>
    </form>
  );
}
