import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NoObjectGeneratedError } from "ai";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ORG, addProject, createEvent, setupTest, type TestClient } from "./behaviour.testing";

// The model is never called for real: generateText is replaced, the rest of the SDK stays.
const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (...args: unknown[]) => generateText(...args),
}));

const NOW = Date.UTC(2026, 9, 30, 10, 42);
const MONTH = "2026-10";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  generateText.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const usage = (input: number, cached: number, output: number, reasoning = 0) => ({
  inputTokens: input, outputTokens: output, totalTokens: input + output,
  inputTokenDetails: { noCacheTokens: input - cached, cacheReadTokens: cached, cacheWriteTokens: undefined },
  outputTokenDetails: { textTokens: output - reasoning, reasoningTokens: reasoning },
});
/** What generateText resolves with: the parsed output plus usage, the model OpenAI reported and its tier. */
const reply = (output: unknown, tokens = usage(3_412, 2_048, 318, 120)) => ({
  output, usage: tokens, totalUsage: tokens,
  response: { id: "resp_test", modelId: "gpt-5.4-2026-03-05", timestamp: new Date(NOW) },
  providerMetadata: { openai: { responseId: "resp_test", serviceTier: "default" } },
});
const neutral = { whatItDoes: "Checks agent tool calls against a policy.", howItWorks: "A TypeScript proxy.", demoFocus: "A blocked call." };
const praise = { whatItDoes: "The best policy checker for agents.", howItWorks: "A TypeScript proxy.", demoFocus: "A blocked call." };

const usageRows = (t: TestClient) => t.run((ctx) => ctx.db.query("aiUsage").collect());
const summarise = (t: TestClient, submissionId: Id<"submissions">) =>
  t.action(internal.aiSummaryAction.generateSubmissionSummary, { submissionId });

async function hackathonWithProject(t: TestClient) {
  const { eventId, slug } = await createEvent(t);
  const submissionId = await addProject(t, eventId, 1);
  return { eventId, slug, submissionId };
}

test("a saved summary logs one row with its tokens, the reported model and the service tier, and no text", async () => {
  const { t } = setupTest();
  const { eventId, submissionId } = await hackathonWithProject(t);
  generateText.mockResolvedValue(reply(neutral));
  expect(await summarise(t, submissionId)).toEqual({ saved: true });
  const rows = await usageRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    organizationId: ORG, eventId, submissionId, feature: "summary", result: "saved",
    model: "gpt-5.4-2026-03-05", serviceTier: "default",
    inputTokens: 3_412, cachedInputTokens: 2_048, outputTokens: 318, reasoningTokens: 120, createdAt: NOW,
  });
  // Token counts and labels only: nothing from the prompt or the output.
  const stored = JSON.stringify(rows[0]);
  expect(stored).not.toContain("policy");
  expect(stored).not.toContain("Description 1");
});

test("a summary the language check rejects logs the rejected call as retried, then the retry", async () => {
  const { t } = setupTest();
  const { submissionId } = await hackathonWithProject(t);
  generateText.mockResolvedValueOnce(reply(praise, usage(1_000, 0, 200))).mockResolvedValueOnce(reply(neutral, usage(1_100, 1_024, 210)));
  expect(await summarise(t, submissionId)).toEqual({ saved: true });
  const rows = await usageRows(t);
  expect(rows.map((row) => [row.result, row.inputTokens, row.outputTokens])).toEqual([["retried", 1_000, 200], ["saved", 1_100, 210]]);
});

test("a summary rejected twice logs both calls, the last as rejected", async () => {
  const { t } = setupTest();
  const { submissionId } = await hackathonWithProject(t);
  generateText.mockResolvedValue(reply(praise));
  expect(await summarise(t, submissionId)).toEqual({ saved: false });
  expect((await usageRows(t)).map((row) => row.result)).toEqual(["retried", "rejected"]);
});

test("a request that throws before usage is known logs an error row with no tokens", async () => {
  const { t } = setupTest();
  const { submissionId } = await hackathonWithProject(t);
  generateText.mockRejectedValue(new Error("429 Too Many Requests"));
  expect(await summarise(t, submissionId)).toEqual({ saved: false });
  const [row] = await usageRows(t);
  expect(row).toMatchObject({ feature: "summary", result: "error", model: "gpt-5.4", submissionId });
  expect(row.inputTokens).toBeUndefined();
  expect(row.outputTokens).toBeUndefined();
});

