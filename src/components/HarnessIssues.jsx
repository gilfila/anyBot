import React, { useState } from "react";
import { Check, Copy, FolderOpen, SquareTerminal } from "lucide-react";
import { Modal } from "./Modal.jsx";
import { issueAge } from "../lib/diagnostics.js";

// Harnesses → click a harness's status: what's wrong, whether its bots still
// work, where the problem lives, and how to fix it. A failed run opens its
// terminal in Activity (onOpenRun).
export function HarnessIssues({ harness, failures, onClose, onOpenRun }) {
  const issues = harness.issues || [];
  // The dialog covers the app's banner, so "Copied" shows on the button.
  const [copied, setCopied] = useState(null);
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied((current) => (current === text ? null : current)), 1600);
    } catch {
      // The path is on screen to select by hand.
    }
  };
  return (
    <Modal title={harness.name} onClose={onClose}>
      <div className="harness-issues">
        {issues.length === 0 && failures.length === 0 && <p>No known problems with {harness.name}.</p>}
        {issues.map((issue) => (
          <section key={issue.id} className="harness-issue" aria-label={issue.title}>
            <header>
              <h3>{issue.title}</h3>
              <span className={`issue-impact is-${issue.impact === "blocks" ? "blocks" : "none"}`}>
                {issue.impact === "blocks" ? "Runs will fail" : "Runs still work"}
              </span>
            </header>
            <p className="issue-details">{issue.details || issue.summary}</p>
            {issue.file && (
              <div className="issue-file">
                <code>{issue.file}</code>
                <button type="button" className="secondary" onClick={() => window.anybot?.revealPath?.(issue.file)}>
                  <FolderOpen size={14} />
                  Show in folder
                </button>
                <button type="button" className="secondary" onClick={() => copy(issue.file)}>
                  {copied === issue.file ? <Check size={14} /> : <Copy size={14} />}
                  {copied === issue.file ? "Copied" : "Copy path"}
                </button>
              </div>
            )}
            {issue.fix?.length > 0 && (
              <>
                <h4>How to fix it</h4>
                <ol>
                  {issue.fix.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </>
            )}
          </section>
        ))}
        {failures.length > 0 && (
          <section className="harness-issue" aria-label="Recent failed runs">
            <header>
              <h3>Recent failed runs</h3>
              <span className="issue-impact is-blocks">
                {failures.length} in the last week
              </span>
            </header>
            <ul className="issue-failures">
              {failures.slice(0, 5).map((f) => (
                <li key={f.id}>
                  <strong>{f.bot}</strong> <small>{issueAge(f.ended)}</small>
                  <p>{f.error.split("\n")[0].slice(0, 300)}</p>
                  {onOpenRun && (
                    <button type="button" className="secondary" onClick={() => onOpenRun(f.id)}>
                      <SquareTerminal size={14} />
                      Open its terminal
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="issue-hint">Each run's full output is in its terminal in Activity.</p>
          </section>
        )}
      </div>
    </Modal>
  );
}
