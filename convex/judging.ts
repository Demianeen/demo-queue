import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { assignRoundOneJudgePair, buildJudgeAssignmentCounts, isValidRoundOneAssignment, sameJudge } from "../lib/judging-assignment";
import { isCompleteReview, isJudgingScore } from "../lib/judging-rubric";
import { TableHistory } from "@convex-dev/table-history";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import {
  adjusted,
  adjustmentDelta,
  average,
  mean,
  type ScoreRow,
} from "../lib/normalization";

const BATCH_SIZE = 50;
const DEFAULT_TIMER_MS = 60 * 60 * 1000;
const MAX_TIMER_MS = 99 * 60 * 60 * 1000;
const decisionHistory = new TableHistory<DataModel, "judgingDecisions">(components.judgingDecisionHistory);

export function normalizeJudgeKey(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function isJudgingSubmission(submission: Doc<"submissions">) {
  return submission.status === "candidate" || submission.status === "queued";
}

async function adminEvent(ctx: QueryCtx | MutationCtx, slug: string, adminToken: string) {
  const event = await ctx.db.query("events").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
  if (!event || event.adminToken !== adminToken) throw new ConvexError("Unauthorized");
  if (event.eventType !== "hackathon") throw new ConvexError("Judging is only available for hackathons.");
  return event;
}

async function judgeAccess(ctx: QueryCtx | MutationCtx, eventId: Doc<"events">["_id"], token: string) {
  const access = await ctx.db.query("judgeAccess").withIndex("by_token", (q) => q.eq("token", token)).unique();
  if (!access || access.eventId !== eventId || !access.active) throw new ConvexError("Unauthorized");
  return access;
}

export const createJudgeAccess = mutation({
  args: { slug: v.string(), adminToken: v.string(), judgeName: v.string(), capabilityToken: v.string() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    const judgeName = args.judgeName.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!judgeName || !args.capabilityToken) throw new ConvexError("Judge name and capability token are required.");
    const judgeKey = normalizeJudgeKey(judgeName);
    if (!(event.roundOneJudges ?? []).some((judge) => sameJudge(judge, judgeName))) {
      throw new ConvexError("Add this judge to the event before creating their link.");
    }
    const existing = await ctx.db.query("judgeAccess").withIndex("by_event_and_judge_key", (q) => q.eq("eventId", event._id).eq("judgeKey", judgeKey)).unique();
    const tokenOwner = await ctx.db.query("judgeAccess").withIndex("by_token", (q) => q.eq("token", args.capabilityToken)).unique();
    if (tokenOwner && tokenOwner._id !== existing?._id) {
      throw new ConvexError("This private link token is already in use.");
    }
    const now = Date.now();
    const fields = { judgeName, token: args.capabilityToken, active: true, updatedAt: now, deactivatedAt: undefined };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("judgeAccess", { eventId: event._id, judgeKey, ...fields, createdAt: now });
    return { judgeKey };
  },
});

export const listJudgeAccess = query({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    return await ctx.db.query("judgeAccess").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(100);
  },
});

export const deactivateJudgeAccess = mutation({
  args: { slug: v.string(), adminToken: v.string(), judgeKey: v.string(), active: v.boolean() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    const access = await ctx.db.query("judgeAccess").withIndex("by_event_and_judge_key", (q) => q.eq("eventId", event._id).eq("judgeKey", args.judgeKey)).unique();
    if (!access) throw new ConvexError("Judge not found.");
    const now = Date.now();
    await ctx.db.patch(access._id, { active: args.active, deactivatedAt: args.active ? undefined : now, updatedAt: now });
  },
});

export const closeSubmissions = mutation({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    if (event.submissionsClosedAt !== undefined) {
      return { judgingStatus: event.judgingStatus ?? "setup" };
    }
    const now = Date.now();
    await ctx.db.patch(event._id, { submissionsClosedAt: now, judgingStatus: "setup", updatedAt: now });
    return { judgingStatus: "setup" };
  },
});

export const startAssignmentPreparation = mutation({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    if (!event.submissionsClosedAt) throw new ConvexError("Close submissions first.");
    if ((event.judgingStatus ?? "setup") !== "setup") {
      throw new ConvexError("Assignments can only be prepared before judging starts.");
    }
    if ((event.roundOneJudges ?? []).length < 2) throw new ConvexError("Add at least 2 judges first.");
    await ctx.db.patch(event._id, { judgingStatus: "preparing_assignments", assignmentPreparationCursor: undefined, assignmentPreparationTotal: 0, updatedAt: Date.now() });
    return { status: "preparing_assignments" };
  },
});

