import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight, Copy, FolderOpen, Trash2 } from "lucide-react";
import { describeIssue, issueAge, issueReport } from "../lib/diagnostics.js";
import "./diagnostics.css";

const ACTION_LABELS = { employee: "Edit bot", harnesses: "Open harnesses", update: "Check for updates" };

// Settings → Diagnostics: problems Any Bot recorded on this computer, grouped
// by kind, with a plain-language next step for each.
export function DiagnosticsPanel({ data, onEditEmployee, onOpenHarnesses }) {
  const [list, setList] = useState({ groups: [], version: "" });
  const [open, setOpen] = useState(null);
  const [copied, setCopied] = useState(false);
  // Issues that were new when this visit started keep their tag until the
  // owner leaves, even though viewing marks them seen.
  const fresh = useRef(new Set());
  const refreshKey = `${data.diagnostics?.issues ?? 0}:${data.diagnostics?.unseen ?? 0}`;
  useEffect(() => {
    if (!window.anybot?.request) return undefined;
    let live = true;
    window.anybot
      .request("diagnostics.list")
      .then((result) => {
        if (!live) return;
        for (const group of result.groups) if (group.unseen) fresh.current.add(group.fp);
        setList(result);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [refreshKey]);
  // Viewing the panel clears the sidebar badge.
  useEffect(() => {
    if (data.diagnostics?.unseen) window.anybot?.request("diagnostics.markSeen").catch(() => {});
  }, [data.diagnostics?.unseen]);

  const act = (issue, action) => {
    if (action === "employee") {
      const employee = data.employees.find((e) => e.id === issue.context?.employeeId);
      if (employee) onEditEmployee(employee);
    } else if (action === "harnesses") onOpenHarnesses();
    else if (action === "update") window.anybot?.update?.check();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issueReport(list.groups, { version: list.version }));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable; Open log folder still works.
    }
  };
  const clear = async () => {
    const result = await window.anybot?.request("diagnostics.clear").catch(() => null);
    if (result) setList((current) => ({ ...current, groups: result.groups }));
  };
  const errors = list.groups.filter((group) => group.level === "error").length;
  return (
    <section className="diagnostics" aria-labelledby="diagnostics-title">
      <h2 id="diagnostics-title" className="settings-section-title">
        Diagnostics
      </h2>
      <div className="diagnostics-head">
        <div>
          <p>
            Problems Any Bot noticed on this computer: harness errors, bot updates it couldn't apply, update and install
            failures, and crashes. It keeps error details only, never your conversations, and nothing leaves this machine.
          </p>
        </div>
        <div className="diagnostics-actions">
          <button type="button" className="secondary" onClick={copy} disabled={!list.groups.length}>
            <Copy size={14} />
            {copied ? "Copied" : "Copy report"}
          </button>
          <button type="button" className="secondary" onClick={() => window.anybot?.request("diagnostics.reveal")}>
            <FolderOpen size={14} />
            Open log folder
          </button>
          <button type="button" className="secondary" onClick={clear} disabled={!list.groups.length}>
            <Trash2 size={14} />
            Clear
          </button>
        </div>
      </div>
      {!list.groups.length ? (
        <div className="diagnostics-empty">
          <CheckCircle2 size={18} />
          No problems recorded.
        </div>
      ) : (
        <>
          <p className="diagnostics-summary">
            {list.groups.length} {list.groups.length === 1 ? "issue" : "issues"}
            {errors ? ` · ${errors} ${errors === 1 ? "error" : "errors"}` : ""}
          </p>
          <ul className="diagnostics-list">
            {list.groups.map((group) => {
              const info = describeIssue(group);
              const expanded = open === group.fp;
              const context = Object.entries(group.context || {}).filter(([key]) => !/Id$/.test(key));
              return (
                <li key={group.fp} className={`diagnostic diagnostic-${group.level}`}>
                  <span className="diagnostic-icon" aria-hidden="true">
                    {group.level === "error" ? <AlertCircle size={16} /> : <AlertTriangle size={16} />}
                  </span>
                  <div className="diagnostic-body">
                    <div className="diagnostic-title">
                      <span className="diagnostic-level">{group.level === "error" ? "Error" : "Warning"}</span>
                      <strong>{info.title}</strong>
                      {group.count > 1 && <span className="diagnostic-count">×{group.count}</span>}
                      {info.bug && <span className="diagnostic-tag">Likely a bug</span>}
                      {fresh.current.has(group.fp) && <span className="diagnostic-new">New</span>}
                    </div>
                    {info.hint && <p className="diagnostic-hint">{info.hint}</p>}
                    {group.message && <p className="diagnostic-message">{group.message}</p>}
                    <div className="diagnostic-meta">
                      <time dateTime={group.last}>{issueAge(group.last)}</time>
                      <span>{group.code}</span>
                      <span>v{group.version}</span>
                      {(group.detail || context.length > 0) && (
                        <button type="button" className="diagnostic-more" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : group.fp)}>
                          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          Details
                        </button>
                      )}
                      {info.action && (
                        <button type="button" className="secondary diagnostic-action" onClick={() => act(group, info.action)}>
                          {ACTION_LABELS[info.action]}
                          <ArrowUpRight size={13} />
                        </button>
                      )}
                    </div>
                    {expanded && (
                      <div className="diagnostic-detail">
                        {context.length > 0 && (
                          <dl>
                            {context.map(([key, value]) => (
                              <React.Fragment key={key}>
                                <dt>{key}</dt>
                                <dd>{String(value)}</dd>
                              </React.Fragment>
                            ))}
                          </dl>
                        )}
                        {group.detail && <pre>{group.detail}</pre>}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
