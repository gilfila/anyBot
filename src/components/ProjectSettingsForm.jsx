import React, { useState } from "react";
import { Folder, Plus, Save, Trash2, X } from "lucide-react";

// Edit a project: its name, whether bots hand work to each other, and its
// folders. Deleting archives the project (like deleting a bot).
export function ProjectSettingsForm({ conversation, busy, onSave, onDelete }) {
  const [title, setTitle] = useState(conversation.title || "");
  const [delegation, setDelegation] = useState(Boolean(conversation.delegation));
  const [allowedFolders, setAllowedFolders] = useState(
    conversation.allowedFolders || []
  );
  const [artifactsFolder, setArtifactsFolder] = useState(
    conversation.artifactsFolder || ""
  );

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
        onSave({
          conversation: conversation.id,
          title,
          delegation,
          allowedFolders,
          artifactsFolder,
        });
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
      <label className="checkbox trust">
        <input
          type="checkbox"
          checked={delegation}
          onChange={(e) => setDelegation(e.target.checked)}
        />
        <span>
          Allow employees to hand work to one another within this project, and
          to bring each other into threads with @mentions. Limited to 8 runs per
          root task.
        </span>
      </label>
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
          {artifactsFolder && (
            <button
              type="button"
              className="secondary"
              onClick={() => setArtifactsFolder("")}
              title="Clear artifacts folder"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <button className="primary full" disabled={busy || !title.trim()}>
        <Save size={16} />
        Save changes
      </button>
      {onDelete && !conversation.archived && (
        <div className="danger-zone">
          <div>
            <strong>Delete project</strong>
            <small>Archives it and stops its work. Its history is kept, and you can restore it.</small>
          </div>
          <button type="button" className="danger" disabled={busy} onClick={() => onDelete(conversation)}>
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}
    </form>
  );
}
