import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { listEventTracks, trackNamesFor, tracksById } from "./tracks";
import {
  DEFAULT_SUMMARY_SECTIONS,
  buildSampleSummary,
  cleanSummaryLine,
  findEvaluativeLanguage,
  normalizeSummarySections,
  normalizeSummaryText,
  SUMMARY_PROMPT_VERSION,
  stripSectionPrefix,
  summaryOutputSchemaFor,
  summarySourceKey,
  type PracticeAiSummaries,
  type SummarySection,
} from "../lib/ai-summary";

/** Gap between summaries when a whole event is queued, so the model is not hit all at once. */
export const SUMMARY_STAGGER_MS = 1_000;

/** Summaries use the deployment's existing OpenAI key. Without it, nothing is queued. */
export function aiSummariesConfigured() {
  return Boolean(env.OPENAI_API_KEY?.trim());
}

/** The event's summary sections, or today's three. */
export function summarySections(event: Pick<Doc<"events">, "aiSummarySections">): SummarySection[] {
  try {
    return normalizeSummarySections(event.aiSummarySections);
  } catch {
    return DEFAULT_SUMMARY_SECTIONS;
  }
}

/**
 * How this event writes summaries. A practice event uses sample summaries
 * unless its organiser chose the real model; a real event always uses it.
 */
export function summaryMode(event: Pick<Doc<"events">, "practice" | "practiceAiSummaries">): PracticeAiSummaries {
  return event.practice === true ? event.practiceAiSummaries ?? "sample" : "model";
}

function inJudging(event: Doc<"events">, submission: Doc<"submissions">) {
  return event.eventType === "hackathon" && (submission.status === "candidate" || submission.status === "queued");
}

/**
 * Summaries are written for hackathon submissions as soon as they are
 * submitted (participants cannot edit afterwards), and again when the
 * description or repository changes. With refreshReadme, one is also checked
 * when only the README may have changed: the action compares its hash first.
 */
function needsSummary(event: Doc<"events">, submission: Doc<"submissions">, refreshReadme = false) {
  if (!inJudging(event, submission)) return false;
  const summary = submission.aiSummary;
  if (!summary || summary.sourceKey !== summarySourceKey(submission)) return true;
  // A practice event that switched between sample and model summaries replaces the other kind.
  const sample = summaryMode(event) === "sample";
  if ((summary.sample === true) !== sample) return true;
  if (sample) return false;
  // An explicit refresh also rewrites a summary from an older prompt.
  return refreshReadme && (Boolean(submission.githubUrl) || summary.promptVersion !== SUMMARY_PROMPT_VERSION);
}

/** Writes a practice sample summary at once: no OpenAI or GitHub call, no budget. */
async function writeSampleSummary(ctx: MutationCtx, event: Doc<"events">, submission: Doc<"submissions">) {
  const sections = buildSampleSummary(submission, summarySections(event));
  const text = (key: string) => sections.find((section) => section.key === key)?.text;
  await ctx.db.patch(submission._id, {
    aiSummary: {
      ...(text("whatItDoes") !== undefined ? { whatItDoes: text("whatItDoes") } : {}),
      ...(text("howItWorks") !== undefined ? { howItWorks: text("howItWorks") } : {}),
      ...(text("demoFocus") !== undefined ? { demoFocus: text("demoFocus") } : {}),
      sections,
      sourceKey: summarySourceKey(submission),
      model: "sample",
      usedReadme: false,
      promptVersion: SUMMARY_PROMPT_VERSION,
      sample: true,
      generatedAt: Date.now(),
    },
    aiSummaryGaveUp: undefined,
  });
}

/** Proposed: at most one summary run per submission in this window; later changes wait for it. */
export const SUMMARY_DEBOUNCE_MS = 10 * 60_000;
/** Proposed: each event may queue this many runs per submission per day (UTC), and at least the floor. */
export const SUMMARY_DAILY_RUNS_PER_SUBMISSION = 3;
export const SUMMARY_DAILY_FLOOR = 20;
const DAY_MS = 24 * 60 * 60_000;

export type SummaryQueueSource = "participant" | "organiser" | "close";

async function eventSubmissionCount(ctx: MutationCtx, eventId: Id<"events">) {
  return (await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(1000)).length;
}

/** Takes one run from the event's daily budget, or returns false when today's is spent. */
async function takeSummaryBudget(ctx: MutationCtx, eventId: Id<"events">, now: number, submissionCount: number) {
  const event = await ctx.db.get(eventId);
  if (!event) return false;
  const day = Math.floor(now / DAY_MS);
  const used = event.aiSummaryBudget?.day === day ? event.aiSummaryBudget.used : 0;
  const cap = Math.max(SUMMARY_DAILY_FLOOR, SUMMARY_DAILY_RUNS_PER_SUBMISSION * submissionCount);
  if (used >= cap) {
    console.log(JSON.stringify({ event: "ai-summary", status: "skipped", reason: "daily_budget", eventId }));
    return false;
  }
  await ctx.db.patch(eventId, { aiSummaryBudget: { day, used: used + 1 } });
  return true;
}

