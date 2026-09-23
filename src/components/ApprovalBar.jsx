import React, { useEffect, useState } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import { RobotAvatar } from "./RobotAvatar.jsx";

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

// Requests from bots in this conversation that are waiting on the owner.
// Headless harnesses can't ask in a terminal, so they ask here; the bot's
// run is paused on the answer.
export function ApprovalBar({ approvals, employees, onDecide }) {
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
              <code title={approval.summary}>{approval.summary}</code>
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
