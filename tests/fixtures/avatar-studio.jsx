// Browser-only fixture: exercises real components against an isolated bridge.
// Never launches a harness, reads the user's database, or changes a live employee.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.jsx";
import { RobotAvatarPreview } from "../../src/components/RobotAvatar.jsx";
import { empty } from "../../src/lib/ui.js";
import "../../src/style.css";

const listeners = new Set();
const models = ["scout", "orbit", "tinker"];
const employees = models.map((shape, i) => ({
  id: shape, name: shape[0].toUpperCase() + shape.slice(1), role: "Design verification",
  revision: 1, harness: "codex", workspace: "C:/avatar-verification", permissionMode: "ask",
  trusted: false, archived: false, instructions: "Test fixture", timeoutMinutes: 10,
  avatar: JSON.stringify({ version: 2, color: ["violet", "coral", "cobalt"][i], shape, face: "open" }),
}));
let snapshot = {
  ...empty, employees, conversations: models.map(id => ({ id: `chat-${id}`, title: id, members: [id], delegation: false })),
  harnesses: [{ id: "codex", name: "Codex CLI", installed: true, modelOptions: [] }],
};
window.anybot = {
  request: async (method, payload) => {
    if (method === "employees.update") {
      const output = document.getElementById("avatar-save-result");
      if (output) output.textContent = `Saved ${payload.id}: ${payload.avatar}`;
    }
    if (method === "employees.update") snapshot = { ...snapshot, employees: snapshot.employees.map(e => e.id === payload.id ? { ...e, ...payload, revision: e.revision + 1 } : e) };
    if (method === "snapshot" || method === "employees.update") return structuredClone(snapshot);
    return structuredClone(snapshot);
  },
  onChanged: fn => { listeners.add(fn); return () => listeners.delete(fn); },
};
function activity(state) {
  const stamp = new Date().toISOString();
  snapshot = { ...snapshot,
    runs: state === "idle" ? [] : models.map(id => ({ id: `run-${id}`, employee: id, conversation: `chat-${id}`, status: state === "working" ? "running" : "succeeded", created: stamp, output: "Verification complete" })),
    messages: state === "unread" ? models.map(id => ({ id: `reply-${id}-${stamp}`, conversation: `chat-${id}`, author: id, kind: "assistant", body: "Your work is complete.", created: stamp })) : [],
  };
  listeners.forEach(fn => fn());
}
function Fixture() {
  const [state, setState] = useState("idle");
  const [color, setColor] = useState("violet");
  return <>
    <section aria-label="Avatar verification controls" style={{ background: "var(--paper)", color: "var(--ink)", padding: 16 }}>
      <output id="avatar-save-result" aria-live="polite" />
      <div style={{ display: "flex", gap: 8 }}>
        {[["idle", "Reset to idle"], ["working", "Start work"], ["unread", "Finish with unread"]].map(([value, label]) =>
          <button key={value} onClick={() => { setState(value); activity(value); }}>{label}</button>)}
        <label>Color <select value={color} onChange={e => setColor(e.target.value)}>{["cobalt", "coral", "citron", "violet"].map(c => <option key={c}>{c}</option>)}</select></label>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 40 }}>
        {models.map(shape => <div key={shape}><RobotAvatarPreview color={color} shape={shape} size={210} animationState={state} /><p style={{ textAlign: "center" }}>{shape}</p></div>)}
      </div>
    </section>
    <App />
  </>;
}
const root = createRoot(document.getElementById("root"));
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
