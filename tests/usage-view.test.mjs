import test from "node:test";
import assert from "node:assert/strict";
import { dailyTotals, describeTokens, formatCost, formatTokens, runTokens } from "../src/lib/usage.js";

const usage = (input, cached, output, cost) => ({
  "gen_ai.usage.input_tokens": input,
  "gen_ai.usage.cached_input_tokens": cached,
  "gen_ai.usage.output_tokens": output,
  ...(cost ? { cost_usd: cost } : {}),
});

test("token counts read compactly", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1515), "1.5k");
  assert.equal(formatTokens(12800), "12.8k");
  assert.equal(formatTokens(148409), "148k");
  assert.equal(formatTokens(2_400_000), "2.4M");
  assert.equal(formatCost(0), "");
  assert.equal(formatCost(0.004), "<$0.01");
  assert.equal(formatCost(0.123), "$0.12");
});

test("a run's tokens: input, cached, output, cost", () => {
  assert.equal(runTokens({}), null);
  assert.equal(runTokens({ usage: usage(0, 0, 0) }), null);
  const tokens = runTokens({ usage: usage(148409, 12800, 1515, 0.04) });
  assert.deepEqual(tokens, { input: 148409, cached: 12800, output: 1515, cost: 0.04 });
  assert.equal(describeTokens(tokens), "148k in · 12.8k cached · 1.5k out · $0.04");
  assert.equal(describeTokens(runTokens({ usage: usage(900, 0, 20) })), "900 in · 20 out");
});

test("daily totals per bot count only runs that ended today", () => {
  const now = new Date(2026, 8, 24, 15, 0);
  const today = new Date(2026, 8, 24, 9, 30).toISOString();
  const yesterday = new Date(2026, 8, 23, 23, 0).toISOString();
  const totals = dailyTotals(
    [
      { employee: "a", ended: today, usage: usage(100, 50, 10) },
      { employee: "a", ended: today, usage: usage(200, 0, 20, 0.5) },
      { employee: "b", ended: today, usage: usage(1000, 0, 5) },
      { employee: "b", ended: yesterday, usage: usage(9999, 0, 9) },
      { employee: "c", created: today },
    ],
    now,
  );
  assert.deepEqual(totals, [
    { employee: "b", input: 1000, cached: 0, output: 5, cost: 0, runs: 1 },
    { employee: "a", input: 300, cached: 50, output: 30, cost: 0.5, runs: 2 },
  ]);
});
