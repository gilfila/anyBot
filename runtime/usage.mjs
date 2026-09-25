// Token usage per run, read from the harness's own result events and stored
// under OpenTelemetry GenAI attribute names (docs/architecture/metrics.md).
// Numbers and model names only: nothing here may carry conversation text.

export const USAGE_KEYS = {
  input: "gen_ai.usage.input_tokens",
  cached: "gen_ai.usage.cached_input_tokens",
  output: "gen_ai.usage.output_tokens",
  model: "gen_ai.request.model",
  system: "gen_ai.system",
};

// Providers behind each built-in harness (OTel `gen_ai.system` values).
const SYSTEMS = { claude: "anthropic", codex: "openai", antigravity: "google.antigravity", cursor: "cursor", hermes: "hermes" };

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
const modelId = (value) =>
  typeof value === "string" && /^[\w.:/+[\]-]{1,120}$/.test(value) ? value : "";

export function usageState() {
  return { input: 0, cached: 0, output: 0, cost: 0, turns: 0, duration: 0, model: "", seen: false };
}

// Folds one parsed harness event into `state`. Input tokens always include
// cached ones, so uncached input is input − cached for every harness.
export function readUsage(harness, event, state) {
  if (!event || typeof event !== "object") return state;
  const model = modelId(event.model);
  if (model && ((event.type === "system" && event.subtype === "init") || event.type === "init")) state.model = model;
  if ((harness === "claude" || harness === "cursor") && event.type === "result") {
    const u = event.usage || {};
    const cached = count(u.cache_read_input_tokens ?? u.cacheReadTokens);
    state.input += count(u.input_tokens ?? u.inputTokens) + cached + count(u.cache_creation_input_tokens ?? u.cacheWriteTokens);
    state.cached += cached;
    state.output += count(u.output_tokens ?? u.outputTokens);
    state.cost += Number.isFinite(event.total_cost_usd) ? event.total_cost_usd : 0;
    state.turns += count(event.num_turns);
    state.duration += count(event.duration_ms);
    state.seen = true;
  }
  if (harness === "codex" && event.type === "turn.completed") {
    const u = event.usage || {};
    // Codex's input_tokens already include cached_input_tokens.
    state.input += count(u.input_tokens);
    state.cached += count(u.cached_input_tokens);
    state.output += count(u.output_tokens);
    state.turns += 1;
    state.seen = true;
  }
  // Antigravity's result usage is the run's total across its model calls.
  // output_tokens already include thinking_tokens (a one-word reply reports
  // 37 output with 34 thinking); cache_read_tokens are counted inside
  // input_tokens, as Gemini's API reports cached content.
  if (harness === "antigravity" && event.event === "result") {
    const u = event.result?.usage || {};
    state.input += count(u.input_tokens);
    state.cached += count(u.cache_read_tokens);
    state.output += count(u.output_tokens);
    state.duration += Math.round(count((event.result?.duration_seconds || 0) * 1000));
    state.turns += count(event.result?.num_turns) || 1;
    state.seen = true;
  }
  return state;
}

// The stored form, or null when the harness reported nothing.
export function finishUsage(state, { harness, model = "", durationMs = 0 } = {}) {
  if (!state?.seen) return null;
  const usage = {
    [USAGE_KEYS.input]: state.input,
    [USAGE_KEYS.cached]: Math.min(state.cached, state.input),
    [USAGE_KEYS.output]: state.output,
    [USAGE_KEYS.system]: SYSTEMS[harness] || "custom",
    turns: state.turns,
    duration_ms: state.duration || count(durationMs),
  };
  const requested = modelId(model) || state.model;
  if (requested) usage[USAGE_KEYS.model] = requested;
  if (state.cost > 0) usage.cost_usd = Math.round(state.cost * 1e6) / 1e6;
  return usage;
}

export function parseUsage(value) {
  if (!value) return null;
  try {
    const usage = JSON.parse(value);
    return usage && typeof usage === "object" ? usage : null;
  } catch {
    return null;
  }
}
