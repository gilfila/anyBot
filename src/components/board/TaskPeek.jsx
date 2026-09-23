import React, { useEffect, useState } from "react";
import {
  Check,
  CircleDot,
  FileText,
  MessageSquare,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { RobotAvatar } from "../RobotAvatar.jsx";
import { Status } from "../Status.jsx";
import { PRIORITIES, STATUSES, authorName, isWorking, statusLabel } from "./meta.js";

const time = (value) =>
  new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// Text fields save on blur (or Enter for single-line), Notion style.
// `wrap` renders a growing textarea that still commits on Enter (titles).
function InlineText({ value, onSave, multiline = false, wrap = false, className, placeholder, label, maxLength }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onSave(draft);
  };
  const Tag = multiline || wrap ? "textarea" : "input";
  return (
    <Tag
      className={className}
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      maxLength={maxLength}
      rows={multiline ? Math.min(14, Math.max(3, draft.split("\n").length + 1)) : wrap ? 1 : undefined}
      onChange={(event) => setDraft(wrap ? event.target.value.replace(/\n/g, " ") : event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (!multiline && event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function PeoplePicker({ members, selected, onChange, label }) {
  const [open, setOpen] = useState(false);
  const chosen = selected.map((id) => members.find((m) => m.id === id)).filter(Boolean);
  const available = members.filter((m) => !selected.includes(m.id) && !m.archived);
  return (
    <div className="people-picker">
      {chosen.map((person, index) => (
        <span className="person-chip" key={person.id}>
          <RobotAvatar small employee={person} />
          {person.name}
          {index === 0 && selected.length > 1 && <em>lead</em>}
          <button
            type="button"
            aria-label={`Remove ${person.name} from ${label}`}
            onClick={() => onChange(selected.filter((id) => id !== person.id))}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      {available.length > 0 &&
        (open ? (
          <select
            autoFocus
            aria-label={`Add to ${label}`}
            defaultValue=""
            onBlur={() => setOpen(false)}
            onChange={(event) => {
              if (event.target.value) onChange([...selected, event.target.value]);
              setOpen(false);
            }}
          >
            <option value="" disabled>
              Choose a bot
            </option>
            {available.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        ) : (
          <button type="button" className="person-add" onClick={() => setOpen(true)}>
            <Plus size={12} />
            Add
          </button>
        ))}
      {!chosen.length && !open && <span className="muted">Nobody yet</span>}
    </div>
  );
}

const KIND_ICON = { comment: MessageSquare, progress: CircleDot, status: RotateCcw, started: Play };

export function TaskPeek({ taskId, data, conversation, act, onClose, onOpenArtifact }) {
  const task = data.tasks.find((item) => item.id === taskId);
  const [detail, setDetail] = useState(null);
  const [comment, setComment] = useState("");
  const [newItem, setNewItem] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const members = data.employees.filter((e) => conversation.members.includes(e.id));
  const working = isWorking(data.runs, taskId);
  const runKey = data.runs
    .filter((run) => run.task === taskId)
    .map((run) => run.status)
    .join();

  useEffect(() => {
    setConfirmDelete(false);
  }, [taskId]);
  useEffect(() => {
    let live = true;
    if (!task || !window.anybot) return;
    window.anybot
      .request("tasks.get", { id: taskId })
      .then((next) => live && setDetail(next))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [taskId, task?.revision, task?.updated, runKey, data.messages.length]);
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && !event.target.closest?.("input,textarea,select") && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!task) return null;
  const update = (patch) => act("tasks.update", { id: task.id, ...patch });
  const setChecklist = (checklist) => update({ checklist });

  return (
    <aside className="task-peek" aria-label={`Task: ${task.title}`}>
      <header className="task-peek-head">
        <span className="task-id">{task.id.slice(0, 8)}</span>
        <div className="task-peek-head-actions">
          {confirmDelete ? (
            <>
              <span className="muted">Delete this task?</span>
              <button type="button" className="danger" onClick={async () => (await act("tasks.delete", { id: task.id })) && onClose()}>
                Delete
              </button>
              <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="icon-button" aria-label="Delete task" title="Delete task" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} />
            </button>
          )}
          <button type="button" className="icon-button" aria-label="Close task" title="Close (Esc)" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="task-peek-body">
        <InlineText
          wrap
          className="task-peek-title"
          label="Task title"
          value={task.title}
          maxLength={200}
          onSave={(title) => title.trim() && update({ title })}
        />
        <div className="task-peek-actions">
          {working ? (
            <button type="button" className="secondary" onClick={() => act("tasks.stop", { id: task.id })}>
              <Square size={13} />
              Stop work
            </button>
          ) : task.status === "review" ? (
            <>
              <button type="button" className="primary" onClick={() => act("tasks.review", { id: task.id, decision: "approve" })}>
                <Check size={14} />
                Approve
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  act("tasks.review", { id: task.id, decision: "changes", comment: comment.trim() || undefined }).then(
                    (ok) => ok && setComment(""),
                  )
                }
              >
                <RotateCcw size={13} />
                Request changes
              </button>
            </>
          ) : task.status !== "done" ? (
            <button
              type="button"
              className="primary"
              disabled={!task.assignees.length}
              title={task.assignees.length ? "Queue this task for its assignees" : "Assign a bot first"}
              onClick={() => act("tasks.start", { id: task.id })}
            >
              <Play size={14} />
              {task.status === "in_progress" ? "Run again" : "Start"}
            </button>
          ) : null}
          {working && <Status status="working" />}
        </div>
        <dl className="task-props">
          <dt>Status</dt>
          <dd>
            <select
              aria-label="Status"
              value={task.status}
              onChange={(event) => act("tasks.move", { id: task.id, status: event.target.value })}
            >
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </dd>
          <dt>Assignees</dt>
          <dd>
            <PeoplePicker members={members} selected={task.assignees} label="assignees" onChange={(assignees) => update({ assignees })} />
          </dd>
          <dt>Reviewer</dt>
          <dd>
            <select aria-label="Reviewer" value={task.reviewer} onChange={(event) => update({ reviewer: event.target.value })}>
              <option value="">None (finishes when work succeeds)</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </dd>
          <dt>Priority</dt>
          <dd>
            <select aria-label="Priority" value={task.priority} onChange={(event) => update({ priority: event.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </dd>
          <dt>Due</dt>
          <dd>
            <input type="date" aria-label="Due date" value={task.due} onChange={(event) => update({ due: event.target.value })} />
          </dd>
          <dt>Labels</dt>
          <dd>
            <InlineText
              className="task-labels-input"
              label="Labels, comma separated"
              placeholder="Add labels, comma separated"
              value={task.labels.join(", ")}
              onSave={(value) =>
                update({ labels: [...new Set(value.split(",").map((l) => l.trim()).filter(Boolean))].slice(0, 10) })
              }
            />
          </dd>
        </dl>
        <section className="task-section">
          <h4>Description</h4>
          <InlineText
            multiline
            className="task-description"
            label="Description"
            placeholder="What does done look like? Bots see this when they start."
            value={detail?.task?.description ?? ""}
            maxLength={20000}
            onSave={(description) => update({ description })}
          />
        </section>
        <section className="task-section">
          <h4>
            Checklist
            {task.checklist.length > 0 && (
              <span className="muted">
                {task.checklist.filter((i) => i.done).length}/{task.checklist.length}
              </span>
            )}
          </h4>
          <ul className="task-checklist">
            {task.checklist.map((item, index) => (
              <li key={`${index}-${item.text}`} className={item.done ? "done" : ""}>
                <label>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() =>
                      setChecklist(task.checklist.map((entry, i) => (i === index ? { ...entry, done: !entry.done } : entry)))
                    }
                  />
                  <span>{item.text}</span>
                </label>
                <button
                  type="button"
                  aria-label={`Remove ${item.text}`}
                  onClick={() => setChecklist(task.checklist.filter((_, i) => i !== index))}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
          <input
            className="task-checklist-add"
            aria-label="Add checklist item"
            placeholder="Add an item, then Enter"
            value={newItem}
            maxLength={300}
            onChange={(event) => setNewItem(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && newItem.trim()) {
                setChecklist([...task.checklist, { text: newItem.trim(), done: false }]);
                setNewItem("");
              }
            }}
          />
        </section>
        {(detail?.runs?.length > 0 || detail?.artifacts?.length > 0) && (
          <section className="task-section">
            <h4>Work</h4>
            <ul className="task-work">
              {detail.runs.map((run) => (
                <li key={run.id}>
                  <RobotAvatar small employee={data.employees.find((e) => e.id === run.employee)} working={run.status === "running"} />
                  <span>{authorName(run.employee, data.employees)}</span>
                  <Status status={run.status} />
                  <time>{time(run.created)}</time>
                </li>
              ))}
              {detail.artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <button type="button" className="task-artifact" onClick={() => onOpenArtifact(artifact)}>
                    <FileText size={14} />
                    {artifact.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="task-section">
          <h4>Activity</h4>
          <ol className="task-activity">
            {(detail?.activity || []).map((entry) => {
              const Icon = KIND_ICON[entry.kind] || CircleDot;
              return (
                <li key={entry.id} className={`kind-${entry.kind}`}>
                  <Icon size={13} />
                  <div>
                    <p>
                      <strong>{authorName(entry.author, data.employees)}</strong>{" "}
                      {entry.kind === "comment" || entry.kind === "progress"
                        ? ""
                        : entry.kind === "pending-status"
                          ? `will move this to ${statusLabel(entry.body)} when everyone finishes`
                          : entry.kind === "status"
                            ? `moved ${entry.body.split(" → ").map(statusLabel).join(" → ")}`
                            : entry.body}
                    </p>
                    {(entry.kind === "comment" || entry.kind === "progress") && <p className="task-activity-body">{entry.body}</p>}
                    <time>{time(entry.created)}</time>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="task-comment">
            <textarea
              aria-label="Comment"
              placeholder="Add a comment. Bots read the latest activity when they work on this task."
              value={comment}
              maxLength={4000}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && comment.trim()) {
                  event.preventDefault();
                  act("tasks.comment", { id: task.id, body: comment.trim() }).then((ok) => ok && setComment(""));
                }
              }}
            />
          </div>
        </section>
      </div>
    </aside>
  );
}
