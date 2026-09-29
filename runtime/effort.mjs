// How hard a bot thinks, per harness. '' leaves it to the harness default.
// Claude Code: --effort; Codex: model_reasoning_effort ("low" is Codex's
// "light"). Other harnesses have no setting.
export const EFFORTS = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["low", "medium", "high", "xhigh", "max"],
};

export function effortFor(harness, value) {
  if (value === undefined || value === null || value === "") return "";
  const allowed = EFFORTS[harness];
  if (!allowed) throw new Error("This harness has no effort setting");
  if (!allowed.includes(value)) throw new Error(`Effort must be one of: ${allowed.join(", ")}`);
  return value;
}
