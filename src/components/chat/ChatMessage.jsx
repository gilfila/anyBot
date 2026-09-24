import React from "react";
import { Square, Workflow } from "lucide-react";
import { Avatar } from "../Avatar.jsx";
import { RobotAvatar } from "../RobotAvatar.jsx";
import { MessageContent } from "../MessageContent.jsx";
import { Status } from "../Status.jsx";
import { time } from "../../lib/ui.js";

// One message in the channel or a thread. `children` renders under the
// bubble (the thread summary, in the channel).
export function ChatMessage({ message: m, employees, bubbles, onOpenPreview, onOpenBrowser, children, compact = false }) {
  const author = employees.find((e) => e.id === m.author);
  return (
    <div
      className={`message ${m.kind}${m.author === "human" ? " from-you" : m.author === "system" ? " from-system" : " from-bot"}`}
      style={bubbles.get(m.author)}
    >
      {m.author === "human" ? (
        <Avatar small employee={{ name: "Y" }} />
      ) : m.author === "system" ? null : (
        <RobotAvatar size={compact ? 44 : 64} employee={author} />
      )}
      <div className="message-content">
        <div className="message-meta">
          <strong>{m.author === "human" ? "You" : author?.name || "Coordinator"}</strong>
          <span>{time(m.created)}</span>
          {m.kind === "handoff" && (
            <span className="handoff-label">
              <Workflow size={12} />
              Handoff
            </span>
          )}
        </div>
        <div className="message-body">
          <MessageContent body={m.body} onOpenPreview={onOpenPreview} onOpenBrowser={onOpenBrowser} people={employees.map((e) => e.name)} />
        </div>
        {children}
      </div>
    </div>
  );
}

// A run in progress, streaming its output.
export function LiveRun({ run, employees, bubbles, onStop, compact = false }) {
  const employee = employees.find((e) => e.id === run.employee);
  return (
    <div className="message live-run from-bot" style={bubbles.get(run.employee)}>
      <RobotAvatar size={compact ? 44 : 64} employee={employee} working />
      <div className="message-content">
        <div className="message-meta">
          <strong>{employee?.name}</strong>
          <Status status={run.status} />
          <button className="mini" onClick={() => onStop(run.id)}>
            <Square size={12} />
            Stop
          </button>
        </div>
        <div className="message-body">{run.output || (run.status === "queued" ? "Waiting for its turn…" : "Working…")}</div>
      </div>
    </div>
  );
}
