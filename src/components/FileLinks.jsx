import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Eye, FolderOpen } from "lucide-react";
import { FloatingMenu } from "./FloatingMenu.jsx";
import "./file-links.css";

// File links in messages. src/lib/file-refs.js finds the paths, main checks
// them (desktop/file-access.cjs), and a path only links once main says it
// exists. Every action goes through window.anybot.request("files.*"), where
// main inspects the path again; nothing here touches the preload's shell or
// folder bridges (tests/desktop-ipc.test.mjs checks this file).
export const FILE_PLATFORM = typeof navigator !== "undefined" && /^win/i.test(navigator.platform || "") ? "win32" : "posix";

// App provides { onFileAction(action, target) }; without it messages don't link.
export const FileLinkContext = createContext(null);

const LINKED = new Set(["file", "folder"]);
const FOUND_TTL = 60_000;
const OTHER_TTL = 15_000;
const RETRY_MS = 10_000;
const INFLIGHT_WAIT_MS = 250;
const MAX_CACHE = 5000;
// main's answers, per message and raw path, shared by every copy of a message
// on screen (the channel and its thread).
const cache = new Map();
const inflight = new Set();
const listeners = new Map();
const cacheKey = (message, raw) => `${message}\u0001${raw}`;
const notify = (message) => listeners.get(message)?.forEach((listener) => listener());

function remember(message, raw, ref) {
  const key = cacheKey(message, raw);
  // A busy drive's "unknown" doesn't unlink a path main already found.
  if (ref.state === "unknown" && LINKED.has(cache.get(key)?.ref.state)) return;
  cache.delete(key);
  cache.set(key, { ref, until: Date.now() + (LINKED.has(ref.state) ? FOUND_TTL : OTHER_TTL) });
  if (cache.size > MAX_CACHE) for (const old of [...cache.keys()].slice(0, cache.size - MAX_CACHE)) cache.delete(old);
}

// A click that found the file gone drops it, so the text goes back to plain.
export function forgetFileRef(message, raw) {
  cache.delete(cacheKey(message, raw));
  notify(message);
}

// Asks main about a message's candidate paths once it is near the screen:
// one files.check per message, at most one in flight (paths that turn up
// meanwhile, as a run's terminal grows, are asked about once it lands),
// answers cached (60 s for files and folders, 15 s otherwise), and one retry
// for "unknown" (a slow drive). Returns the element to watch and lookup(raw)
// for markdown.js.
export function useFileRefs(message, candidates) {
  const [, setVersion] = useState(0);
  const [visible, setVisible] = useState(false);
  const box = useRef(null);
  const wanted = candidates.join("\u0001");

  useEffect(() => {
    if (!message) return undefined;
    const bump = () => setVersion((version) => version + 1);
    if (!listeners.has(message)) listeners.set(message, new Set());
    const group = listeners.get(message);
    group.add(bump);
    return () => {
      group.delete(bump);
      if (!group.size) listeners.delete(message);
    };
  }, [message]);

  useEffect(() => {
    if (visible || !message || !wanted) return undefined;
    const node = box.current;
    if (!node || typeof IntersectionObserver !== "function") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setVisible(true);
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, message, wanted]);

  useEffect(() => {
    if (!visible || !message || !wanted || !window.anybot?.request) return undefined;
    const paths = wanted.split("\u0001");
    let stopped = false;
    let timer;
    const check = async (retry) => {
      const now = Date.now();
      const due = paths.filter((raw) => {
        const entry = cache.get(cacheKey(message, raw));
        return !entry || entry.until <= now || entry.ref.state === "unknown";
      });
      if (!due.length) return;
      if (inflight.has(message)) {
        if (!stopped) timer = setTimeout(() => check(retry), INFLIGHT_WAIT_MS);
        return;
      }
      inflight.add(message);
      let unknown = false;
      try {
        const answer = await window.anybot.request("files.check", { message, paths: due });
        const results = answer?.results && typeof answer.results === "object" ? answer.results : {};
        for (const raw of due) {
          const ref = results[raw] && typeof results[raw] === "object" ? results[raw] : { state: "unknown" };
          if (ref.state === "unknown") unknown = true;
          remember(message, raw, ref);
        }
      } catch {
        // A failed check leaves the paths as plain text.
      } finally {
        inflight.delete(message);
      }
      notify(message);
      if (unknown && retry && !stopped) timer = setTimeout(() => check(false), RETRY_MS);
    };
    check(true);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [visible, message, wanted]);

  // Ignores the TTL: a stale answer keeps showing until a fresh one lands.
  const lookup = useCallback((raw) => cache.get(cacheKey(message, raw))?.ref, [message]);
  return { box, lookup };
}

// Delegated handlers for a .markdown-content container. Click runs main's
// default action, Shift+click (or Shift+Enter) shows the file in its folder,
// and right-click, the Menu key, or Shift+F10 opens the menu. Only links whose
// path main confirmed for this message act, so bot HTML can't plant one.
export function useFileLinkEvents(message, lookup) {
  const links = useContext(FileLinkContext);
  const [menu, setMenu] = useState(null);
  if (!links) return { handlers: {}, menu: null };
  const find = (event) => {
    const el = event.target?.closest?.(".file-link[data-file-ref]");
    if (!el || !event.currentTarget.contains(el)) return null;
    const raw = el.getAttribute("data-file-ref");
    const ref = lookup(raw);
    return ref && LINKED.has(ref.state) ? { el, raw, ref } : null;
  };
  const run = (action, target, click = false) => links.onFileAction(action, { message, raw: target.raw, ref: target.ref, click });
  const primary = (target, shift) => {
    if (shift) return target.ref.reveal ? run("reveal", target) : setMenu(target);
    if (target.ref.action === "menu") return setMenu(target);
    return run(target.ref.action, target, true);
  };
  const handlers = {
    onClick(event) {
      const target = find(event);
      if (!target) return;
      event.preventDefault();
      primary(target, event.shiftKey);
    },
    onKeyDown(event) {
      const target = find(event);
      if (!target) return;
      if (event.key === "Enter") {
        event.preventDefault();
        primary(target, event.shiftKey);
      } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        setMenu(target);
      }
    },
    onContextMenu(event) {
      const target = find(event);
      if (!target) return;
      event.preventDefault();
      setMenu(target);
    },
  };
  return {
    handlers,
    menu: menu && <FileLinkMenu target={menu} onClose={() => setMenu(null)} onAction={(action) => run(action, menu)} />,
  };
}