export const prepareAssignmentBatch = mutation({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    if (event.judgingStatus !== "preparing_assignments") throw new ConvexError("Assignment preparation is not active.");
    const result = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .paginate({ cursor: event.assignmentPreparationCursor ?? null, numItems: BATCH_SIZE });
    const batch = result.page;
    const all = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000);
    const counts = buildJudgeAssignmentCounts(all.map((s: Doc<"submissions">) => s.roundOneAssignedJudges));
    let processed = 0;
    for (const submission of batch) {
      if (!isValidRoundOneAssignment(submission.roundOneAssignedJudges) && isJudgingSubmission(submission)) {
        await ctx.db.patch(submission._id, { roundOneAssignedJudges: assignRoundOneJudgePair(event.roundOneJudges!, counts), updatedAt: Date.now() });
      }
      processed += 1;
    }
    const done = result.isDone;
    await ctx.db.patch(event._id, { assignmentPreparationCursor: done ? undefined : result.continueCursor, assignmentPreparationTotal: (event.assignmentPreparationTotal ?? 0) + processed, judgingStatus: done ? "ready" : "preparing_assignments", assignmentVersion: done ? (event.assignmentVersion ?? 0) + 1 : event.assignmentVersion, updatedAt: Date.now() });
    return { processed, done };
  },
});

const overrideValidator = v.object({ submissionId: v.id("submissions"), judges: v.array(v.string()) });

function replacementJudge(
  roster: string[],
  excluded: string[],
  counts: ReturnType<typeof buildJudgeAssignmentCounts>,
) {
  const candidates = roster.filter(
    (judge) => !excluded.some((excludedJudge) => sameJudge(judge, excludedJudge)),
  );
  const replacement = candidates
    .map((judge, index) => ({
      judge,
      index,
      load: counts.individual.get(normalizeJudgeKey(judge)) ?? 0,
    }))
    .sort((a, b) => a.load - b.load || a.index - b.index)[0]?.judge;
  if (!replacement) {
    throw new ConvexError("Add another available judge before redistributing reviews.");
  }
  counts.individual.set(
    normalizeJudgeKey(replacement),
    (counts.individual.get(normalizeJudgeKey(replacement)) ?? 0) + 1,
  );
  return replacement;
}

export const previewRedistribution = query({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    unavailableJudgeKey: v.string(),
    overrides: v.optional(v.array(overrideValidator)),
  },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    const unavailable = await ctx.db
      .query("judgeAccess")
      .withIndex("by_event_and_judge_key", (q) =>
        q.eq("eventId", event._id).eq("judgeKey", args.unavailableJudgeKey),
      )
      .unique();
    if (!unavailable) throw new ConvexError("Judge not found.");
    const submissions = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000);
    const reviews = await ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(2000);
    const counts = buildJudgeAssignmentCounts(submissions.map((s) => s.roundOneAssignedJudges));
    const overrides = new Map((args.overrides ?? []).map((item) => [String(item.submissionId), item.judges]));
    const completedBySubmission = new Map<string, string[]>();
    for (const review of reviews.filter((review) => review.completed)) {
      const key = String(review.submissionId);
      completedBySubmission.set(key, [...(completedBySubmission.get(key) ?? []), review.judgeKey]);
    }

    const changes = [];
    for (const submission of submissions) {
      if (!isJudgingSubmission(submission)) continue;
      const current = submission.roundOneAssignedJudges;
      if (
        !isValidRoundOneAssignment(current) ||
        !current!.some((judge) => sameJudge(judge, unavailable.judgeName))
      ) {
        continue;
      }
      const completedJudges = completedBySubmission.get(String(submission._id)) ?? [];
      if (completedJudges.some((judge) => sameJudge(judge, unavailable.judgeName))) {
        continue;
      }
      const keptJudge = current!.find((judge) => !sameJudge(judge, unavailable.judgeName))!;
      const automatic = current!.map((judge) =>
        sameJudge(judge, unavailable.judgeName)
          ? replacementJudge(event.roundOneJudges ?? [], [unavailable.judgeName, keptJudge], counts)
          : judge,
      );
      changes.push({
        submissionId: submission._id,
        previousJudges: current!,
        judges: overrides.get(String(submission._id)) ?? automatic,
        preservedCompletedJudge: completedJudges.find((judge) => sameJudge(judge, keptJudge)) ?? null,
      });
    }
    return changes;
  },
});

