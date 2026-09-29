import React, { useState } from "react";
import { Clock, Save } from "lucide-react";

// The interval as a number and a unit; stored as whole minutes (5–10080).
const UNITS = [
  ["minutes", 1],
  ["hours", 60],
  ["days", 1440],
];
export const splitInterval = (minutes) =>
  minutes % 1440 === 0
    ? { amount: minutes / 1440, unit: "days" }
    : minutes % 60 === 0
      ? { amount: minutes / 60, unit: "hours" }
      : { amount: minutes, unit: "minutes" };
export const joinInterval = (amount, unit) =>
  Math.round(Number(amount) * (UNITS.find(([name]) => name === unit)?.[1] || 1));

// Creates a routine, or edits one when `routine` is given.
export function RoutineForm({ data, busy, onSave, routine = null }) {
  const eligible = data.conversations
    .filter((c) => !c.archived || c.id === routine?.conversation)
    .map((c) => ({
      ...c,
      members: c.members.filter((id) =>
        data.employees.some((e) => e.id === id && !e.archived),
      ),
    }))
    .filter((c) => c.members.length);
  const [form, setForm] = useState(
    routine
      ? {
          name: routine.name,
          conversation: routine.conversation,
          employee: routine.employee,
          prompt: routine.prompt,
          ...splitInterval(routine.minutes),
        }
      : {
          name: "",
          conversation: eligible[0]?.id || "",
          employee: eligible[0]?.members[0] || "",
          prompt: "",
          amount: 1,
          unit: "hours",
        },
  );
  const minutes = joinInterval(form.amount, form.unit);
  const intervalOk = Number.isInteger(minutes) && minutes >= 5 && minutes <= 10080;
  const conversation = eligible.find((c) => c.id === form.conversation);
  const update = (field, value) => setForm({ ...form, [field]: value });
  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!intervalOk) return;
        const { amount, unit, ...rest } = form;
        onSave({ ...rest, minutes });
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
        Repeat every
        <span className="interval-field">
          <input
            type="number"
            required
            min="1"
            step="1"
            value={form.amount}
            aria-label="Repeat every"
            onChange={(e) => update("amount", e.target.value)}
          />
          <select value={form.unit} aria-label="Unit" onChange={(e) => update("unit", e.target.value)}>
            {UNITS.map(([name]) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </span>
      </label>
      {!intervalOk && (
        <p role="alert" className="field-error">
          Choose between 5 minutes and 7 days.
        </p>
      )}
      <p>
        {routine
          ? "Changing how often it repeats, or who does it, starts the clock again from now."
          : "Starts after the first interval. Missed occurrences are skipped."}{" "}
        Each run uses your employee's configured harness and account.
      </p>
      <button className="primary full" disabled={busy || !form.employee || !intervalOk}>
        {routine ? <Save size={16} /> : <Clock size={16} />}
        {routine ? "Save changes" : "Create routine"}
      </button>
    </form>
  );
}