// The same actions for one known path that isn't in a message's text (an
// attachment, a row in the Files panel), checked when it's used. `message`
// is the chat message the path belongs to, as for a file link; main inspects
// the path again for every action. Returns null without FileLinkContext.
//   open(raw, el, shift)  the default click; with shift, Show in folder
//   menu(raw, el)         Open / Preview / Show in folder / Copy path
//   element               the menu, when open (render it once)
// `owner`: the owner chose these paths (attachments, the Files panel). One
// main won't link (a network share) then still shows in its folder, as it
// did before file links, through App's onOwnerReveal (the owner-path bridge,
// which allows a share the owner picked) and without a diagnostics entry.
export function useFileActions(message, { owner = false } = {}) {
  const links = useContext(FileLinkContext);
  const [menu, setMenu] = useState(null);
  if (!links || !message) return null;
  const run = (action, raw, ref, click = false) =>
    ref.owner && action === "reveal" ? links.onOwnerReveal(raw) : links.onFileAction(action, { message, raw, ref, click });
  const check = async (raw) => {
    try {
      const answer = await window.anybot.request("files.check", { message, paths: [raw] });
      const ref = answer?.results?.[raw];
      return ref && typeof ref === "object" ? ref : { state: "unknown" };
    } catch {
      return { state: "unknown" };
    }
  };
  // Gone, refused, or unknown: Show in folder asks main, which checks again
  // and puts the reason in the banner when it can't. An owner path main
  // refused gets Show in folder and Copy path only.
  const settle = async (raw, el, choose) => {
    const ref = await check(raw);
    if (owner && ref.state === "refused" && links.onOwnerReveal) return choose({ el, raw, ref: ownerRef(raw, ref.reason) });
    if (!LINKED.has(ref.state)) return run("reveal", raw, ref);
    return choose({ el, raw, ref });
  };
  return {
    open: (raw, el, shift = false) =>
      settle(raw, el, (target) => {
        if (shift) return target.ref.reveal ? run("reveal", raw, target.ref) : setMenu(target);
        if (target.ref.action === "menu") return setMenu(target);
        return run(target.ref.action, raw, target.ref, true);
      }),
    menu: (raw, el) => settle(raw, el, setMenu),
    element: menu && <FileLinkMenu target={menu} onClose={() => setMenu(null)} onAction={(action) => run(action, menu.raw, menu.ref)} />,
  };
}

