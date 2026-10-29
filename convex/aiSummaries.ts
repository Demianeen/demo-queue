import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { listEventTracks, trackNamesFor, tracksById } from "./tracks";
import { cleanSummaryLine, findEvaluativeLanguage, summaryOutputSchema, summarySourceKey } from "../lib/ai-summary";

/** Gap between summaries when a whole event is queued, so the model is not hit all at once. */
export const SUMMARY_STAGGER_MS = 1_000;

/** Summaries use the deployment's existing OpenAI key. Without it, nothing is queued. */
export function aiSummariesConfigured() {
  return Boolean(env.OPENAI_API_KEY?.trim());
}

/** Summaries are written for hackathon submissions that are in judging. */
function needsSummary(event: Doc<"events">, submission: Doc<"submissions">) {
  return (
    event.eventType === "hackathon" &&
    event.submissionsClosedAt !== undefined &&
    (submission.status === "candidate" || submission.status === "queued") &&
    submission.aiSummary?.sourceKey !== summarySourceKey(submission)
  );
}

/**
 * Queues a summary for one submission when it has none, or when its
 * description or repository changed since the last one. Call it after any
 * change to those fields.
 */
export async function queueAiSummaryIfStale(
  ctx: MutationCtx,
  event: Doc<"events">,
  submission: Doc<"submissions">,
  delayMs = 0,
) {
  if (!aiSummariesConfigured() || !needsSummary(event, submission)) return false;
  await ctx.scheduler.runAfter(delayMs, internal.aiSummaryAction.generateSubmissionSummary, {
    submissionId: submission._id,
  });
  return true;
}

/** Queues summaries for every submission in judging that needs one. Runs when submissions close. */
export const queueEventSummaries = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return { queued: 0 };
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .take(1000);
    let queued = 0;
    for (const submission of submissions) {
      if (await queueAiSummaryIfStale(ctx, event, submission, queued * SUMMARY_STAGGER_MS)) queued += 1;
    }
    return { queued };
  },
});

/** What the model is given: project fields only, never names or contact details. */
export const summaryInput = internalQuery({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) return null;
    const event = await ctx.db.get(submission.eventId);
    if (!event || !needsSummary(event, submission)) return null;
    const byId = tracksById(await listEventTracks(ctx, event._id));
    return {
      demoTitle: submission.demoTitle,
      description: submission.description,
      githubUrl: submission.githubUrl ?? null,
      tracks: trackNamesFor(submission, byId),
      sourceKey: summarySourceKey(submission),
    };
  },
});

/**
 * Saves a summary only if the submission still has the description and
 * repository it was written from (a newer queued summary covers any change),
 * the output is exactly three lines within the length cap, and none of them
 * judges the project. Rejected output leaves the submission as it was.
 */
export const saveSummary = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    sourceKey: v.string(),
    whatItDoes: v.string(),
    howItWorks: v.string(),
    demoFocus: v.string(),
    model: v.string(),
    usedReadme: v.boolean(),
    readmeHash: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ saved: boolean; reason: string }> => {
    const submission = await ctx.db.get(args.submissionId as Id<"submissions">);
    if (!submission || summarySourceKey(submission) !== args.sourceKey) return { saved: false, reason: "source_changed" };
    const output = summaryOutputSchema.safeParse({
      whatItDoes: cleanSummaryLine(args.whatItDoes),
      howItWorks: cleanSummaryLine(args.howItWorks),
      demoFocus: cleanSummaryLine(args.demoFocus),
    });
    if (!output.success) return { saved: false, reason: "invalid_output" };
    // Only tracks the organizer defined may be named; never the team's free-text category.
    const byId = tracksById(await listEventTracks(ctx, submission.eventId));
    const adminTracks = (submission.trackIds ?? []).flatMap((id) => byId.get(id)?.name ?? []);
    const evaluative = findEvaluativeLanguage(output.data, adminTracks);
    if (evaluative) return { saved: false, reason: `evaluative_language:${evaluative}` };
    await ctx.db.patch(submission._id, {
      aiSummary: {
        ...output.data,
        sourceKey: args.sourceKey,
        model: args.model,
        usedReadme: args.usedReadme,
        readmeHash: args.readmeHash,
        generatedAt: Date.now(),
      },
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
  return aiSummariesConfigured() && needsSummary(event, submission) ? "writing" : "none";
}

/** The summary as shown to judges and admins, or null. */
export function publicAiSummary(submission: Doc<"submissions">) {
  const summary = submission.aiSummary;
  if (!summary) return null;
  return {
    whatItDoes: summary.whatItDoes,
    howItWorks: summary.howItWorks,
    demoFocus: summary.demoFocus,
    usedReadme: summary.usedReadme,
    generatedAt: summary.generatedAt,
    // True when the description or repository changed and a new summary is on its way.
    stale: summary.sourceKey !== summarySourceKey(submission),
  };
}
