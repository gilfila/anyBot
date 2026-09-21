import React, { useState } from "react";
import { MessageSquare } from "lucide-react";
import { Avatar } from "./Avatar.jsx";

export function ConversationForm({ employees, busy, onSave }) {
  const [title, setTitle] = useState(""),
    [members, setMembers] = useState([]),
    [delegation, setDelegation] = useState(false);
  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ title, members, delegation });
      }}
    >
      <label>
        Conversation name
        <input
          required
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Product launch"
          autoFocus
        />
      </label>
      <label>Bring in your employees</label>
      {!employees.length && (
        <p>Create an employee first to start a conversation.</p>
      )}
      <div className="member-picker">
        {employees.map((e) => (
          <label className="checkbox" key={e.id}>
            <input
              type="checkbox"
              checked={members.includes(e.id)}
              onChange={() =>
                setMembers(
                  members.includes(e.id)
                    ? members.filter((m) => m !== e.id)
                    : [...members, e.id],
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
      <label className="checkbox trust">
        <input
          type="checkbox"
          checked={delegation}
          onChange={(e) => setDelegation(e.target.checked)}
        />
        <span>
          Allow employees to hand work to one another within this conversation.
          Limited to 8 runs per root task.
        </span>
      </label>
      <button className="primary full" disabled={busy || !members.length}>
        <MessageSquare size={16} />
        Start conversation
      </button>
    </form>
  );
}