// A path main refused that the owner chose, shown in its folder by App.
const ownerRef = (raw, reason) => ({
  state: "file",
  owner: true,
  path: raw,
  name: raw.split(/[\\/]+/).filter(Boolean).pop() || raw,
  open: false,
  reveal: true,
  preview: null,
  action: "reveal",
  reason,
});

const WHY_NOT_OPEN = {
  "runs-programs": "Can run programs",
  "shell-pointer": "Shortcut file",
  "folder-name": "Named like a file",
  "not-supported": "Not opened by Any Bot",
  network: "Network location",
};

function FileLinkMenu({ target, onClose, onAction }) {
  const { ref } = target;
  const folder = ref.state === "folder";
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const away = (event) => {
      if (!event.target?.closest?.(".file-link-menu")) close.current();
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, []);
  const item = (action, label, Icon, allowed, why) => (
    <button
      type="button"
      role="menuitem"
      disabled={!allowed}
      title={allowed ? undefined : why}
      onClick={() => {
        onClose();
        onAction(action);
      }}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{label}</span>
      {!allowed && <small>{why}</small>}
    </button>
  );
  // A special folder (GodMode, Control Panel) is a shell pointer too.
  const why = folder && ref.reason === "shell-pointer" ? "Special folder" : WHY_NOT_OPEN[ref.reason];
  return (
    <FloatingMenu anchor={target.el} label={`Actions for ${ref.name}`} onClose={onClose} className="bot-row-menu file-link-menu">
      {item("open", folder ? "Open folder" : "Open", ExternalLink, ref.open, why || "Not opened by Any Bot")}
      {!folder && item("preview", "Preview", Eye, Boolean(ref.preview), "No preview for this type")}
      {item("reveal", "Show in folder", FolderOpen, ref.reveal, why || "Shortcut file")}
      {item("copy", "Copy path", Copy, true, "")}
    </FloatingMenu>
  );
}

// The file preview modal's buttons, from main's fresh answer (files.preview).
export function FileActions({ preview, target }) {
  const links = useContext(FileLinkContext);
  if (!links) return null;
  const from = { ...target, click: false, ref: { ...target.ref, path: preview.path, name: preview.name, open: preview.open } };
  const run = (action) => links.onFileAction(action, from);
  return (
    <div className="file-preview-actions">
      {preview.open && (
        <button type="button" className="secondary" onClick={() => run("open")}>
          <ExternalLink size={16} aria-hidden="true" />
          Open
        </button>
      )}
      {preview.reveal && (
        <button type="button" className="secondary" onClick={() => run("reveal")}>
          <FolderOpen size={16} aria-hidden="true" />
          Show in folder
        </button>
      )}
      <button type="button" className="secondary" onClick={() => run("copy")}>
        <Copy size={16} aria-hidden="true" />
        Copy path
      </button>
    </div>
  );
}

const cleanError = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': Error: /, "");
const extensionOf = (name) => (String(name || "").match(/\.[^.\\/]+$/)?.[0] || "").toLowerCase();

// What a file-link action does, for App. Open, reveal, and preview send the
// raw path back to main, which checks it again; Copy path copies main's
// canonical path. `click` marks the default click, which explains itself
// when it could only show the file in its folder.
export async function runFileAction(action, target, { setError, setNotice, openPreview }) {
  const { message, raw, ref } = target;
  setError("");
  setNotice("");
  try {
    if (action === "copy") {
      await navigator.clipboard.writeText(ref.path);
      setNotice(`Copied the path to ${ref.name}.`);
    } else if (action === "preview") {
      openPreview(await window.anybot.request("files.preview", { message, path: raw }), target);
    } else if (action === "open") {
      await window.anybot.request("files.open", { message, path: raw });
    } else if (action === "reveal") {
      await window.anybot.request("files.reveal", { message, path: raw });
      if (target.click && ref.state === "file" && !ref.open)
        setNotice(`Shown in folder. Any Bot doesn't open ${extensionOf(ref.name) || "these"} files.`);
      else if (target.click && ref.state === "folder" && !ref.open)
        setNotice("Shown in folder. Any Bot doesn't open folders named like that.");
    }
  } catch (error) {
    const text = cleanError(error);
    setError(text);
    if (/isn't there any more/.test(text)) forgetFileRef(message, raw);
  }
}
