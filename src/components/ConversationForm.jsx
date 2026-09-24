import React, { useState } from "react";
import { Folder, MessageSquare, Plus, X } from "lucide-react";
import { Avatar } from "./Avatar.jsx";

export function ConversationForm({ employees, busy, onSave }) {
  const [title, setTitle] = useState(""),
    [members, setMembers] = useState([]);
  const [allowedFolders, setAllowedFolders] = useState([]);
  const [artifactsFolder, setArtifactsFolder] = useState("");

  async function chooseFolder(onSelect) {
    const path = await window.anybot?.chooseDirectory();
    if (path) onSelect(path);
  }

  function addAllowedFolder() {
    chooseFolder((path) => {
      if (!allowedFolders.includes(path)) {
        setAllowedFolders([...allowedFolders, path]);
      }
    });
  }

  function removeAllowedFolder(index) {
    setAllowedFolders(allowedFolders.filter((_, i) => i !== index));
  }

  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ title, members, allowedFolders, artifactsFolder });
      }}
    >
      <label>
        Project name
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
        <p>Create an employee first to start a project.</p>
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
      <div className="project-folders-section">
        <label>
          Allowed folders
          <small>Folders this project's agents may access</small>
        </label>
        <div className="folder-list">
          {allowedFolders.map((folder, index) => (
            <div key={index} className="folder-item">
              <Folder size={14} />
              <span className="folder-path">{folder}</span>
              <button
                type="button"
                className="folder-remove"
                onClick={() => removeAllowedFolder(index)}
                aria-label="Remove folder"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary folder-add"
            onClick={addAllowedFolder}
          >
            <Plus size={14} />
            Add folder
          </button>
        </div>
      </div>
      <div className="project-folders-section">
        <label>
          Artifacts folder
          <small>Default folder for project artifacts</small>
        </label>
        <div className="folder-picker">
          <input
            type="text"
            value={artifactsFolder}
            onChange={(e) => setArtifactsFolder(e.target.value)}
            placeholder="Choose a folder..."
            readOnly
          />
          <button
            type="button"
            className="secondary"
            onClick={() => chooseFolder(setArtifactsFolder)}
          >
            <Folder size={14} />
            Browse
          </button>
        </div>
      </div>
      <button className="primary full" disabled={busy || !members.length}>
        <MessageSquare size={16} />
        Create project
      </button>
    </form>
  );
}
