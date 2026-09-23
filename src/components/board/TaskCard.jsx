import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, CheckSquare } from "lucide-react";
import { RobotAvatar } from "../RobotAvatar.jsx";
import { formatDue, isOverdue, priorityLabel } from "./meta.js";

export function TaskCardBody({ task, employees, working, selected, overlay = false }) {
  const done = task.checklist.filter((item) => item.done).length;
  const people = task.assignees.map((id) => employees.find((e) => e.id === id)).filter(Boolean);
  return (
    <div
      className={`task-card${working ? " is-working" : ""}${selected ? " is-selected" : ""}${overlay ? " is-overlay" : ""}`}
    >
      <div className="task-card-title">{task.title}</div>
      {(task.priority !== "none" || task.due || task.labels.length > 0 || task.checklist.length > 0) && (
        <div className="task-card-meta">
          {task.priority !== "none" && (
            <span className={`priority-chip ${task.priority}`}>{priorityLabel(task.priority)}</span>
          )}
          {task.due && (
            <span className={`task-due${isOverdue(task.due, task.status) ? " overdue" : ""}`}>
              <CalendarDays size={12} />
              {formatDue(task.due)}
            </span>
          )}
          {task.checklist.length > 0 && (
            <span className={`task-checks${done === task.checklist.length ? " complete" : ""}`}>
              <CheckSquare size={12} />
              {done}/{task.checklist.length}
            </span>
          )}
          {task.labels.map((label) => (
            <span className="task-label" key={label}>
              {label}
            </span>
          ))}
        </div>
      )}
      <div className="task-card-foot">
        {working ? (
          <span className="task-live">
            <i />
            Working
          </span>
        ) : (
          <span className="task-id">{task.id.slice(0, 8)}</span>
        )}
        <span className="task-people">
          {people.slice(0, 4).map((person) => (
            <RobotAvatar small key={person.id} employee={person} working={working} />
          ))}
          {people.length > 4 && <span className="task-people-more">+{people.length - 4}</span>}
        </span>
      </div>
    </div>
  );
}

export function TaskCard({ task, employees, working, selected, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`task-card-slot${isDragging ? " is-dragging" : ""}`}
      {...attributes}
      {...listeners}
      aria-label={`${task.title}. Press Enter to open, Space to pick up`}
      onClick={() => onOpen(task.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen(task.id);
          return;
        }
        listeners?.onKeyDown?.(event);
      }}
    >
      <TaskCardBody task={task} employees={employees} working={working} selected={selected} />
    </div>
  );
}
