import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalMutation, query, type ActionCtx } from "./_generated/server";
import { aiUsageFeatureValidator, aiUsageResultValidator } from "./schema";
import { requireOrganization } from "./organizationAuth";
import { SUMMARY_DAILY_FLOOR, SUMMARY_DAILY_RUNS_PER_SUBMISSION, summaryDailyCap, summaryMode } from "./aiSummaries";
import { callCost, priceFor, priceModelKey } from "../lib/ai-prices";
import {
  parseUsageMonth,
  usageMonthDays,
  usageMonthKey,
  usageMonthRange,
  type AiUsageFeature,
  type AiUsageResult,
  type LoggedUsage,
} from "../lib/ai-usage";

const DAY_MS = 24 * 60 * 60_000;
/** A month's summary reads at most this many calls; beyond it the page says the totals are partial. */
export const MAX_MONTH_CALLS = 8_000;
/** Practice events whose sample summaries are counted, newest first. */
const MAX_EVENT_SUBMISSIONS = 1000;

/** Writes one usage row. The organization always comes from the event, never from the caller. */
export const record = internalMutation({
  args: {
    eventId: v.id("events"),
    submissionId: v.optional(v.id("submissions")),
    feature: aiUsageFeatureValidator,
    result: aiUsageResultValidator,
    model: v.string(),
    serviceTier: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"aiUsage"> | null> => {
    const event = await ctx.db.get(args.eventId);
    if (!event?.workosOrganizationId) return null;
    return await ctx.db.insert("aiUsage", { ...args, organizationId: event.workosOrganizationId, createdAt: Date.now() });
  },
});

export type AiUsageEntry = LoggedUsage & {
  eventId: Id<"events">;
  submissionId?: Id<"submissions">;
  feature: AiUsageFeature;
  result: AiUsageResult;
};

/**
 * Logs one OpenAI call from an action. A logging failure never breaks the
 * feature: it is written to the log with its error name only.
 */
export async function logAiUsage(ctx: Pick<ActionCtx, "runMutation">, entry: AiUsageEntry): Promise<void> {
  try {
    await ctx.runMutation(internal.aiUsage.record, entry);
  } catch (error) {
    console.log(JSON.stringify({ event: "ai-usage", status: "not_logged", reason: error instanceof Error ? error.name : "unknown" }));
  }
}

function monthArg(value: string) {
  const month = parseUsageMonth(value);
  if (!month) throw new ConvexError("Choose a month such as 2026-10.");
  return month;
}

const tokensOf = (row: Doc<"aiUsage">) => (row.inputTokens ?? 0) + (row.outputTokens ?? 0);

type EventKind = "real" | "practice_model" | "practice_sample";
const eventKind = (event: Doc<"events">): EventKind =>
  event.practice !== true ? "real" : summaryMode(event) === "sample" ? "practice_sample" : "practice_model";

/**
 * A month of the organization's AI usage, for the AI usage page: totals, spend
 * per UTC day split by feature, a rollup per event and the prices used.
 * Dollars are an estimate from logged tokens and the price table.
 */
export const monthSummary = query({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    const { organizationId } = await requireOrganization(ctx);
    const month = monthArg(args.month);
    const { start, end } = usageMonthRange(month);
    const read = await ctx.db
      .query("aiUsage")
      .withIndex("by_organization_and_createdAt", (q) => q.eq("organizationId", organizationId).gte("createdAt", start).lt("createdAt", end))
      .take(MAX_MONTH_CALLS + 1);
    const truncated = read.length > MAX_MONTH_CALLS;
    const rows = truncated ? read.slice(0, MAX_MONTH_CALLS) : read;

    const totals = {
      calls: rows.length, summaries: 0, shuffles: 0,
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0,
      usd: 0, summaryUsd: 0, pricedSummaries: 0, unpricedCalls: 0, noUsageCalls: 0,
    };
    const days = Array.from({ length: usageMonthDays(month) }, (_, index) => ({ day: index + 1, summaryUsd: 0, shuffleUsd: 0, calls: 0 }));
    type EventRollup = { summaries: number; shuffles: number; tokens: number; usd: number; summaryUsd: number; unpricedCalls: number; projects: Set<string>; samples: number; lastAt: number };
    const byEvent = new Map<Id<"events">, EventRollup>();
    const rollup = (eventId: Id<"events">) => {
      let entry = byEvent.get(eventId);
      if (!entry) byEvent.set(eventId, (entry = { summaries: 0, shuffles: 0, tokens: 0, usd: 0, summaryUsd: 0, unpricedCalls: 0, projects: new Set(), samples: 0, lastAt: 0 }));
      return entry;
    };
    const models = new Map<string, number>();

    for (const row of rows) {
      const cost = callCost(row);
      const usd = cost.kind === "priced" ? cost.usd : 0;
      const summary = row.feature === "summary";
      if (summary) totals.summaries += 1; else totals.shuffles += 1;
      totals.inputTokens += row.inputTokens ?? 0;
      totals.cachedInputTokens += row.cachedInputTokens ?? 0;
      totals.outputTokens += row.outputTokens ?? 0;
      totals.reasoningTokens += row.reasoningTokens ?? 0;
      totals.usd += usd;
      if (cost.kind === "unknown") totals.unpricedCalls += 1;
      if (cost.kind === "no_usage") totals.noUsageCalls += 1;
      if (summary && cost.kind === "priced") { totals.summaryUsd += usd; totals.pricedSummaries += 1; }
      const day = days[new Date(row.createdAt).getUTCDate() - 1];
      if (day) { day.calls += 1; if (summary) day.summaryUsd += usd; else day.shuffleUsd += usd; }
      const entry = rollup(row.eventId);
      if (summary) { entry.summaries += 1; entry.summaryUsd += usd; if (row.submissionId) entry.projects.add(row.submissionId); } else entry.shuffles += 1;
      entry.tokens += tokensOf(row);
      entry.usd += usd;
      if (cost.kind === "unknown") entry.unpricedCalls += 1;
      entry.lastAt = Math.max(entry.lastAt, row.createdAt);
      const key = priceModelKey(row.model);
      models.set(key, (models.get(key) ?? 0) + 1);
    }

    // Practice summaries written from samples made no model call. Each one is
    // logged when written (aiSampleSummaries), so this reads one month of that
    // log instead of every practice event's submissions. A tidied practice
    // event takes its rows with it.
    const sampleRows = await ctx.db
      .query("aiSampleSummaries")
      .withIndex("by_organization_and_createdAt", (q) => q.eq("organizationId", organizationId).gte("createdAt", start).lt("createdAt", end))
      .take(MAX_MONTH_CALLS);
    for (const row of sampleRows) {
      const entry = rollup(row.eventId);
      entry.samples += 1;
      entry.lastAt = Math.max(entry.lastAt, row.createdAt);
    }
    const practiceSamples = sampleRows.length;

    const now = Date.now();
    const today = Math.floor(now / DAY_MS);
    const events = [];
    for (const [eventId, entry] of byEvent) {
      const event = await ctx.db.get(eventId);
      // An event moved to another organization keeps its old rows here, without its details.
      const own = event && event.workosOrganizationId === organizationId ? event : null;
      const kind = own ? eventKind(own) : "real";
      let summaryRuns: { kind: "samples_only" } | { kind: "none_today" } | { kind: "used"; used: number; cap: number };
      if (kind === "practice_sample") summaryRuns = { kind: "samples_only" };
      else if (!own || own.aiSummaryBudget?.day !== today || own.aiSummaryBudget.used === 0) summaryRuns = { kind: "none_today" };
      else {
        const count = (await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(MAX_EVENT_SUBMISSIONS)).length;
        summaryRuns = { kind: "used", used: own.aiSummaryBudget.used, cap: summaryDailyCap(count) };
      }
      events.push({
        id: eventId,
        name: own?.name ?? "Removed event",
        slug: own?.slug ?? null,
        kind,
        summaries: entry.summaries,
        shuffles: entry.shuffles,
        tokens: entry.tokens,
        usd: entry.usd,
        unpricedCalls: entry.unpricedCalls,
        projects: entry.projects.size,
        // Summary spend per project summarised this month.
        perProjectUsd: entry.projects.size > 0 ? entry.summaryUsd / entry.projects.size : null,
        samples: entry.samples,
        summaryRuns,
        lastAt: entry.lastAt,
      });
    }
    events.sort((a, b) => b.lastAt - a.lastAt);

    const configuredModel = env.OPENAI_MODEL?.trim() || "gpt-5.4";
    if (!models.has(priceModelKey(configuredModel))) models.set(priceModelKey(configuredModel), 0);
    const prices = [...models.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([model, calls]) => {
        const price = priceFor(model, now);
        return { model, calls, price: price && { input: price.input, cachedInput: price.cachedInput, output: price.output, from: price.from } };
      });

    return {
      organizationId,
      month: usageMonthKey(month),
      truncated,
      totals,
      days,
      events,
      prices,
      practiceSamples,
      budget: { perProject: SUMMARY_DAILY_RUNS_PER_SUBMISSION, floor: SUMMARY_DAILY_FLOOR },
    };
  },
});