export const applyRedistribution = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    unavailableJudgeKey: v.string(),
    assignments: v.array(overrideValidator),
  },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    const unavailable = await ctx.db
      .query("judgeAccess")
      .withIndex("by_event_and_judge_key", (q) =>
        q.eq("eventId", event._id).eq("judgeKey", args.unavailableJudgeKey),
      )
      .unique();
    if (!unavailable) throw new ConvexError("Judge not found.");
    const allowed = (event.roundOneJudges ?? []).filter(
      (judge) => !sameJudge(judge, unavailable.judgeName),
    );
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .take(1000);
    const requested = new Map(
      args.assignments.map((assignment) => [String(assignment.submissionId), assignment]),
    );
    const eventReviews = await ctx.db
      .query("reviews")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .take(2000);
    const completedUnavailable = new Set(
      eventReviews
        .filter(
          (review) => review.completed && sameJudge(review.judgeKey, unavailable.judgeName),
        )
        .map((review) => String(review.submissionId)),
    );
    const requiredIds: string[] = [];
    for (const submission of submissions) {
      if (!isJudgingSubmission(submission)) continue;
      const current = submission.roundOneAssignedJudges;
      if (
        !isValidRoundOneAssignment(current) ||
        !current!.some((judge) => sameJudge(judge, unavailable.judgeName))
      ) {
        continue;
      }
      if (!completedUnavailable.has(String(submission._id))) {
        requiredIds.push(String(submission._id));
      }
    }
    if (
      requested.size !== args.assignments.length ||
      requiredIds.length !== requested.size ||
      requiredIds.some((submissionId) => !requested.has(submissionId))
    ) {
      throw new ConvexError("Redistribution must include every unfinished assignment in the preview.");
    }
    for (const item of args.assignments) {
      if (
        item.judges.length !== 2 ||
        sameJudge(item.judges[0], item.judges[1]) ||
        item.judges.some((judge) => !allowed.some((candidate) => sameJudge(candidate, judge)))
      ) {
        throw new ConvexError("Invalid judge assignment.");
      }
      const submission = await ctx.db.get(item.submissionId);
      if (!submission || submission.eventId !== event._id) throw new ConvexError("Submission does not belong to this event.");
      const current = submission.roundOneAssignedJudges;
      if (
        !isValidRoundOneAssignment(current) ||
        !current!.some((judge) => sameJudge(judge, unavailable.judgeName))
      ) {
        continue;
      }
      const submissionReviews = eventReviews.filter(
        (review) => review.submissionId === item.submissionId,
      );
      if (submissionReviews.some((review) => review.completed && sameJudge(review.judgeKey, unavailable.judgeName))) {
        continue;
      }
      const keptJudge = current!.find((judge) => !sameJudge(judge, unavailable.judgeName))!;
      if (!item.judges.some((judge) => sameJudge(judge, keptJudge))) {
        throw new ConvexError("Redistribution must keep the other assigned judge.");
      }
      await ctx.db.patch(item.submissionId, { roundOneAssignedJudges: item.judges, updatedAt: Date.now() });
    }
    await ctx.db.patch(unavailable._id, {
      active: false,
      deactivatedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const getMyAssignments = query({
  args: { slug: v.string(), capabilityToken: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db.query("events").withIndex("by_slug", (q) => q.eq("slug", args.slug)).unique();
    if (!event || event.eventType !== "hackathon") throw new ConvexError("Event not found.");
    const access = await judgeAccess(ctx, event._id, args.capabilityToken);
    const submissions = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000);
    const assigned = submissions.filter(
      (submission: Doc<"submissions">) =>
        isJudgingSubmission(submission) &&
        (submission.roundOneAssignedJudges ?? []).some((judge) =>
          sameJudge(judge, access.judgeName),
        ),
    );
    const reviews = await ctx.db.query("reviews").withIndex("by_event_and_judge", (q) => q.eq("eventId", event._id).eq("judgeKey", access.judgeKey)).take(1000);
    const reviewBySubmission = new Map(reviews.map((r: Doc<"reviews">) => [r.submissionId, r]));
    const now = Date.now();
    const remainingMs =
      event.judgingTimerStatus === "running" && event.judgingTimerEndsAt !== undefined
        ? event.judgingTimerEndsAt - now
        : event.judgingTimerRemainingMs ?? event.judgingTimerDurationMs ?? DEFAULT_TIMER_MS;
    const judgingStatus = event.judgingStatus ?? "setup";
    return {
      eventName: event.name,
      judgeName: access.judgeName,
      judgingStatus,
      timer: {
        remainingMs,
        serverNow: now,
        running: event.judgingTimerStatus === "running",
      },
      assignments:
        judgingStatus === "open" || judgingStatus === "closed"
          ? assigned.map((submission) => ({
              id: submission._id,
              demoTitle: submission.demoTitle,
              description: submission.description,
              name: submission.name,
              category: submission.category,
              githubUrl: submission.githubUrl ?? null,
              videoUrl: submission.videoUrl ?? null,
              review: reviewBySubmission.get(submission._id) ?? null,
            }))
          : [],
    };
  },
});

export const saveReview = mutation({
  args: { slug: v.string(), capabilityToken: v.string(), submissionId: v.id("submissions"), innovation: v.optional(v.number()), execution: v.optional(v.number()), demoClarity: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const event = await ctx.db.query("events").withIndex("by_slug", (q) => q.eq("slug", args.slug)).unique();
    if (!event || event.judgingStatus !== "open") throw new ConvexError("Judging is not open.");
    const access = await judgeAccess(ctx, event._id, args.capabilityToken);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.eventId !== event._id || !(submission.roundOneAssignedJudges ?? []).some((j) => sameJudge(j, access.judgeName))) throw new ConvexError("Submission is not assigned to this judge.");
    for (const value of [args.innovation, args.execution, args.demoClarity]) if (value !== undefined && !isJudgingScore(value)) throw new ConvexError("Scores must be whole numbers from 0 to 10.");
    const existing = await ctx.db.query("reviews").withIndex("by_submission_and_judge", (q) => q.eq("submissionId", submission._id).eq("judgeKey", access.judgeKey)).unique();
    const now = Date.now();
    const values = { innovation: args.innovation, execution: args.execution, demoClarity: args.demoClarity, completed: isCompleteReview({ innovation: args.innovation, execution: args.execution, demoClarity: args.demoClarity }), updatedAt: now };
    if (existing) await ctx.db.patch(existing._id, values); else await ctx.db.insert("reviews", { eventId: event._id, submissionId: submission._id, judgeKey: access.judgeKey, ...values, createdAt: now });
    const decision = await ctx.db.query("normalizationDecisions").withIndex("by_event_and_judge", (q) => q.eq("eventId", event._id).eq("judgeKey", access.judgeKey)).unique();
    const valuesChanged =
      !existing ||
      existing.completed !== values.completed ||
      existing.innovation !== values.innovation ||
      existing.execution !== values.execution ||
      existing.demoClarity !== values.demoClarity;
    const changedContributingReview =
      valuesChanged && Boolean(existing?.completed || values.completed);
    if (changedContributingReview) {
      if (decision) await ctx.db.patch(decision._id, { stale: true, updatedAt: now });
      await ctx.db.patch(event._id, { scoreBasisVersion: (event.scoreBasisVersion ?? 0) + 1, confirmedScoreBasisVersion: undefined, updatedAt: now });
    }
    return { completed: values.completed };
  },
});

