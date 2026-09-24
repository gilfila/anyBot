import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./run-terminal.css";

const LIVE = ["queued", "running", "cancelling"];
const MAX_CHARS = 400_000;
const MAX_LINES = 4000;
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
export function RunTerminal({ run, paused = false, name = "Bot" }) {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
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

  const lines = text.replace(/\n$/, "").split("\n").slice(-MAX_LINES);
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
    <div className="run-terminal">
      <div className="run-terminal-bar">
        <span className="run-terminal-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{name}'s terminal</span>
        {live && run.status === "running" && <span className="run-terminal-live">Live</span>}
      </div>
      <pre
        ref={box}
        role="log"
        aria-label={`${name}'s terminal`}
        tabIndex={0}
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
              {line}
              {"\n"}
            </span>
          ))
        )}
        {live && run.status === "running" && <span className="run-terminal-cursor" aria-hidden="true" />}
      </pre>
    </div>
  );
}
