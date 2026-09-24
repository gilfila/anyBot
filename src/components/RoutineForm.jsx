import React, { useState } from "react";
import { Clock } from "lucide-react";

export function RoutineForm({ data, busy, onSave }) {
  const eligible = data.conversations
    .filter((c) => !c.archived)
    .map((c) => ({
      ...c,
      members: c.members.filter((id) =>
        data.employees.some((e) => e.id === id && !e.archived),
      ),
    }))
    .filter((c) => c.members.length);
  const [form, setForm] = useState({
    name: "",
    conversation: eligible[0]?.id || "",
    employee: eligible[0]?.members[0] || "",
    prompt: "",
    minutes: 60,
  });
  const conversation = eligible.find((c) => c.id === form.conversation);
  const update = (field, value) => setForm({ ...form, [field]: value });
  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
    >
      <label>
        Routine name
        <input
          required
          maxLength={100}
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="e.g. Review project progress"
          autoFocus
        />
      </label>
      <label>
        Conversation
        <select
          value={form.conversation}
          onChange={(e) =>
            setForm({
              ...form,
              conversation: e.target.value,
              employee:
                eligible.find((c) => c.id === e.target.value)?.members[0] || "",
            })
          }
        >
          {eligible.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Employee
        <select
          value={form.employee}
          onChange={(e) => update("employee", e.target.value)}
        >
          {conversation?.members.map((id) => (
            <option key={id} value={id}>
              {data.employees.find((e) => e.id === id)?.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assignment
        <textarea
          required
          value={form.prompt}
          onChange={(e) => update("prompt", e.target.value)}
          maxLength={12000}
          placeholder="Describe the work to repeat and the result you want."
        />
      </label>
      <label>
        Repeat every (minutes)
        <input
          type="number"
          required
          min="5"
          max="10080"
          step="1"
          value={form.minutes}
          onChange={(e) => update("minutes", Number(e.target.value))}
        />
      </label>
      <p>
        Starts after the first interval. Missed occurrences are skipped. Each
        run uses your employee's configured harness and account.
      </p>
      <button className="primary full" disabled={busy || !form.employee}>
        <Clock size={16} />
        Create routine
      </button>
    </form>
  );
}
