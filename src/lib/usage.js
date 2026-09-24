// Token usage for Activity: per run and per bot per day. Runs carry `usage`
// under OpenTelemetry GenAI names (runtime/usage.mjs); input includes cached.

export function runTokens(run) {
  const usage = run?.usage;
  if (!usage || typeof usage !== "object") return null;
  const input = Number(usage["gen_ai.usage.input_tokens"]) || 0;
  const cached = Number(usage["gen_ai.usage.cached_input_tokens"]) || 0;
  const output = Number(usage["gen_ai.usage.output_tokens"]) || 0;
  const cost = Number(usage.cost_usd) || 0;
  if (!input && !output) return null;
  return { input, cached, output, cost };
}

export function formatTokens(value) {
  const n = Math.max(0, Number(value) || 0);
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, "")}M`;
}

export function formatCost(value) {
  const n = Number(value) || 0;
  if (!n) return "";
  return n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}

// "148k in · 12.8k cached · 1.5k out · $0.04"
export function describeTokens(tokens) {
  if (!tokens) return "";
  return [
    `${formatTokens(tokens.input)} in`,
    tokens.cached ? `${formatTokens(tokens.cached)} cached` : "",
    `${formatTokens(tokens.output)} out`,
    formatCost(tokens.cost),
  ]
    .filter(Boolean)
    .join(" · ");
}

const localDay = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

// Per-bot totals for the runs that ended on `day` (local time), largest first.
export function dailyTotals(runs = [], now = new Date()) {
  const day = localDay(now);
  const totals = new Map();
  for (const run of runs) {
    const tokens = runTokens(run);
    if (!tokens || localDay(run.ended || run.created) !== day) continue;
    const total = totals.get(run.employee) || { employee: run.employee, input: 0, cached: 0, output: 0, cost: 0, runs: 0 };
    total.input += tokens.input;
    total.cached += tokens.cached;
    total.output += tokens.output;
    total.cost += tokens.cost;
    total.runs += 1;
    totals.set(run.employee, total);
  }
  return [...totals.values()].sort((a, b) => b.input + b.output - (a.input + a.output));
}