export function scoreSubmissions(submissions: Doc<"submissions">[], reviews: Doc<"reviews">[]) {
  const bySubmission = new Map<string, Doc<"reviews">[]>();
  const submissionById = new Map(submissions.map((submission) => [String(submission._id), submission]));
  for (const review of reviews.filter((r) => r.completed)) {
    const submission = submissionById.get(String(review.submissionId));
    if (!submission || !(submission.roundOneAssignedJudges ?? []).some((judge) => sameJudge(judge, review.judgeKey))) continue;
    bySubmission.set(String(review.submissionId), [...(bySubmission.get(String(review.submissionId)) ?? []), review]);
  }
  return submissions.map((submission) => { const complete = bySubmission.get(String(submission._id)) ?? []; const score = complete.length ? complete.reduce((sum, r) => sum + (r.innovation! + r.execution! + r.demoClarity!) / 3, 0) / complete.length : null; return { submissionId: submission._id, demoTitle: submission.demoTitle, presenterName: submission.name, completeReviewCount: complete.length, score, warning: complete.length === 1 ? "Only one complete review" : complete.length === 0 ? "No complete reviews" : null }; });
}

export const getAdminProgress = query({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    const [allSubmissions, reviews, access, teamMembers] = await Promise.all([
      ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000),
      ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(2000),
      ctx.db.query("judgeAccess").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(100),
      ctx.db.query("teamMembers").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000),
    ]);
    const submissions = allSubmissions.filter(isJudgingSubmission);
    const nameByJudgeKey = new Map(access.map((judge) => [judge.judgeKey, judge.judgeName]));
    const teamMembersBySubmission = new Map<string, string[]>();
    for (const member of teamMembers) {
      const key = String(member.submissionId);
      teamMembersBySubmission.set(key, [...(teamMembersBySubmission.get(key) ?? []), member.name]);
    }
    return {
      eventStatus: event.judgingStatus ?? "setup",
      submissionsClosedAt: event.submissionsClosedAt ?? null,
      assignmentVersion: event.assignmentVersion ?? null,
      totalSubmissions: submissions.length,
      scoring: scoreSubmissions(submissions, reviews).map((row) => ({
        ...row,
        teamMembers: [
          row.presenterName,
          ...(teamMembersBySubmission.get(String(row.submissionId)) ?? []),
        ],
        assignedJudges:
          submissions.find((submission) => submission._id === row.submissionId)
            ?.roundOneAssignedJudges ?? [],
      })),
      reviews: reviews.map((review) => ({
        submissionId: review.submissionId,
        judgeKey: review.judgeKey,
        judgeName: nameByJudgeKey.get(review.judgeKey) ?? review.judgeKey,
        innovation: review.innovation,
        execution: review.execution,
        demoClarity: review.demoClarity,
        completed: review.completed,
        updatedAt: review.updatedAt,
      })),
    };
  },
});

export const getAdminSubmissionReview = query({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    submissionId: v.id("submissions"),
  },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    const submission = await ctx.db.get(args.submissionId);
    if (
      !submission ||
      submission.eventId !== event._id ||
      !isJudgingSubmission(submission)
    ) {
      throw new ConvexError("Submission not found.");
    }

    const [teamMembers, reviews] = await Promise.all([
      ctx.db
        .query("teamMembers")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .take(20),
      ctx.db
        .query("reviews")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .take(100),
    ]);
    const assignedJudges = submission.roundOneAssignedJudges ?? [];

    return {
      eventName: event.name,
      submission: {
        id: submission._id,
        demoTitle: submission.demoTitle,
        description: submission.description,
        name: submission.name,
        category: submission.category,
        githubUrl: submission.githubUrl ?? null,
        videoUrl: submission.videoUrl ?? null,
        people: [submission.name, ...teamMembers.map((member) => member.name)],
      },
      reviews: assignedJudges.map((judgeName) => {
        const review = reviews.find((candidate) => sameJudge(candidate.judgeKey, judgeName));
        return {
          judgeName,
          innovation: review?.innovation,
          execution: review?.execution,
          demoClarity: review?.demoClarity,
          completed: review?.completed ?? false,
        };
      }),
    };
  },
});

