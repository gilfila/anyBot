import React, { useState } from "react";
import { Folder, Plus, Save, X } from "lucide-react";

export function ProjectSettingsForm({ conversation, busy, onSave }) {
  const [title, setTitle] = useState(conversation.title || "");
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
        Save settings
      </button>
    </form>
  );
}
