import React, { useEffect, useState } from "react";
import { Check, Copy, MessagesSquare, ShieldAlert, SquareTerminal, X } from "lucide-react";
import { RobotAvatar } from "./RobotAvatar.jsx";
import { RunTerminal } from "./RunTerminal.jsx";
import { useCopy } from "./hooks.js";

const TOOL_LABELS = {
  Bash: "run a command",
  PowerShell: "run a PowerShell command",
  Write: "create or overwrite a file",
  Edit: "edit a file",
  MultiEdit: "edit a file",
  NotebookEdit: "edit a notebook",
  WebFetch: "open a web page",
  WebSearch: "search the web",
  Read: "read a file outside its workspace",
};
export const describeTool = (tool) =>
  TOOL_LABELS[tool] || (tool.startsWith("mcp__") ? `use ${tool.split("__").slice(1).join(" › ")}` : `use ${tool}`);

// What an approval is for, read in full (the summary is one line until
// clicked), with the bot's terminal for context and a way to its thread.
function ApprovalDetails({ approval, run, name, paused, openThread, onOpenThread }) {
  const [full, setFull] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const [copied, copy] = useCopy();
  return (
    <>
      <button
        type="button"
        className={`approval-summary${full ? " is-full" : ""}`}
        aria-expanded={full}
        title={full ? "Show one line" : "Show all of it"}
        onClick={() => setFull(!full)}
      >
        <code>{approval.summary}</code>
      </button>
      <span className="approval-links">
        <button type="button" className="chip-button" onClick={() => copy(approval.summary)}>
          {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
        {run && (
          <button type="button" className="chip-button" aria-expanded={terminal} onClick={() => setTerminal(!terminal)}>
            <SquareTerminal size={12} aria-hidden="true" />
            {terminal ? "Hide terminal" : "Terminal"}
          </button>
        )}
        {run?.thread && onOpenThread && openThread !== run.thread && (
          <button type="button" className="chip-button" onClick={() => onOpenThread(run.thread)}>
            <MessagesSquare size={12} aria-hidden="true" />
            Open its thread
          </button>
        )}
      </span>
      {terminal && run && <RunTerminal run={run} paused={paused} name={name} />}
    </>
  );
}

// Requests from bots in this conversation that are waiting on the owner.
// Headless harnesses can't ask in a terminal, so they ask here; the bot's
// run is paused on the answer.
export function ApprovalBar({ approvals, employees, runs = [], paused = false, openThread = null, onOpenThread = null, onDecide }) {
  const [busy, setBusy] = useState(null);
  const pending = approvals.filter((approval) => approval.status === "pending");
  useEffect(() => setBusy(null), [pending.length]);
  if (!pending.length) return null;
  return (
    <div className="approval-bar" role="region" aria-label="Waiting for your approval">
      {pending.map((approval) => {
        const employee = employees.find((e) => e.id === approval.employee);
        const decide = async (decision) => {
          setBusy(approval.id);
          await onDecide(approval.id, decision);
        };
        return (
          <div className="approval" key={approval.id}>
            <span className="approval-icon" aria-hidden="true">
              <ShieldAlert size={16} />
            </span>
            {employee && <RobotAvatar size={52} employee={employee} />}
            <div className="approval-text">
              <strong>
                {employee?.name || "A bot"} wants to {describeTool(approval.tool)}
              </strong>
              <ApprovalDetails
                approval={approval}
                run={runs.find((r) => r.id === approval.run)}
                name={employee?.name || "Bot"}
                paused={paused}
                openThread={openThread}
                onOpenThread={onOpenThread}
              />
            </div>
            <div className="approval-actions">
              <button type="button" className="secondary" disabled={busy === approval.id} onClick={() => decide("deny")}>
                <X size={14} />
                Decline
              </button>
              <button type="button" className="primary" disabled={busy === approval.id} onClick={() => decide("allow")}>
                <Check size={14} />
                Approve
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