export const setJudgingTimer = mutation({
  args: { slug: v.string(), adminToken: v.string(), durationMs: v.number() },
  handler: async (ctx, args) => { const event = await adminEvent(ctx, args.slug, args.adminToken); const durationMs = Math.max(0, Math.min(MAX_TIMER_MS, Math.round(args.durationMs))); await ctx.db.patch(event._id, { judgingTimerDurationMs: durationMs || DEFAULT_TIMER_MS, judgingTimerRemainingMs: durationMs || DEFAULT_TIMER_MS, updatedAt: Date.now() }); },
});

export const startJudging = mutation({
  args: { slug: v.string(), adminToken: v.string() },
    handler: async (ctx, args) => { const event = await adminEvent(ctx, args.slug, args.adminToken); if (event.judgingStatus !== "ready") throw new ConvexError("Assignments are not ready."); const now = Date.now(); const remaining = event.judgingTimerRemainingMs ?? event.judgingTimerDurationMs ?? DEFAULT_TIMER_MS; await ctx.db.patch(event._id, { judgingStatus: "open", judgingTimerStatus: "running", judgingTimerEndsAt: now + remaining, judgingTimerRemainingMs: remaining, updatedAt: now }); },
});

export const addJudgingTime = mutation({
  args: { slug: v.string(), adminToken: v.string(), deltaMs: v.number() },
  handler: async (ctx, args) => { const event = await adminEvent(ctx, args.slug, args.adminToken); const now = Date.now(); const current = event.judgingTimerStatus === "running" && event.judgingTimerEndsAt !== undefined ? event.judgingTimerEndsAt - now : event.judgingTimerRemainingMs ?? event.judgingTimerDurationMs ?? DEFAULT_TIMER_MS; await ctx.db.patch(event._id, { judgingTimerRemainingMs: current + args.deltaMs, judgingTimerEndsAt: event.judgingTimerStatus === "running" ? now + current + args.deltaMs : event.judgingTimerEndsAt, updatedAt: now }); },
});

export const closeJudging = mutation({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    if (event.judgingStatus !== "open") throw new ConvexError("Judging is not open.");
    const now = Date.now();
    const remaining =
      event.judgingTimerStatus === "running" && event.judgingTimerEndsAt !== undefined
        ? event.judgingTimerEndsAt - now
        : event.judgingTimerRemainingMs ?? 0;
    await ctx.db.patch(event._id, {
      judgingStatus: "closed",
      judgingTimerStatus: "idle",
      judgingTimerRemainingMs: remaining,
      judgingTimerEndsAt: undefined,
      updatedAt: now,
    });
  },
});

export const reopenJudging = mutation({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    if (event.judgingStatus !== "closed") throw new ConvexError("Judging is not closed.");
    const now = Date.now();
    const remaining =
      event.judgingTimerRemainingMs ?? event.judgingTimerDurationMs ?? DEFAULT_TIMER_MS;
    await ctx.db.patch(event._id, {
      judgingStatus: "open",
      judgingTimerStatus: "running",
      judgingTimerEndsAt: now + remaining,
      updatedAt: now,
    });
  },
});

export const getJudgingTimer = query({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => { const event = await adminEvent(ctx, args.slug, args.adminToken); const now = Date.now(); const remainingMs = event.judgingTimerStatus === "running" && event.judgingTimerEndsAt !== undefined ? event.judgingTimerEndsAt - now : event.judgingTimerRemainingMs ?? event.judgingTimerDurationMs ?? DEFAULT_TIMER_MS; return { status: event.judgingStatus ?? "setup", timerStatus: event.judgingTimerStatus ?? "idle", remainingMs, serverNow: now }; },
});

async function currentDecision(ctx: QueryCtx | MutationCtx, eventId: Doc<"events">["_id"]) {
  return await ctx.db.query("judgingDecisions").withIndex("by_event", (q) => q.eq("eventId", eventId)).unique();
}

function completeAssignedReviews(
  submissions: Doc<"submissions">[],
  reviews: Doc<"reviews">[],
) {
  const activeSubmissions = submissions.filter(isJudgingSubmission);
  const submissionById = new Map(
    activeSubmissions.map((submission) => [String(submission._id), submission]),
  );
  const completeReviews = reviews.filter((review) => {
    if (!review.completed || !reviewRow(review)) return false;
    const submission = submissionById.get(String(review.submissionId));
    return Boolean(
      submission?.roundOneAssignedJudges?.some((judge) =>
        sameJudge(judge, review.judgeKey),
      ),
    );
  });
  return { activeSubmissions, completeReviews };
}

function reviewRow(review: Doc<"reviews">): ScoreRow | null {
  if (
    review.innovation === undefined ||
    review.execution === undefined ||
    review.demoClarity === undefined
  ) {
    return null;
  }
  return {
    innovation: review.innovation,
    execution: review.execution,
    demoClarity: review.demoClarity,
  };
}

