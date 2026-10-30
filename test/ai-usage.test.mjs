import assert from "node:assert/strict";
import test from "node:test";

import { AI_PRICES, callCost, priceFor, priceModelKey } from "../lib/ai-prices.ts";
import {
  formatTokensShort,
  formatUsd,
  parseUsageMonth,
  usageCsv,
  usageResultLabel,
  recentUsageMonths,
  usageFromError,
  usageFromResult,
  usageMonthDays,
  usageMonthKey,
  usageMonthRange,
} from "../lib/ai-usage.ts";

const at = Date.UTC(2026, 9, 30, 10, 42);
const usd = (cost) => {
  assert.equal(cost.kind, "priced");
  return Math.round(cost.usd * 1e9) / 1e9;
};

test("a call is priced as uncached input, cached input and output, per million tokens", () => {
  // gpt-5.4 Standard: $2.50 input, $0.25 cached input, $15 output per 1M.
  const cost = callCost({ model: "gpt-5.4", inputTokens: 3_412, cachedInputTokens: 2_048, outputTokens: 318, createdAt: at });
  assert.equal(usd(cost), (1_364 * 2.5 + 2_048 * 0.25 + 318 * 15) / 1e6);
});

test("reasoning tokens are already inside output tokens and are never billed twice", () => {
  const base = { model: "gpt-5.4", inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 800, createdAt: at };
  const withoutReasoning = usd(callCost(base));
  assert.equal(usd(callCost({ ...base, reasoningTokens: 600 })), withoutReasoning);
  assert.equal(usd(callCost({ ...base, reasoningTokens: 800 })), withoutReasoning);
  assert.equal(withoutReasoning, (1_000 * 2.5 + 800 * 15) / 1e6);
});

test("a dated snapshot is priced as its model, and a different model is not", () => {
  assert.equal(priceModelKey("gpt-5.4-2026-03-05"), "gpt-5.4");
  assert.equal(priceModelKey("GPT-5.4"), "gpt-5.4");
  assert.equal(priceModelKey("gpt-5.4-mini"), "gpt-5.4-mini");
  assert.deepEqual(callCost({ model: "gpt-5.4-2026-03-05", inputTokens: 200_000, outputTokens: 0, createdAt: at }), { kind: "priced", usd: 0.5 });
  assert.deepEqual(callCost({ model: "gpt-unknown", inputTokens: 10, outputTokens: 10, createdAt: at }), { kind: "unknown", reason: "model" });
});

test("a call with no tokens has nothing to price, and a non-standard tier has no price", () => {
  assert.deepEqual(callCost({ model: "gpt-5.4", createdAt: at }), { kind: "no_usage" });
  assert.deepEqual(callCost({ model: "gpt-5.4", serviceTier: "flex", inputTokens: 10, outputTokens: 10, createdAt: at }), { kind: "unknown", reason: "service_tier" });
  assert.equal(callCost({ model: "gpt-5.4", serviceTier: "default", inputTokens: 10, outputTokens: 10, createdAt: at }).kind, "priced");
});

test("cached tokens never exceed input, and input over 272K is priced at the long context rate", () => {
  assert.equal(usd(callCost({ model: "gpt-5.4", inputTokens: 100, cachedInputTokens: 500, outputTokens: 0, createdAt: at })), (100 * 0.25) / 1e6);
  assert.equal(usd(callCost({ model: "gpt-5.4", inputTokens: 300_000, outputTokens: 1_000, createdAt: at })), (300_000 * 5 + 1_000 * 22.5) / 1e6);
});

test("each call uses the price in force on its day, so fixing a price corrects history", () => {
  const prices = { "gpt-x": [{ from: "2026-01-01", input: 1, cachedInput: 0.1, output: 2 }, { from: "2026-10-01", input: 4, cachedInput: 0.4, output: 8 }] };
  assert.equal(priceFor("gpt-x", Date.UTC(2026, 8, 30), prices).input, 1);
  assert.equal(priceFor("gpt-x", Date.UTC(2026, 9, 1), prices).input, 4);
  assert.equal(priceFor("gpt-x", Date.UTC(2025, 11, 31), prices), null);
  assert.ok(AI_PRICES["gpt-5.4"].every((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.from)));
});