/**
 * Queues a summary for one submission when it has none, or when its
 * description or repository changed since the last one. Call it after any
 * change to those fields, and after a submit.
 *
 * Runs are throttled: a submission gets at most one run per
 * SUMMARY_DEBOUNCE_MS (a change inside the window is covered by a run at the
 * end of it, which reads the latest fields), and each event has a daily
 * budget. Participants queue nothing once submissions are closed; the close
 * pass itself is not throttled per submission, as it already staggers runs.
 */
export async function queueAiSummaryIfStale(
  ctx: MutationCtx,
  event: Doc<"events">,
  submission: Doc<"submissions">,
  delayMs = 0,
  options: { refreshReadme?: boolean; source?: SummaryQueueSource; submissionCount?: number } = {},
) {
  if (!needsSummary(event, submission, options.refreshReadme)) return false;
  // A practice event on sample summaries never calls the model.
  if (summaryMode(event) === "sample") {
    await writeSampleSummary(ctx, event, submission);
    return true;
  }
  if (!aiSummariesConfigured()) return false;
  const source = options.source ?? "organiser";
  if (source === "participant" && event.submissionsClosedAt !== undefined) return false;
  const now = Date.now();
  let runAt = now + delayMs;
  if (source !== "close") {
    const last = submission.summaryQueuedFor;
    // A run is already waiting; it reads the submission when it starts.
    if (last !== undefined && last > now) return true;
    if (last !== undefined && now - last < SUMMARY_DEBOUNCE_MS) runAt = Math.max(runAt, last + SUMMARY_DEBOUNCE_MS);
  }
  const count = options.submissionCount ?? (await eventSubmissionCount(ctx, event._id));
  if (!(await takeSummaryBudget(ctx, event._id, now, count))) return false;
  await ctx.scheduler.runAfter(runAt - now, internal.aiSummaryAction.generateSubmissionSummary, {
    submissionId: submission._id,
    ...(options.refreshReadme ? { refreshReadme: true } : {}),
  });
  await ctx.db.patch(submission._id, { summaryQueuedFor: runAt });
  return true;
}

/**
 * Queues summaries for every submission in judging that needs one. Runs when
 * submissions close; with refreshReadme it also rechecks each repository's
 * README and rewrites the summary when the README changed.
 */
export async function queueSummariesForEvent(ctx: MutationCtx, event: Doc<"events">, refreshReadme?: boolean) {
  const submissions = await ctx.db
    .query("submissions")
    .withIndex("by_event", (q) => q.eq("eventId", event._id))
    .take(1000);
  let queued = 0;
  for (const submission of submissions) {
    if (await queueAiSummaryIfStale(ctx, event, submission, queued * SUMMARY_STAGGER_MS, { refreshReadme, source: "close", submissionCount: submissions.length })) queued += 1;
  }
  return { queued };
}

export const queueEventSummaries = internalMutation({
  args: { eventId: v.id("events"), refreshReadme: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return { queued: 0 };
    return queueSummariesForEvent(ctx, event, args.refreshReadme);
  },
});

/** What the model is given: project fields only, never names or contact details. */
export const summaryInput = internalQuery({
  args: { submissionId: v.id("submissions"), refreshReadme: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) return null;
    const event = await ctx.db.get(submission.eventId);
    // Sample summaries are written without the model, so a run queued before a switch does nothing.
    if (!event || summaryMode(event) === "sample" || !needsSummary(event, submission, args.refreshReadme)) return null;
    const byId = tracksById(await listEventTracks(ctx, event._id));
    const sourceKey = summarySourceKey(submission);
    return {
      demoTitle: submission.demoTitle,
      description: submission.description,
      githubUrl: submission.githubUrl ?? null,
      tracks: trackNamesFor(submission, byId),
      sourceKey,
      sections: summarySections(event),
      // Only the README can have changed: skip the model when its hash is the same.
      readmeCheckOnly: submission.aiSummary?.sourceKey === sourceKey && submission.aiSummary?.promptVersion === SUMMARY_PROMPT_VERSION && submission.aiSummary?.sample !== true,
      readmeHash: submission.aiSummary?.readmeHash ?? null,
    };
  },
});

/**
 * Saves a summary only if the submission still has the description and
 * repository it was written from (a newer queued summary covers any change),
 * the output is exactly one line per section within the length cap, and none
 * of them judges the project. Rejected output leaves the submission as it was.
 */