function normalizationState(
  submissions: Doc<"submissions">[],
  reviews: Doc<"reviews">[],
  decisions: Doc<"normalizationDecisions">[],
) {
  const { activeSubmissions, completeReviews } = completeAssignedReviews(
    submissions,
    reviews,
  );
  const eventMean = mean(
    completeReviews.map(reviewRow).filter((row): row is ScoreRow => row !== null),
  );
  const reviewsByJudge = new Map<string, Doc<"reviews">[]>();
  for (const review of completeReviews) {
    reviewsByJudge.set(review.judgeKey, [
      ...(reviewsByJudge.get(review.judgeKey) ?? []),
      review,
    ]);
  }
  const deltaByJudge = new Map<string, ScoreRow>();
  if (eventMean) {
    for (const [judgeKey, judgeReviews] of reviewsByJudge) {
      const judgeMean = mean(
        judgeReviews.map(reviewRow).filter((row): row is ScoreRow => row !== null),
      );
      if (judgeMean) deltaByJudge.set(judgeKey, adjustmentDelta(judgeMean, eventMean));
    }
  }
  const decisionByJudge = new Map(decisions.map((decision) => [decision.judgeKey, decision]));
  const contributingJudgeKeys = [...reviewsByJudge.keys()];
  // Normalized scores are the default. A fresh explicit raw decision is the
  // only state that opts one judge out of the adjustment.
  const ready = true;
  return {
    activeSubmissions,
    completeReviews,
    reviewsByJudge,
    eventMean,
    deltaByJudge,
    decisionByJudge,
    contributingJudgeKeys,
    ready,
  };
}

function normalizationPreviewForJudge(
  judgeKey: string,
  judgeName: string,
  submissions: Doc<"submissions">[],
  state: ReturnType<typeof normalizationState>,
) {
  const submissionById = new Map(
    submissions.map((submission) => [String(submission._id), submission]),
  );
  const judgeReviews = state.reviewsByJudge.get(judgeKey) ?? [];
  const delta = state.deltaByJudge.get(judgeKey) ?? null;
  const decision = state.decisionByJudge.get(judgeKey);
  return {
    judgeKey,
    judgeName,
    completeReviewCount: judgeReviews.length,
    lowData: judgeReviews.length < 5,
    delta,
    decision: decision
      ? { decision: decision.decision, stale: decision.stale }
      : null,
    effectiveDecision:
      decision?.decision === "raw" && !decision.stale ? "raw" : "apply",
    reviews: judgeReviews.map((review) => {
      const raw = reviewRow(review)!;
      const values = delta ? adjusted(raw, delta) : { unclamped: raw, clamped: raw };
      return {
        submissionId: review.submissionId,
        demoTitle:
          submissionById.get(String(review.submissionId))?.demoTitle ?? "Submission",
        raw,
        delta,
        unclamped: values.unclamped,
        clamped: values.clamped,
        rawAverage: average(raw),
        adjustedAverage: average(values.clamped),
      };
    }),
  };
}

export const previewNormalization = query({
  args: { slug: v.string(), adminToken: v.string(), judgeKey: v.string() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    const judgeName = (event.roundOneJudges ?? []).find(
      (judge) => normalizeJudgeKey(judge) === args.judgeKey,
    );
    if (!judgeName) throw new ConvexError("Judge not found.");
    const [submissions, reviews, decisions] = await Promise.all([
      ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000),
      ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(2000),
      ctx.db.query("normalizationDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(100),
    ]);
    const state = normalizationState(submissions, reviews, decisions);
    return {
      ...normalizationPreviewForJudge(args.judgeKey, judgeName, submissions, state),
      scoreBasisReady: state.ready,
      scoreBasisVersion: event.scoreBasisVersion ?? 0,
    };
  },
});

export const getNormalizationOverview = query({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    const [submissions, reviews, decisions] = await Promise.all([
      ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000),
      ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(2000),
      ctx.db.query("normalizationDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(100),
    ]);
    const state = normalizationState(submissions, reviews, decisions);
    return {
      judgingStatus: event.judgingStatus ?? "setup",
      scoreBasisReady: state.ready,
      scoreBasisVersion: event.scoreBasisVersion ?? 0,
      judges: (event.roundOneJudges ?? []).map((judgeName) =>
        normalizationPreviewForJudge(
          normalizeJudgeKey(judgeName),
          judgeName,
          submissions,
          state,
        ),
      ),
    };
  },
});