test("a reply that does not match the schema is logged as failed, with the tokens it used", async () => {
  const { t } = setupTest();
  const { submissionId } = await hackathonWithProject(t);
  generateText.mockRejectedValue(new NoObjectGeneratedError({
    message: "No object generated: response did not match schema.",
    text: "{}",
    response: { id: "resp_bad", modelId: "gpt-5.4-2026-03-05", timestamp: new Date(NOW) },
    usage: usage(900, 0, 40),
    finishReason: "stop",
  }));
  expect(await summarise(t, submissionId)).toEqual({ saved: false });
  expect(await usageRows(t)).toMatchObject([{ result: "failed", model: "gpt-5.4-2026-03-05", inputTokens: 900, outputTokens: 40 }]);
});

test("output thrown away because the project changed meanwhile is still logged", async () => {
  const { t } = setupTest();
  const { submissionId } = await hackathonWithProject(t);
  generateText.mockImplementation(async () => {
    await t.run((ctx) => ctx.db.patch(submissionId, { description: "A new description." }));
    return reply(neutral);
  });
  expect(await summarise(t, submissionId)).toEqual({ saved: false });
  expect((await usageRows(t)).map((row) => row.result)).toEqual(["discarded"]);
});

test("AI shuffle logs its call, and a failed shuffle logs an error before it throws", async () => {
  const { t } = setupTest();
  const { eventId, slug } = await createEvent(t, { eventType: "demo" });
  const first = await addProject(t, eventId, 1);
  const second = await addProject(t, eventId, 2);
  generateText.mockResolvedValueOnce(reply({ orderedIds: [second, first] }, usage(6_104, 0, 812)));
  expect(await t.action(api.ai.aiShuffle, { slug, prompt: "Hardware first" })).toEqual({ count: 2 });
  generateText.mockRejectedValueOnce(new Error("network"));
  await expect(t.action(api.ai.aiShuffle, { slug, prompt: "Again" })).rejects.toThrow("network");
  expect((await usageRows(t)).map((row) => ({ feature: row.feature, result: row.result, eventId: row.eventId, submissionId: row.submissionId, inputTokens: row.inputTokens }))).toEqual([
    { feature: "shuffle", result: "saved", eventId, submissionId: undefined, inputTokens: 6_104 },
    { feature: "shuffle", result: "error", eventId, submissionId: undefined, inputTokens: undefined },
  ]);
});

async function insertUsage(t: TestClient, rows: Array<Record<string, unknown>>) {
  await t.run(async (ctx) => {
    for (const row of rows) await ctx.db.insert("aiUsage", { organizationId: ORG, feature: "summary", model: "gpt-5.4-2026-03-05", result: "saved", createdAt: NOW, ...row } as never);
  });
}

test("the month summary works out cost from tokens and prices, by day, feature and event", async () => {
  const { t, root } = setupTest();
  const { eventId, submissionId } = await hackathonWithProject(t);
  const other = await addProject(t, eventId, 2);
  await t.run((ctx) => ctx.db.patch(eventId, { aiSummaryBudget: { day: Math.floor(NOW / 86_400_000), used: 3 } }));
  await insertUsage(t, [
    // $ (1,364 x 2.50 + 2,048 x 0.25 + 318 x 15) / 1M; reasoning is inside output.
    { eventId, submissionId, inputTokens: 3_412, cachedInputTokens: 2_048, outputTokens: 318, reasoningTokens: 200, createdAt: Date.UTC(2026, 9, 30, 9) },
    { eventId, submissionId: other, inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100, result: "retried", createdAt: Date.UTC(2026, 9, 18, 9) },
    { eventId, feature: "shuffle", inputTokens: 6_104, cachedInputTokens: 0, outputTokens: 812, createdAt: Date.UTC(2026, 9, 18, 21) },
    // No price for this model: counted, not priced.
    { eventId, submissionId, model: "gpt-unknown", inputTokens: 500, outputTokens: 50, createdAt: Date.UTC(2026, 9, 29, 9) },
    // Failed before usage: nothing to price.
    { eventId, submissionId, result: "error", model: "gpt-5.4", createdAt: Date.UTC(2026, 9, 29, 10) },
    // Another month and another organization never count.
    { eventId, submissionId, inputTokens: 9_999_999, outputTokens: 9_999_999, createdAt: Date.UTC(2026, 8, 30, 23, 59) },
    { eventId, submissionId, organizationId: "org_other", inputTokens: 9_999_999, outputTokens: 9_999_999 },
  ]);
  const first = (1_364 * 2.5 + 2_048 * 0.25 + 318 * 15) / 1e6;
  const second = (1_000 * 2.5 + 100 * 15) / 1e6;
  const shuffle = (6_104 * 2.5 + 812 * 15) / 1e6;

  const summary = await t.query(api.aiUsage.monthSummary, { month: MONTH });
  expect(summary.totals).toMatchObject({ calls: 5, summaries: 4, shuffles: 1, inputTokens: 11_016, cachedInputTokens: 2_048, outputTokens: 1_280, reasoningTokens: 200, unpricedCalls: 1, noUsageCalls: 1, pricedSummaries: 2 });
  expect(summary.totals.usd).toBeCloseTo(first + second + shuffle, 12);
  expect(summary.totals.summaryUsd).toBeCloseTo(first + second, 12);
  expect(summary.days).toHaveLength(31);
  expect(summary.days[17].summaryUsd).toBeCloseTo(second, 12);
  expect(summary.days[17].shuffleUsd).toBeCloseTo(shuffle, 12);
  expect(summary.days[29].summaryUsd).toBeCloseTo(first, 12);
  expect(summary.days[28]).toMatchObject({ calls: 2, summaryUsd: 0 });
  expect(summary.events).toHaveLength(1);
  expect(summary.events[0]).toMatchObject({ id: eventId, kind: "real", summaries: 4, shuffles: 1, projects: 2, unpricedCalls: 1, summaryRuns: { kind: "used", used: 3, cap: 20 } });
  expect(summary.events[0].usd).toBeCloseTo(first + second + shuffle, 12);
  expect(summary.events[0].perProjectUsd).toBeCloseTo((first + second) / 2, 12);
  expect(summary.prices).toEqual([
    { model: "gpt-5.4", calls: 4, price: { input: 2.5, cachedInput: 0.25, output: 15, from: "2026-03-05" } },
    { model: "gpt-unknown", calls: 1, price: null },
    // The v3 summary model is listed with its price before its first call.
    { model: "gpt-6.1-sol", calls: 0, price: { input: 2, cachedInput: 0.1, output: 10, from: "2026-10-01" } },
  ]);
  expect(summary.budget).toEqual({ perProject: 3, floor: 20 });

  // Another organization sees none of it, and signed-out callers are refused.
  const outsider = root.withIdentity({ subject: "user_other", org_id: "org_other", tokenIdentifier: "other" });
  expect((await outsider.query(api.aiUsage.monthSummary, { month: MONTH })).totals.calls).toBe(1);
  await expect(root.query(api.aiUsage.monthSummary, { month: MONTH })).rejects.toThrow("Sign in");
  await expect(t.query(api.aiUsage.monthSummary, { month: "October" })).rejects.toThrow("Choose a month");
});

