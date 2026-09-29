import React, { useState } from "react";
import { Check } from "lucide-react";
import { Avatar } from "./Avatar.jsx";

export function ConversationMembersForm({ employees, selected, busy, onSave }) {
  const [members, setMembers] = useState(selected);
  // A project keeps two or more bots; trimmed to one it would stop being a
  // project (no board, no hand-offs). Delete it from its menu instead.
  const minimum = selected.length > 1 ? 2 : 1;
  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(members);
      }}
    >
      <p>Add or remove the employees who can receive work in this conversation.</p>
      <p>New bots receive conversation context. Previous messages stay when a bot leaves. Stop active work before removing bots; their routines in this conversation will be paused.</p>
      <div className="member-picker">
        {employees.map((e) => (
          <label className="checkbox" key={e.id}>
            <input
              type="checkbox"
              checked={members.includes(e.id)}
              onChange={() =>
                setMembers((current) =>
                  current.includes(e.id)
                    ? current.filter((id) => id !== e.id)
                    : [...current, e.id],
                )
              }
            />
            <Avatar small employee={e} />
            <span>
              {e.name}
              <small>{e.role}</small>
            </span>
          </label>
        ))}
      </div>
      {minimum > 1 && members.length < 2 && (
        <p className="field-hint">A project needs at least two bots. To stop using it, delete it from its menu in Projects.</p>
      )}
      <button className="primary full" disabled={busy || members.length < minimum}>
        <Check size={16} />
        Save bot membership
      </button>
    </form>
  );
}
