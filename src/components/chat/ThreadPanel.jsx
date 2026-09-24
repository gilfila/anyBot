import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronRight, MessagesSquare, X } from "lucide-react";
import { RobotAvatar } from "../RobotAvatar.jsx";
import { Status } from "../Status.jsx";
import { ChatMessage, LiveRun } from "./ChatMessage.jsx";
import { Composer } from "./Composer.jsx";
import { issueAge } from "../../lib/diagnostics.js";

const names = (list) => (list.length > 2 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list.join(" and "));

// Under a message in the channel: who's in its thread, how many replies,
// and who is working on it right now.
export function ThreadSummary({ entry, employees, open, onOpen }) {
  const nameOf = (id) => employees.find((e) => e.id === id)?.name || "A bot";
  const count = entry.replies.length;
  return (
    <button type="button" className={`thread-summary${open ? " is-open" : ""}`} onClick={onOpen} aria-expanded={open}>
      <span className="thread-avatars" aria-hidden="true">
        {entry.participants.slice(0, 4).map((id) => (
          <RobotAvatar key={id} size={26} employee={employees.find((e) => e.id === id)} working={entry.working.includes(id)} />
        ))}
      </span>
      <strong>{count ? `${count} ${count === 1 ? "reply" : "replies"}` : "Thread"}</strong>
      {entry.working.length ? (
        <span className="thread-working">
          <i aria-hidden="true" />
          {names(entry.working.map(nameOf))} {entry.working.length === 1 ? "is" : "are"} working
        </span>
      ) : entry.last ? (
        <span className="thread-last">Last reply {issueAge(entry.last)}</span>
      ) : null}
      {entry.failed.length > 0 && (
        <span className="thread-failed">
          <AlertCircle size={13} aria-hidden="true" />
          {entry.failed.length === 1 ? "A run failed" : `${entry.failed.length} runs failed`}
        </span>
      )}
      <ChevronRight size={15} className="thread-chevron" aria-hidden="true" />
    </button>
  );
}

// A thread beside the channel: its first message, every reply, work in
// progress, and a composer that answers in the thread.
export function ThreadPanel({ root, entry, runs, employees, bots, bubbles, onClose, onSend, onStop, onDismiss, busy, connected, onOpenPreview, onOpenBrowser }) {
  const [draft, setDraft] = useState("");
  const end = useRef(null);
  const live = runs.filter((r) => ["queued", "running", "cancelling"].includes(r.status));
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entry.replies.length, live.length]);
  return (
    <aside className="thread-panel" aria-label="Thread">
      <header className="thread-panel-head">
        <MessagesSquare size={18} aria-hidden="true" />
        <div>
          <h2>Thread</h2>
          <small>
            {entry.participants.length
              ? `with ${names(entry.participants.map((id) => employees.find((e) => e.id === id)?.name || "a bot"))}`
              : "No bots yet"}
          </small>
        </div>
        <button type="button" className="icon-button" aria-label="Close thread" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="thread-panel-body">
        <ChatMessage message={root} employees={employees} bubbles={bubbles} onOpenPreview={onOpenPreview} onOpenBrowser={onOpenBrowser} compact />
        <div className="thread-divider">
          <span>{entry.replies.length ? `${entry.replies.length} ${entry.replies.length === 1 ? "reply" : "replies"}` : "No replies yet"}</span>
        </div>
        {entry.replies.map((m) => (
          <ChatMessage key={m.id} message={m} employees={employees} bubbles={bubbles} onOpenPreview={onOpenPreview} onOpenBrowser={onOpenBrowser} compact />
        ))}
        {live.map((r) => (
          <LiveRun key={r.id} run={r} employees={employees} bubbles={bubbles} onStop={onStop} compact />
        ))}
        {entry.failed.map((r) => (
          <div className="run-notice" key={r.id}>
            <div className="run-notice-content">
              <Status status={r.status} />
              <span>
                {employees.find((e) => e.id === r.employee)?.name}: {r.error || "Stopped."}
              </span>
            </div>
            <button className="run-notice-dismiss" aria-label="Dismiss notice" onClick={() => onDismiss(r.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
        <div ref={end} />
      </div>
      <Composer
        bots={bots}
        draft={draft}
        setDraft={setDraft}
        mode="thread"
        participants={entry.participants}
        busy={busy}
        connected={connected}
        label="Reply in thread"
        placeholder="Reply in the thread. Type @ to bring in a bot."
        onSend={async () => {
          if (await onSend(draft)) setDraft("");
        }}
      />
    </aside>
  );
}
