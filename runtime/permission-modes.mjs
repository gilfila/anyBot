// What each permission mode does, per harness, in the words the bot editor
// shows. Pure, shared with the renderer (src/components/EmployeeForm.jsx).
// Keep it in step with invocation() in runtime/adapters.mjs, which maps the
// modes to each CLI's flags (tests/permission-modes.test.mjs checks both).
const CHOICES = {
  claude: {
    auto: "Auto: safe actions run, risky ones ask you",
    dontAsk: "Edits run, everything else asks you",
    ask: "Ask before every action",
    hint: "Claude Code sends approval requests to the chat and waits up to 15 minutes for your answer. Time spent waiting doesn't count against the run's time limit.",
  },
  codex: {
    auto: "Auto: edits and commands run in its workspace sandbox",
    dontAsk: "Same as Auto, plus network access",
    ask: "Read-only: it can look, but can't change files",
    hint: "Codex can't ask you for approval when Any Bot runs it. Each mode is a sandbox, and anything outside it is refused: it writes only in its workspace and the project's folders (nowhere in Read-only).",
  },
  antigravity: {
    auto: "Auto: file edits run, commands are refused",
    dontAsk: "Everything runs, nothing asks you",
    ask: "Edits and commands are refused",
    hint: "Antigravity can't ask you for approval when Any Bot runs it, so what the mode doesn't allow is refused. \"Everything runs\" turns off its permission checks.",
  },
  cursor: {
    auto: "Auto: file edits run, commands that need approval are skipped",
    dontAsk: "Everything runs, nothing asks you",
    ask: "Same as Auto for Cursor Agent",
    hint: "Cursor Agent can't ask you for approval when Any Bot runs it, so Auto and Ask are the same. \"Everything runs\" passes --force.",
  },
  hermes: {
    auto: "Auto (Hermes uses its own settings)",
    dontAsk: "Edits run (no effect for Hermes)",
    ask: "Ask (no effect for Hermes)",
    hint: "Hermes runs with its own permission settings; this choice doesn't change what it may do.",
  },
};
const CUSTOM = {
  auto: "Auto",
  dontAsk: "Edits run",
  ask: "Ask before every action",
  hint: "A custom harness runs its own command line; this choice doesn't change it.",
};

export function permissionChoices(harness) {
  const choice = CHOICES[harness] || CUSTOM;
  return {
    options: ["auto", "dontAsk", "ask"].map((value) => ({ value, label: choice[value] })),
    hint: choice.hint,
  };
}
export function permissionLabel(harness, mode) {
  return (CHOICES[harness] || CUSTOM)[mode] || mode;
}