export const saveNormalizationDecision = mutation({
  args: { slug: v.string(), adminToken: v.string(), judgeKey: v.string(), decision: v.union(v.literal("apply"), v.literal("raw")) },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    if (event.judgingStatus !== "closed") throw new ConvexError("Close judging first.");
    const [submissions, reviews, decisions] = await Promise.all([
      ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000),
      ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(2000),
      ctx.db.query("normalizationDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(100),
    ]);
    const state = normalizationState(submissions, reviews, decisions);
    if (!state.contributingJudgeKeys.includes(args.judgeKey)) {
      throw new ConvexError("This judge has no complete reviews to normalize.");
    }
    const existing = state.decisionByJudge.get(args.judgeKey);
    const now = Date.now();
    const version = event.scoreBasisVersion ?? 0;
    const fields = {
      decision: args.decision,
      scoreBasisVersion: version,
      stale: false,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else {
      await ctx.db.insert("normalizationDecisions", {
        eventId: event._id,
        judgeKey: args.judgeKey,
        ...fields,
        createdAt: now,
      });
    }
    await ctx.db.patch(event._id, {
      confirmedScoreBasisVersion: version,
      updatedAt: now,
    });
    return { scoreBasisReady: true };
  },
});

function scoreSubmissionsWithNormalization(
  submissions: Doc<"submissions">[],
  reviews: Doc<"reviews">[],
  decisions: Doc<"normalizationDecisions">[],
) {
  const state = normalizationState(submissions, reviews, decisions);
  const reviewsBySubmission = new Map<string, Doc<"reviews">[]>();
  for (const review of state.completeReviews) {
    reviewsBySubmission.set(String(review.submissionId), [
      ...(reviewsBySubmission.get(String(review.submissionId)) ?? []),
      review,
    ]);
  }
  const scored = state.activeSubmissions.map((submission) => {
    const complete = reviewsBySubmission.get(String(submission._id)) ?? [];
    const rawReviewScores = complete.map((review) => average(reviewRow(review)!));
    let adjustedReviewCount = 0;
    const finalReviewScores = complete.map((review) => {
      const raw = reviewRow(review)!;
      const decision = state.decisionByJudge.get(review.judgeKey);
      const delta = state.deltaByJudge.get(review.judgeKey);
      const useAdjustment = !decision || decision.stale || decision.decision === "apply";
      if (state.ready && useAdjustment && delta) {
        adjustedReviewCount += 1;
        return average(adjusted(raw, delta).clamped);
      }
      return average(raw);
    });
    const rawScore = rawReviewScores.length
      ? rawReviewScores.reduce((sum, score) => sum + score, 0) / rawReviewScores.length
      : null;
    const score = finalReviewScores.length
      ? finalReviewScores.reduce((sum, value) => sum + value, 0) / finalReviewScores.length
      : null;
    return {
      submissionId: submission._id,
      demoTitle: submission.demoTitle,
      presenterName: submission.name,
      completeReviewCount: complete.length,
      adjustedReviewCount,
      rawScore,
      score,
      warning:
        complete.length === 1
          ? "Only one complete review"
          : complete.length === 0
            ? "No complete reviews"
            : null,
    };
  });
  scored.sort((left, right) => {
    if (left.score === null && right.score === null) {
      return left.demoTitle.localeCompare(right.demoTitle);
    }
    if (left.score === null) return 1;
    if (right.score === null) return -1;
    return right.score - left.score || left.demoTitle.localeCompare(right.demoTitle);
  });
  return { ...state, scored };
}

export const getFinalistDecision = query({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    const [submissions, reviews, decisions, decision] = await Promise.all([
      ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000),
      ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(2000),
      ctx.db.query("normalizationDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(100),
      currentDecision(ctx, event._id),
    ]);
    const result = scoreSubmissionsWithNormalization(submissions, reviews, decisions);
    return {
      judgingStatus: event.judgingStatus ?? "setup",
      scoreBasisReady: result.ready,
      scoreBasisVersion: result.ready ? event.scoreBasisVersion ?? 0 : null,
      submissions: result.scored,
      finalistIds: decision?.finalistIds ?? [],
      finalistStatus: decision?.finalistStatus ?? "draft",
      finalistVersion: decision?.finalistVersion ?? 0,
      placementIds: decision?.placementIds ?? [],
      placementStatus: decision?.placementStatus ?? "draft",
      placementVersion: decision?.placementVersion ?? 0,
    };
  },
});

async function requireClosedScoreBasis(ctx: MutationCtx, event: Doc<"events">) {
  if (event.judgingStatus !== "closed") throw new ConvexError("Close judging first.");
  const [submissions, reviews, decisions] = await Promise.all([
    ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000),
    ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(2000),
    ctx.db.query("normalizationDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(100),
  ]);
  const state = normalizationState(submissions, reviews, decisions);
  if (!state.ready) {
    throw new ConvexError("Choose Apply adjustment or Keep raw for every judge with complete reviews.");
  }
  return state;
}

