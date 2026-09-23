import React, { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, Columns3, Plus, Rows3, Search, Zap } from "lucide-react";
import { RobotAvatar } from "../RobotAvatar.jsx";
import { Status } from "../Status.jsx";
import { TaskCard, TaskCardBody } from "./TaskCard.jsx";
import "./board.css";
import {
  PRIORITIES,
  PRIORITY_RANK,
  STATUSES,
  formatDue,
  isOverdue,
  isWorking,
  priorityLabel,
  statusLabel,
} from "./meta.js";

function NewTaskRow({ onCreate, autoFocus = false }) {
  const [open, setOpen] = useState(autoFocus);
  const [title, setTitle] = useState("");
  if (!open)
    return (
      <button type="button" className="board-new" onClick={() => setOpen(true)}>
        <Plus size={14} />
        New task
      </button>
    );
  const submit = async () => {
    const value = title.trim();
    if (!value) {
      setOpen(false);
      return;
    }
    await onCreate(value);
    setTitle("");
  };
  return (
    <input
      className="board-new-input"
      autoFocus
      aria-label="New task title"
      placeholder="Task title, then Enter"
      value={title}
      maxLength={200}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={() => !title.trim() && setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === "Enter") submit();
        if (event.key === "Escape") {
          setTitle("");
          setOpen(false);
        }
      }}
    />
  );
}

function Column({ status, ids, taskMap, employees, runs, selectedId, onOpen, onCreate }) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id, data: { status: status.id } });
  return (
    <section className={`board-column status-${status.id}${isOver ? " is-over" : ""}`} aria-label={status.label}>
      <header className="board-column-head">
        <span className="board-column-dot" />
        <h3>{status.label}</h3>
        <span className="board-column-count">{ids.length}</span>
      </header>
      <SortableContext id={status.id} items={ids} strategy={verticalListSortingStrategy}>
        <div className="board-column-body" ref={setNodeRef}>
          {ids.map((id) => (
            <TaskCard
              key={id}
              task={taskMap[id]}
              employees={employees}
              working={isWorking(runs, id)}
              selected={selectedId === id}
              onOpen={onOpen}
            />
          ))}
          {!ids.length && <p className="board-column-empty">No tasks</p>}
        </div>
      </SortableContext>
      <NewTaskRow onCreate={(title) => onCreate(title, status.id)} />
    </section>
  );
}

