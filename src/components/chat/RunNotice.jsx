import React, { useContext, useState } from "react";
import { Check, Copy, Info, RotateCcw, SquareTerminal, X } from "lucide-react";
import { Status } from "../Status.jsx";
import { RunTerminal } from "../RunTerminal.jsx";
import { useCopy } from "../hooks.js";
import { ChatContext } from "./ChatContext.js";

// A run that ended without a reply (failed, interrupted, or stopped), in the
// channel or a thread: what happened, its terminal, the error to copy, a
// retry of the same assignment (runs.retry), where to read more, and dismiss.
export function RunNotice({ run, employees, onDismiss }) {
  const chat = useContext(ChatContext);
  const [terminal, setTerminal] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [copied, copy] = useCopy();
  const bot = employees.find((e) => e.id === run.employee);
  const name = bot?.name || "A bot";
  const retry = async () => {
    setRetrying(true);
    try {
      await chat.onRetry(run.id);
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div className="run-notice">
      <div className="run-notice-content">
        <Status status={run.status} />
        <span>
          {name}: {run.error || "Stopped by you."}
        </span>
        {chat && (
          <div className="run-notice-actions">
            <button type="button" className="chip-button" aria-expanded={terminal} onClick={() => setTerminal(!terminal)}>
              <SquareTerminal size={13} aria-hidden="true" />
              {terminal ? "Hide terminal" : "Terminal"}
            </button>
            {run.error && (
              <button type="button" className="chip-button" onClick={() => copy(run.error)}>
                {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                {copied ? "Copied" : "Copy error"}
              </button>
            )}
            {bot && !bot.archived && (
              <button
                type="button"
                className="chip-button"
                disabled={retrying}
                title={`Run ${name} on the same message again`}
                onClick={retry}
              >
                <RotateCcw size={13} aria-hidden="true" />
                Retry
              </button>
            )}
            {run.status !== "cancelled" && (
              <button type="button" className="chip-button" onClick={() => chat.onDetails(run)}>
                <Info size={13} aria-hidden="true" />
                Details
              </button>
            )}
          </div>
        )}
        {terminal && <RunTerminal run={run} paused={chat?.paused} name={name} />}
      </div>
      <button className="run-notice-dismiss" aria-label="Dismiss notice" onClick={() => onDismiss(run.id)}>
        <X size={14} />
      </button>
    </div>
  );
}