async function saveDecision(
  ctx: MutationCtx,
  event: Doc<"events">,
  fields: {
    finalistIds: Doc<"submissions">["_id"][];
    placementIds: Doc<"submissions">["_id"][];
    finalistStatus: "draft" | "submitted" | "needs_review";
    placementStatus: "draft" | "submitted" | "needs_review";
    incrementFinalist?: boolean;
    incrementPlacement?: boolean;
    recordHistory?: boolean;
  },
) {
  const existing = await currentDecision(ctx, event._id);
  const now = Date.now();
  const doc = {
    eventId: event._id,
    finalistIds: fields.finalistIds,
    placementIds: fields.placementIds,
    finalistVersion:
      (existing?.finalistVersion ?? 0) + (fields.incrementFinalist ? 1 : 0),
    placementVersion:
      (existing?.placementVersion ?? 0) + (fields.incrementPlacement ? 1 : 0),
    finalistStatus: fields.finalistStatus,
    placementStatus: fields.placementStatus,
    updatedAt: now,
  };
  const id = existing?._id ?? (await ctx.db.insert("judgingDecisions", doc));
  if (existing) await ctx.db.replace(existing._id, doc);
  const saved = await ctx.db.get(id);
  if (!saved) throw new ConvexError("Could not save judging decision.");
  if (fields.recordHistory) await decisionHistory.update(ctx, saved._id, saved);
  return saved;
}

const idList = v.array(v.id("submissions"));
async function validateIds(
  ctx: MutationCtx,
  event: Doc<"events">,
  ids: Doc<"submissions">["_id"][],
  requireEligible = false,
) {
  if (new Set(ids.map(String)).size !== ids.length) throw new ConvexError("IDs must be unique.");
  for (const id of ids) {
    const submission = await ctx.db.get(id);
    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission does not belong to this event.");
    }
    if (requireEligible && !isJudgingSubmission(submission)) {
      throw new ConvexError("Only active judging submissions can be selected.");
    }
  }
}

export const saveFinalistDraft = mutation({
  args: { slug: v.string(), adminToken: v.string(), finalistIds: idList },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    await requireClosedScoreBasis(ctx, event);
    await validateIds(ctx, event, args.finalistIds, true);
    const current = await currentDecision(ctx, event._id);
    const selected = new Set(args.finalistIds.map(String));
    const placements = (current?.placementIds ?? []).filter((id) => selected.has(String(id)));
    const placementsChanged = placements.length !== (current?.placementIds.length ?? 0);
    await saveDecision(ctx, event, {
      finalistIds: args.finalistIds,
      placementIds: placements,
      finalistStatus: "draft",
      placementStatus: placementsChanged
        ? "needs_review"
        : current?.placementStatus ?? "draft",
    });
  },
});

export const submitFinalists = mutation({
  args: { slug: v.string(), adminToken: v.string(), finalistIds: idList },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    await requireClosedScoreBasis(ctx, event);
    await validateIds(ctx, event, args.finalistIds, true);
    const all = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .take(1000);
    const selected = new Set(args.finalistIds.map(String));
    const now = Date.now();
    for (const submission of all) {
      const finalist = selected.has(String(submission._id));
      if ((submission.finalist ?? false) !== finalist) {
        await ctx.db.patch(submission._id, { finalist, updatedAt: now });
      }
    }
    const current = await currentDecision(ctx, event._id);
    const placements = (current?.placementIds ?? []).filter((id) => selected.has(String(id)));
    const placementsChanged = placements.length !== (current?.placementIds.length ?? 0);
    await saveDecision(ctx, event, {
      finalistIds: args.finalistIds,
      placementIds: placements,
      finalistStatus: "submitted",
      placementStatus: placementsChanged
        ? "needs_review"
        : current?.placementStatus ?? "draft",
      incrementFinalist: true,
      recordHistory: true,
    });
    await ctx.db.patch(event._id, {
      confirmedScoreBasisVersion: event.scoreBasisVersion ?? 0,
      updatedAt: now,
    });
  },
});

export const savePlacementDraft = mutation({
  args: { slug: v.string(), adminToken: v.string(), placementIds: idList },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    await requireClosedScoreBasis(ctx, event);
    const current = await currentDecision(ctx, event._id);
    if (
      !current ||
      current.finalistStatus !== "submitted" ||
      args.placementIds.length > 3 ||
      !args.placementIds.every((id) => current.finalistIds.some((finalistId) => finalistId === id))
    ) {
      throw new ConvexError("Placements must use up to 3 submitted finalists.");
    }
    await validateIds(ctx, event, args.placementIds, true);
    await saveDecision(ctx, event, {
      finalistIds: current.finalistIds,
      placementIds: args.placementIds,
      finalistStatus: current.finalistStatus,
      placementStatus: "draft",
    });
  },
});

export const submitPlacements = mutation({
  args: { slug: v.string(), adminToken: v.string(), placementIds: idList },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug, args.adminToken);
    await requireClosedScoreBasis(ctx, event);
    const current = await currentDecision(ctx, event._id);
    if (
      !current ||
      current.finalistStatus !== "submitted" ||
      args.placementIds.length < 1 ||
      args.placementIds.length > 3 ||
      !args.placementIds.every((id) => current.finalistIds.some((finalistId) => finalistId === id))
    ) {
      throw new ConvexError("Placements must contain 1 to 3 submitted finalists.");
    }
    await validateIds(ctx, event, args.placementIds, true);
    await saveDecision(ctx, event, {
      finalistIds: current.finalistIds,
      placementIds: args.placementIds,
      finalistStatus: current.finalistStatus,
      placementStatus: "submitted",
      incrementPlacement: true,
      recordHistory: true,
    });
  },
});