export const saveSummary = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    sourceKey: v.string(),
    // The three default sections, as older callers send them.
    whatItDoes: v.optional(v.string()),
    howItWorks: v.optional(v.string()),
    demoFocus: v.optional(v.string()),
    // Or one line per section key.
    lines: v.optional(v.array(v.object({ key: v.string(), text: v.string() }))),
    model: v.string(),
    usedReadme: v.boolean(),
    readmeHash: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ saved: boolean; reason: string }> => {
    const submission = await ctx.db.get(args.submissionId as Id<"submissions">);
    if (!submission || summarySourceKey(submission) !== args.sourceKey) return { saved: false, reason: "source_changed" };
    const event = await ctx.db.get(submission.eventId);
    if (!event) return { saved: false, reason: "source_changed" };
    if (summaryMode(event) === "sample") return { saved: false, reason: "sample_mode" };
    const sections = summarySections(event);
    const given: Record<string, string> = {};
    for (const line of args.lines ?? []) given[line.key] = line.text;
    for (const key of ["whatItDoes", "howItWorks", "demoFocus"] as const) {
      if (args[key] !== undefined && given[key] === undefined) given[key] = args[key]!;
    }
    // The model sometimes repeats the field name first ("whatItDoes: ..."): drop it.
    const sectionFor = (key: string) => sections.find((section) => section.key === key) ?? { key, label: key };
    const cleaned = Object.fromEntries(Object.entries(given).map(([key, text]) => [key, cleanSummaryLine(stripSectionPrefix(normalizeSummaryText(text), sectionFor(key)))]));
    const output = summaryOutputSchemaFor(sections).safeParse(cleaned);
    if (!output.success) return { saved: false, reason: "invalid_output" };
    const lines = output.data as Record<string, string>;
    // A section may be empty ("Not described"), but not all of them.
    if (sections.every((section) => !lines[section.key])) return { saved: false, reason: "invalid_output" };
    // Only tracks the organizer defined may be named; never the team's free-text category.
    const byId = tracksById(await listEventTracks(ctx, submission.eventId));
    const adminTracks = (submission.trackIds ?? []).flatMap((id) => byId.get(id)?.name ?? []);
    const evaluative = findEvaluativeLanguage(sections.map((section) => lines[section.key]), adminTracks);
    if (evaluative) return { saved: false, reason: `evaluative_language:${evaluative}` };
    await ctx.db.patch(submission._id, {
      aiSummary: {
        ...(lines.whatItDoes !== undefined ? { whatItDoes: lines.whatItDoes } : {}),
        ...(lines.howItWorks !== undefined ? { howItWorks: lines.howItWorks } : {}),
        ...(lines.demoFocus !== undefined ? { demoFocus: lines.demoFocus } : {}),
        sections: sections.map((section) => ({ key: section.key, label: section.label, text: lines[section.key] })),
        sourceKey: args.sourceKey,
        model: args.model,
        usedReadme: args.usedReadme,
        readmeHash: args.readmeHash,
        promptVersion: SUMMARY_PROMPT_VERSION,
        generatedAt: Date.now(),
      },
      aiSummaryGaveUp: undefined,
    });
    return { saved: true, reason: "ok" };
  },
});

/**
 * What a judge sees in the summary slot: the summary, one being written
 * (queued and not saved yet), or none coming (no model key, or not in judging).
 */
export function aiSummaryStatus(event: Doc<"events">, submission: Doc<"submissions">): "ready" | "writing" | "none" {
  if (submission.aiSummary) return "ready";
  // The last run for these fields gave up: nothing more is coming until they change.
  if (submission.aiSummaryGaveUp?.sourceKey === summarySourceKey(submission)) return "none";
  // Sample summaries are written at once; there is never one on its way.
  if (summaryMode(event) === "sample") return "none";
  return aiSummariesConfigured() && needsSummary(event, submission) ? "writing" : "none";
}

/**
 * Records that a run ended without a summary, so the judge page stops saying
 * one is being written. Ignored when the fields changed meanwhile, since a
 * newer run covers them.
 */
export const markSummaryGaveUp = internalMutation({
  args: { submissionId: v.id("submissions"), sourceKey: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || summarySourceKey(submission) !== args.sourceKey) return false;
    await ctx.db.patch(submission._id, { aiSummaryGaveUp: { sourceKey: args.sourceKey, reason: args.reason, at: Date.now() } });
    return true;
  },
});

/** The sections of a stored summary; older summaries hold only the three default lines. */
function storedSections(summary: NonNullable<Doc<"submissions">["aiSummary"]>) {
  // Summaries saved before the prefix fix may still start with "whatItDoes: ".
  if (summary.sections && summary.sections.length > 0) return summary.sections.map((section) => ({ ...section, text: stripSectionPrefix(section.text, section) }));
  return DEFAULT_SUMMARY_SECTIONS.flatMap((section) => {
    const text = summary[section.key as "whatItDoes" | "howItWorks" | "demoFocus"];
    return text ? [{ key: section.key, label: section.label, text: stripSectionPrefix(text, section) }] : [];
  });
}

/** The summary as shown to judges and admins, or null. */
export function publicAiSummary(submission: Doc<"submissions">) {
  const summary = submission.aiSummary;
  if (!summary) return null;
  const sections = storedSections(summary);
  const text = (key: string) => sections.find((section) => section.key === key)?.text ?? "";
  return {
    whatItDoes: text("whatItDoes"),
    howItWorks: text("howItWorks"),
    demoFocus: text("demoFocus"),
    // Every section in order, with its label: what the judge page shows.
    sections,
    usedReadme: summary.usedReadme,
    // A practice sample summary: judges see "Sample summary (practice)" instead of "Written by AI".
    sample: summary.sample === true,
    generatedAt: summary.generatedAt,
    // True when the description or repository changed and a new summary is on its way.
    stale: summary.sourceKey !== summarySourceKey(submission),
  };
}
