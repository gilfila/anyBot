import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { fileCandidates, linkPlainText } from "../lib/markdown.js";
import { FILE_PLATFORM, FileLinkContext, useFileLinkEvents, useFileRefs } from "./FileLinks.jsx";
import "./run-terminal.css";

const LIVE = ["queued", "running", "cancelling"];
const MAX_CHARS = 400_000;
const MAX_LINES = 4000;
// Paths are looked for in the newest lines only (files.check takes 64).
const PATH_LINES = 400;
// Colors and cursor moves from the CLI; the panel draws its own colors.
const clean = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r(?!\n)/g, "\n").replace(/\r/g, "");

// What kind of terminal line this is, for its color.
function kind(line) {
  if (line.startsWith("$ ")) return "command";
  if (line.startsWith("──")) return /── failed/.test(line) ? "error" : "rule";
  if (line.startsWith("⏺")) return "tool";
  if (line.startsWith("  ⎿") || line.startsWith("    ")) return "output";
  if (line.startsWith("✔")) return "ok";
  if (line.startsWith("✖") || /^\[exit [1-9]/.test(line)) return "error";
  if (line.startsWith("⚠")) return "warn";
  if (line.startsWith("●") || line.startsWith("✻") || line.startsWith("[exit")) return "meta";
  return "text";
}

// A bot's CLI, live: what the harness ran, each tool call and its output,
// the model's text, and stderr (runs.terminal, polled while the run is live).
// Web links open in the browser, and file paths link as they do in chat once
// main confirms them against the run's bot and conversation ("run:<id>" in
// files.check). The output is the bot's, so it only goes through the same
// escape-first rendering and files.* requests as a message.
export function RunTerminal({ run, paused = false, name = "Bot" }) {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef(null);
  const stick = useRef(true);
  const live = LIVE.includes(run.status);

  useEffect(() => {
    let stopped = false;
    let timer;
    let offset = 0;
    setText("");
    setLoaded(false);
    const poll = async () => {
      try {
        const chunk = await window.anybot.request("runs.terminal", { id: run.id, offset });
        if (stopped) return;
        offset = chunk.offset;
        if (chunk.text) setText((current) => (current + clean(chunk.text)).slice(-MAX_CHARS));
        setLoaded(true);
        if (LIVE.includes(chunk.status)) timer = setTimeout(poll, 700);
      } catch {
        if (!stopped) timer = setTimeout(poll, 2000);
      }
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // One poll loop per run: it keeps going while the run is queued or live.
  }, [run.id]);

  useLayoutEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);

  const lines = useMemo(() => text.replace(/\n$/, "").split("\n").slice(-MAX_LINES), [text]);
  const fileLinks = useContext(FileLinkContext);
  const scope = `run:${run.id}`;
  const candidates = useMemo(
    () => (fileLinks ? fileCandidates(lines.slice(-PATH_LINES).reverse(), FILE_PLATFORM, { plain: true }) : []),
    [lines, fileLinks],
  );
  const { box: linkBox, lookup } = useFileRefs(scope, candidates);
  const { handlers, menu } = useFileLinkEvents(scope, lookup);
  // Each line's HTML is kept until main's answers change, so a live log only
  // links its new lines on each poll.
  const answers = `${candidates.length}:${candidates.map((raw) => lookup(raw)?.state || "").join()}`;
  const linked = useRef({ answers: "", lines: new Map() });
  const html = useMemo(() => {
    if (linked.current.answers !== answers || linked.current.lines.size > 2 * MAX_LINES)
      linked.current = { answers, lines: new Map() };
    const cache = linked.current.lines;
    const files = candidates.length ? { platform: FILE_PLATFORM, lookup } : null;
    return lines.map((line) => {
      if (!cache.has(line)) cache.set(line, linkPlainText(line, { files }));
      return cache.get(line);
    });
  }, [lines, candidates, lookup, answers]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard: the text can still be selected by hand.
    }
  };
  const empty = !text
    ? run.status === "queued"
      ? paused
        ? "New work is paused, so this hasn't started. Resume new work to run it."
        : "Waiting for its turn…"
      : loaded
        ? live
          ? "Starting…"
          : "No terminal output was recorded for this run. Runs from before version 0.3.18 don't have one."
        : "Loading…"
    : "";

  return (
    <div className="run-terminal" ref={linkBox}>
      <div className="run-terminal-bar">
        <span className="run-terminal-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{name}'s terminal</span>
        {live && run.status === "running" && <span className="run-terminal-live">Live</span>}
        <button
          type="button"
          className="run-terminal-copy"
          disabled={!text}
          aria-label={`Copy ${name}'s terminal output`}
          title="Copy all of this output"
          onClick={copy}
        >
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copied ? "Copied" : "Copy all"}
        </button>
      </div>
      <pre
        ref={box}
        role="log"
        aria-label={`${name}'s terminal`}
        tabIndex={0}
        {...handlers}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {empty ? (
          <span className="t-meta">{empty}</span>
        ) : (
          lines.map((line, i) => (
            <span key={i} className={`t-${kind(line)}`}>
              <span dangerouslySetInnerHTML={{ __html: html[i] }} />
              {"\n"}
            </span>
          ))
        )}
        {live && run.status === "running" && <span className="run-terminal-cursor" aria-hidden="true" />}
      </pre>
      {menu}
    </div>
  );
}