test("usage is read from the AI SDK result: totals, cache, reasoning, model and service tier", () => {
  const usage = usageFromResult({
    usage: { inputTokens: 1, outputTokens: 1 },
    totalUsage: {
      inputTokens: 3_412, outputTokens: 318,
      inputTokenDetails: { noCacheTokens: 1_364, cacheReadTokens: 2_048, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: 118, reasoningTokens: 200 },
    },
    response: { id: "resp_1", modelId: "gpt-5.4-2026-03-05" },
    providerMetadata: { openai: { responseId: "resp_1", serviceTier: "default" } },
    output: { secret: "never logged" },
  }, "gpt-5.4");
  assert.deepEqual(usage, { model: "gpt-5.4-2026-03-05", serviceTier: "default", inputTokens: 3_412, cachedInputTokens: 2_048, outputTokens: 318, reasoningTokens: 200 });
});

test("a result without usage logs only the requested model", () => {
  assert.deepEqual(usageFromResult({ output: {} }, "gpt-5.4"), { model: "gpt-5.4" });
  assert.deepEqual(usageFromResult(undefined, "gpt-5.4"), { model: "gpt-5.4" });
});

test("a schema mismatch error keeps its usage; a request error has none", () => {
  const mismatch = Object.assign(new Error("No object generated"), { usage: { inputTokens: 900, outputTokens: 40, inputTokenDetails: { cacheReadTokens: 0 } }, response: { modelId: "gpt-5.4-2026-03-05" } });
  assert.deepEqual(usageFromError(mismatch, "gpt-5.4"), { model: "gpt-5.4-2026-03-05", inputTokens: 900, cachedInputTokens: 0, outputTokens: 40 });
  assert.deepEqual(usageFromError(new Error("429"), "gpt-5.4"), { model: "gpt-5.4" });
});

test("a usage month is a UTC calendar month", () => {
  assert.deepEqual(parseUsageMonth("2026-10"), { year: 2026, month: 10 });
  assert.equal(parseUsageMonth("2026-13"), null);
  assert.equal(parseUsageMonth("26-10"), null);
  assert.equal(parseUsageMonth(undefined), null);
  assert.deepEqual(usageMonthRange({ year: 2026, month: 12 }), { start: Date.UTC(2026, 11, 1), end: Date.UTC(2027, 0, 1) });
  assert.equal(usageMonthDays({ year: 2026, month: 2 }), 28);
  assert.deepEqual(recentUsageMonths(Date.UTC(2026, 1, 3), 3).map(usageMonthKey), ["2026-02", "2026-01", "2025-12"]);
});

test("amounts, tokens and results read the way the page shows them", () => {
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(0.004), "<$0.01");
  assert.equal(formatUsd(0.92), "$0.92");
  assert.equal(formatUsd(0.0052, true), "$0.005");
  assert.equal(formatTokensShort(435_120), "435k");
  assert.equal(formatTokensShort(6_104), "6.1k");
  assert.equal(formatTokensShort(318), "318");
  assert.deepEqual(usageResultLabel("shuffle", "saved"), { label: "Used", tone: "success" });
  assert.deepEqual(usageResultLabel("summary", "retried"), { label: "Failed checks, retried", tone: "warning" });
});

test("the CSV has one line per call, quotes separators and never starts a cell with a formula", () => {
  const lines = usageCsv([
    { createdAt: Date.UTC(2026, 9, 30, 10, 42), eventName: "Hack, London", project: "=SUM(A1)", feature: "summary", model: "gpt-5.4", serviceTier: "default", inputTokens: 10, cachedInputTokens: 0, outputTokens: 2, reasoningTokens: null, result: "saved", cost: { kind: "priced", usd: 0.000055 } },
    { createdAt: Date.UTC(2026, 9, 30, 11), eventName: "Hack", project: null, feature: "shuffle", model: "gpt-x", serviceTier: null, inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, result: "error", cost: { kind: "no_usage" } },
  ]).split("\r\n");
  assert.equal(lines[0].split(",").length, 13);
  assert.equal(lines[1], "2026-10-30T10:42:00.000Z,\"Hack, London\",'=SUM(A1),summary,gpt-5.4,default,10,0,2,,0.000055,,saved");
  assert.equal(lines[2], "2026-10-30T11:00:00.000Z,Hack,,shuffle,gpt-x,,,,,,,no usage reported,error");
});