function BoardView({ tasks, employees, runs, selectedId, onOpen, onCreate, onMove }) {
  const taskMap = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);
  const grouped = useMemo(() => {
    const out = Object.fromEntries(STATUSES.map((s) => [s.id, []]));
    for (const task of [...tasks].sort((a, b) => a.sortKey - b.sortKey)) out[task.status]?.push(task.id);
    return out;
  }, [tasks]);
  const [drag, setDrag] = useState(null); // { id, items }
  // Holds the dropped arrangement until the move round-trips, so the card
  // does not snap back to its old column for a frame.
  const [pending, setPending] = useState(null);
  useEffect(() => setPending(null), [tasks]);
  const items = drag?.items || pending || grouped;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const containerOf = (id, source = items) =>
    source[id] ? id : Object.keys(source).find((key) => source[key].includes(id));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={({ active }) => setDrag({ id: active.id, items: grouped })}
      onDragCancel={() => setDrag(null)}
      onDragOver={({ active, over }) => {
        if (!over || !drag) return;
        const from = containerOf(active.id);
        const to = containerOf(over.id);
        if (!from || !to || from === to) return;
        setDrag((current) => {
          const next = { ...current.items };
          next[from] = next[from].filter((id) => id !== active.id);
          const index = next[to].indexOf(over.id);
          const target = [...next[to]];
          target.splice(index < 0 ? target.length : index, 0, active.id);
          next[to] = target;
          return { ...current, items: next };
        });
      }}
      onDragEnd={({ active, over }) => {
        const current = drag?.items || grouped;
        setDrag(null);
        if (!over) return;
        // onDragOver already moved the card into its destination column;
        // here it only settles its position within that column.
        const column = containerOf(active.id, current);
        if (!column) return;
        let list = current[column];
        const from = list.indexOf(active.id);
        const to = over.id === column ? list.length - 1 : list.indexOf(over.id);
        if (to >= 0 && to !== from) list = arrayMove(list, from, to);
        const position = list.indexOf(active.id);
        const before = list[position - 1] || null;
        const after = list[position + 1] || null;
        const original = grouped[taskMap[active.id].status];
        const unchanged =
          taskMap[active.id].status === column &&
          original[original.indexOf(active.id) - 1] === (before ?? undefined) &&
          original[original.indexOf(active.id) + 1] === (after ?? undefined);
        if (!unchanged) {
          setPending({ ...current, [column]: list });
          onMove(active.id, column, before, after);
        }
      }}
    >
      <div className="board-columns">
        {STATUSES.map((status) => (
          <Column
            key={status.id}
            status={status}
            ids={items[status.id]}
            taskMap={taskMap}
            employees={employees}
            runs={runs}
            selectedId={selectedId}
            onOpen={onOpen}
            onCreate={onCreate}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
        {drag?.id && taskMap[drag.id] ? (
          <TaskCardBody task={taskMap[drag.id]} employees={employees} working={isWorking(runs, drag.id)} overlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

const SORTERS = {
  title: (a, b) => a.title.localeCompare(b.title),
  status: (a, b) => STATUSES.findIndex((s) => s.id === a.status) - STATUSES.findIndex((s) => s.id === b.status) || a.sortKey - b.sortKey,
  priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  due: (a, b) => (a.due || "9999").localeCompare(b.due || "9999"),
};

function TableView({ tasks, employees, runs, selectedId, onOpen, onCreate }) {
  const [sort, setSort] = useState({ key: "status", dir: 1 });
  const rows = useMemo(() => [...tasks].sort((a, b) => SORTERS[sort.key](a, b) * sort.dir), [tasks, sort]);
  const header = (key, label) => (
    <th scope="col">
      <button
        type="button"
        className={sort.key === key ? "active" : ""}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}
      >
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
      </button>
    </th>
  );
  return (
    <div className="board-table-wrap">
      <table className="board-table">
        <thead>
          <tr>
            {header("title", "Task")}
            {header("status", "Status")}
            <th scope="col">Assignees</th>
            {header("priority", "Priority")}
            {header("due", "Due")}
            <th scope="col">Labels</th>
            <th scope="col">Checklist</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((task) => {
            const people = task.assignees.map((id) => employees.find((e) => e.id === id)).filter(Boolean);
            const done = task.checklist.filter((item) => item.done).length;
            return (
              <tr
                key={task.id}
                className={selectedId === task.id ? "is-selected" : ""}
                tabIndex={0}
                onClick={() => onOpen(task.id)}
                onKeyDown={(event) => event.key === "Enter" && onOpen(task.id)}
              >
                <td className="board-table-title">{task.title}</td>
                <td>
                  <Status status={isWorking(runs, task.id) ? "working" : task.status} />
                </td>
                <td>
                  <span className="task-people">
                    {people.map((person) => (
                      <RobotAvatar small key={person.id} employee={person} />
                    ))}
                    {!people.length && <span className="muted">Unassigned</span>}
                  </span>
                </td>
                <td>{task.priority === "none" ? <span className="muted">None</span> : <span className={`priority-chip ${task.priority}`}>{priorityLabel(task.priority)}</span>}</td>
                <td className={isOverdue(task.due, task.status) ? "overdue" : ""}>{formatDue(task.due) || <span className="muted">None</span>}</td>
                <td>
                  {task.labels.map((label) => (
                    <span className="task-label" key={label}>
                      {label}
                    </span>
                  ))}
                </td>
                <td>{task.checklist.length ? `${done}/${task.checklist.length}` : <span className="muted">None</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="board-table-new">
        <NewTaskRow onCreate={(title) => onCreate(title, "backlog")} />
      </div>
    </div>
  );
}

export function ProjectBoard({ conversation, tasks, employees, runs, selectedId, onOpen, act }) {
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem("anybot-board-view") || "board";
    } catch {
      return "board";
    }
  });
  const [query, setQuery] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("");
  const members = employees.filter((e) => conversation.members.includes(e.id));
  const projectTasks = tasks.filter((task) => task.conversation === conversation.id);
  const term = query.trim().toLowerCase();
  const visible = projectTasks.filter(
    (task) =>
      (!term || task.title.toLowerCase().includes(term) || task.labels.some((l) => l.toLowerCase().includes(term))) &&
      (!assignee || (assignee === "none" ? !task.assignees.length : task.assignees.includes(assignee))) &&
      (!priority || task.priority === priority),
  );
  const chooseView = (next) => {
    setView(next);
    try {
      localStorage.setItem("anybot-board-view", next);
    } catch {}
  };
  const create = async (title, status) => {
    const next = await act("tasks.create", { conversation: conversation.id, title, status });
    const created = next?.tasks
      ?.filter((task) => task.conversation === conversation.id && task.title === title)
      .sort((a, b) => b.created.localeCompare(a.created))[0];
    return created;
  };
  const move = (id, status, before, after) => act("tasks.move", { id, status, before, after });

  return (
    <div className="project-board">
      <div className="board-toolbar">
        <div className="segmented" role="tablist" aria-label="Board view">
          <button role="tab" aria-selected={view === "board"} className={view === "board" ? "active" : ""} onClick={() => chooseView("board")}>
            <Columns3 size={14} />
            Board
          </button>
          <button role="tab" aria-selected={view === "table"} className={view === "table" ? "active" : ""} onClick={() => chooseView("table")}>
            <Rows3 size={14} />
            Table
          </button>
        </div>
        <label className="board-search">
          <Search size={14} />
          <input aria-label="Filter tasks" placeholder="Filter" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <select aria-label="Filter by assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <select aria-label="Filter by priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`board-autopilot${conversation.autopilot ? " on" : ""}`}
          aria-pressed={Boolean(conversation.autopilot)}
          title="When on, idle assignees start their top Backlog task automatically"
          onClick={() => act("conversations.setAutopilot", { conversation: conversation.id, enabled: !conversation.autopilot })}
        >
          <Zap size={14} />
          Autopilot {conversation.autopilot ? "on" : "off"}
        </button>
      </div>
      {projectTasks.length === 0 ? (
        <div className="board-empty">
          <h3>Plan the work, then hand it out.</h3>
          <p>
            Add tasks to the Backlog, assign one or more bots, and press Start. Bots post progress, tick checklists,
            and move cards as they go. Several bots on one task split it between a lead and collaborators.
          </p>
          <div className="board-empty-new">
            <NewTaskRow autoFocus onCreate={(title) => create(title, "backlog")} />
          </div>
        </div>
      ) : view === "board" ? (
        <BoardView tasks={visible} employees={employees} runs={runs} selectedId={selectedId} onOpen={onOpen} onCreate={create} onMove={move} />
      ) : (
        <TableView tasks={visible} employees={employees} runs={runs} selectedId={selectedId} onOpen={onOpen} onCreate={create} />
      )}
    </div>
  );
}

export { statusLabel };
