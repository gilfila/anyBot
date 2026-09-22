import React, { useState, useMemo } from "react";
import { Check, Folder, Plus } from "lucide-react";
import { names, customModelValue, avatarColors, avatarShapes, avatarFaces } from "../constants.js";
import { SlimeAvatarPreview, parseAvatarConfig, stringifyAvatarConfig } from "./SlimeAvatar.jsx";

export function EmployeeForm({ preset, editing, busy, onSave, harnesses = [] }) {
  const optionsFor = (harness) => {
    const options = harnesses.find((item) => item.id === harness)?.modelOptions || [];
    const safe = harness === "claude"
      ? options.filter(({ value }) => ["fable", "sonnet", "opus"].includes(value))
      : options;
    return safe.map(({ value, label }) => [value, label]);
  };
  const initialChoices = optionsFor(preset?.harness || "claude");
  const initialKnown = initialChoices.some(
    ([value]) => value === preset?.model,
  );
  const initialAvatar = useMemo(() => 
    parseAvatarConfig(preset?.avatar, preset?.name || "", preset?.harness || "claude"),
    [preset?.avatar, preset?.name, preset?.harness]
  );
  const [form, setForm] = useState({
    id: preset?.id,
    revision: preset?.revision,
    name: preset?.name || "",
    role: preset?.role || "",
    harness: preset?.harness || "claude",
    instructions: preset?.instructions || "",
    workspace: preset?.workspace || "",
    model: preset?.model || "",
    timeoutMinutes: preset?.timeoutMinutes || 10,
    modelChoice: preset?.model
      ? initialKnown
        ? preset.model
        : customModelValue
      : "",
    permissionMode: editing
      ? preset?.permissionMode || "dontAsk"
      : "ask",
    trusted: editing ? Boolean(preset?.trusted) : false,
    avatarColor: initialAvatar.color,
    avatarShape: initialAvatar.shape,
    avatarFace: initialAvatar.face,
  });
  const set = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const modelChoices = optionsFor(form.harness);
  const handleSubmit = (e) => {
    e.preventDefault();
    const avatarConfig = stringifyAvatarConfig({
      color: form.avatarColor,
      shape: form.avatarShape,
      face: form.avatarFace,
    });
    onSave({ ...form, avatar: avatarConfig });
  };

  return (
    <form
      className="modal-form"
      onSubmit={handleSubmit}
    >
      <p>
        {editing
          ? "Update this employee. Existing conversations and completed work stay intact."
          : "Give your employee a name, a purpose, and an engine."}
      </p>
      <div className="form-row">
        <label>
          Name
          <input
            required
            maxLength={60}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Alex"
            autoFocus
          />
        </label>
        <label>
          Role
          <input
            required
            maxLength={120}
            value={form.role}
            onChange={(e) => set("role", e.target.value)}
            placeholder="e.g. Chief of staff"
          />
        </label>
      </div>
      <div className="avatar-customization">
        <div className="avatar-preview-section">
          <SlimeAvatarPreview
            color={form.avatarColor}
            shape={form.avatarShape}
            face={form.avatarFace}
            size={80}
          />
          <div className="avatar-preview-label">Avatar Preview</div>
        </div>
        <div className="avatar-options">
          <label>
            Color
            <div className="avatar-color-picker">
              {avatarColors.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  className={`avatar-color-swatch ${form.avatarColor === color.id ? "selected" : ""}`}
                  style={{ background: color.fill, borderColor: color.stroke }}
                  onClick={() => set("avatarColor", color.id)}
                  title={color.name}
                  aria-label={color.name}
                />
              ))}
            </div>
          </label>
          <div className="avatar-selects">
            <label>
              Shape
              <select
                value={form.avatarShape}
                onChange={(e) => set("avatarShape", e.target.value)}
              >
                {avatarShapes.map((shape) => (
                  <option key={shape.id} value={shape.id}>
                    {shape.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Expression
              <select
                value={form.avatarFace}
                onChange={(e) => set("avatarFace", e.target.value)}
              >
                {avatarFaces.map((face) => (
                  <option key={face.id} value={face.id}>
                    {face.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
      <label>
        Harness
        <select
          value={form.harness}
          onChange={(e) => {
            const harness = e.target.value;
            const choices = optionsFor(harness);
            const current = choices.some(([value]) => value === form.model)
              ? form.model
              : "";
            setForm((value) => ({
              ...value,
              harness,
              model: current,
              modelChoice: current,
            }));
          }}
        >
          {Object.entries({
            ...names,
            ...Object.fromEntries(harnesses.map((h) => [h.id, h.name])),
          }).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model <span className="optional">optional</span>
        <select
          aria-label="Model"
          value={form.modelChoice}
          onChange={(e) => {
            const choice = e.target.value;
            setForm((value) => ({
              ...value,
              modelChoice: choice,
              model: choice === customModelValue ? value.model : choice,
            }));
          }}
        >
          <option value="">Use the harness default</option>
          {modelChoices.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          <option value={customModelValue}>Custom model…</option>
        </select>
        {form.modelChoice === customModelValue && (
          <input
            aria-label="Custom model identifier"
            maxLength={120}
            value={form.model}
            onChange={(e) => set("model", e.target.value)}
            placeholder="e.g. provider/model-name"
            required
          />
        )}
        <span className="field-hint">
          Claude aliases follow the installed CLI. Codex, Gemini, and Hermes choices
          come from the owner-maintained models.json catalog; Custom model accepts a
          current account-specific identifier when the catalog is empty or incomplete.
        </span>
      </label>
      <label>
        Instructions <span className="optional">optional</span>
        <textarea
          value={form.instructions}
          onChange={(e) => set("instructions", e.target.value)}
          placeholder="What should this employee focus on? How should they work?"
          maxLength={12000}
        />
      </label>
      <label>
        Maximum run duration
        <select
          aria-label="Maximum run duration"
          value={form.timeoutMinutes}
          onChange={(e) => set("timeoutMinutes", Number(e.target.value))}
        >
          <option value={10}>10 minutes</option>
          <option value={60}>1 hour</option>
          <option value={360}>6 hours</option>
          <option value={1440}>24 hours</option>
        </select>
        <span className="field-hint">
          The harness stays active until it exits, is cancelled, or reaches this safety limit.
        </span>
      </label>
      <label>
        Workspace <span className="optional">optional</span>
        <div className="directory-input">
          <input
            value={form.workspace}
            onChange={(e) => set("workspace", e.target.value)}
            placeholder="Create a private workspace automatically"
          />
          <button
            type="button"
            aria-label="Choose workspace"
            onClick={async () => {
              const value = await window.anybot?.chooseDirectory();
              if (value) set("workspace", value);
            }}
          >
            <Folder size={17} />
          </button>
        </div>
      </label>
      <label>
        Permission mode
        <select
          aria-label="Permission mode"
          value={form.permissionMode}
          onChange={(e) => set("permissionMode", e.target.value)}
        >
          <option value="ask">Ask before acting</option>
          <option value="dontAsk">Allow edits automatically</option>
        </select>
        <span className="field-hint">
          Claude allows file edits without prompting in automatic mode.
          Cursor uses --force. Other harnesses are unchanged.
        </span>
      </label>
      <label className="checkbox trust">
        <input
          required
          type="checkbox"
          checked={form.trusted}
          onChange={(e) => set("trusted", e.target.checked)}
        />
        <span>
          I trust this harness to run locally with my account and configured
          tools. A separate workspace is not a security sandbox.
        </span>
      </label>
      <button disabled={busy} className="primary full">
        {editing ? <Check size={16} /> : <Plus size={16} />}{" "}
        {editing ? "Save changes" : "Create employee"}
      </button>
    </form>
  );
}