test("practice sample summaries count without a model call, and the event says samples only", async () => {
  const { t } = setupTest();
  const { eventId } = await createEvent(t, { slug: "dry-run", extra: { practice: true } });
  // Each sample summary is logged when it is written; only this month's count.
  for (const [index, createdAt] of [Date.UTC(2026, 9, 20), Date.UTC(2026, 9, 21), Date.UTC(2026, 8, 21)].entries()) {
    const submissionId = await addProject(t, eventId, index + 1);
    await t.run((ctx) => ctx.db.insert("aiSampleSummaries", { organizationId: ORG, eventId, submissionId, createdAt }));
  }
  const summary = await t.query(api.aiUsage.monthSummary, { month: MONTH });
  expect(summary.practiceSamples).toBe(2);
  expect(summary.totals.calls).toBe(0);
  expect(summary.events).toMatchObject([{ id: eventId, kind: "practice_sample", samples: 2, summaries: 0, usd: 0, summaryRuns: { kind: "samples_only" } }]);
});

test("the month's calls come newest first, a page at a time, each with its cost", async () => {
  const { t } = setupTest();
  const { eventId, submissionId } = await hackathonWithProject(t);
  await insertUsage(t, [
    { eventId, submissionId, inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100, createdAt: Date.UTC(2026, 9, 1) },
    { eventId, feature: "shuffle", inputTokens: 2_000, cachedInputTokens: 0, outputTokens: 0, createdAt: Date.UTC(2026, 9, 2) },
    { eventId, submissionId, model: "gpt-unknown", inputTokens: 1, outputTokens: 1, createdAt: Date.UTC(2026, 9, 3) },
  ]);
  const first = await t.query(api.aiUsage.monthCalls, { month: MONTH, paginationOpts: { numItems: 2, cursor: null } });
  expect(first.page.map((row) => [row.feature, row.project, row.eventName, row.cost])).toEqual([
    ["summary", "Project 1", "DevDay Exchange", { kind: "unknown", reason: "model" }],
    ["shuffle", null, "DevDay Exchange", { kind: "priced", usd: (2_000 * 2.5) / 1e6 }],
  ]);
  expect(first.isDone).toBe(false);
  const rest = await t.query(api.aiUsage.monthCalls, { month: MONTH, paginationOpts: { numItems: 2, cursor: first.continueCursor } });
  expect(rest.page.map((row) => row.cost)).toEqual([{ kind: "priced", usd: (1_000 * 2.5 + 100 * 15) / 1e6 }]);
  expect(rest.isDone).toBe(true);
});