/** One page of the month's calls, newest first, each with its estimated cost. */
export const monthCalls = query({
  args: { month: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { organizationId } = await requireOrganization(ctx);
    const { start, end } = usageMonthRange(monthArg(args.month));
    const result = await ctx.db
      .query("aiUsage")
      .withIndex("by_organization_and_createdAt", (q) => q.eq("organizationId", organizationId).gte("createdAt", start).lt("createdAt", end))
      .order("desc")
      .paginate(args.paginationOpts);
    const eventNames = new Map<Id<"events">, string>();
    const page = [];
    for (const row of result.page) {
      if (!eventNames.has(row.eventId)) {
        const event = await ctx.db.get(row.eventId);
        eventNames.set(row.eventId, event && event.workosOrganizationId === organizationId ? event.name : "Removed event");
      }
      const submission = row.submissionId ? await ctx.db.get(row.submissionId) : null;
      page.push({
        id: row._id,
        createdAt: row.createdAt,
        eventName: eventNames.get(row.eventId)!,
        project: submission && submission.eventId === row.eventId ? submission.demoTitle : null,
        feature: row.feature,
        model: row.model,
        serviceTier: row.serviceTier ?? null,
        inputTokens: row.inputTokens ?? null,
        cachedInputTokens: row.cachedInputTokens ?? null,
        outputTokens: row.outputTokens ?? null,
        reasoningTokens: row.reasoningTokens ?? null,
        result: row.result,
        cost: callCost(row),
      });
    }
    return { ...result, page };
  },
});
