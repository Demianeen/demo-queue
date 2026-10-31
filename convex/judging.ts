import { requireOrganization, requireOwnedEvent, type OrganizationPrincipal } from "./organizationAuth";
import { ConvexError, v, type Infer } from "convex/values";
import { findEventBySlug } from "./eventSlugs";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { buildJudgeAssignmentCounts, isValidRoundOneAssignment, judgeKeyOf, judgeNameKey, MAX_JUDGE_NAME_LENGTH, MAX_ROUND_ONE_JUDGES, normalizeJudgeName, parseJudgeNames, assignRoundOneJudgePair } from "../lib/judging-assignment";
import { loadJudgeDirectory, newJudgeKey } from "./judgeDirectory";
import { queueJudgingSheetSync } from "./judgingSheetSync";
import { randomToken } from "../lib/tokens";
import { isCompleteReview, isJudgingScore } from "../lib/judging-rubric";
import { TableHistory } from "@convex-dev/table-history";
import { listEventTracks, trackNamesFor, tracksById } from "./tracks";
import { components } from "./_generated/api";
import { aiSummaryStatus, publicAiRead, publicAiSummary } from "./aiSummaries";
import { listEventSponsors } from "./sponsors";
import { recordChange } from "./changeLog";
import { withChange } from "./changeWrap";
import { closeJudgingForEvent, closeSubmissionsForEvent, judgingRemaining, reopenJudgingForEvent, syncFinalistLineup } from "./phases";
import { eventPhase } from "../lib/event-phase";
import { isJudgedStatus } from "../lib/judged-status";
import type { DataModel } from "./_generated/dataModel";
import {
  adjusted,
  adjustmentDelta,
  average,
  mean,
  type ScoreRow,
} from "../lib/normalization";
import { bumpScoreBasis, confirmScoreBasis, readScoreBasis } from "./scoreBasis";

const BATCH_SIZE = 50;
const DEFAULT_TIMER_MS = 60 * 60 * 1000;
const MAX_TIMER_MS = 99 * 60 * 60 * 1000;
const decisionHistory = new TableHistory<DataModel, "judgingDecisions">(components.judgingDecisionHistory);

/** "15:00", "1:05:00": how a time reads in Recent changes. */
export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** The key a stored judge reference stands for. See judgeKeyOf. */
export const normalizeJudgeKey = judgeKeyOf;

/** In judging: waiting, in the stage lineup, or already pitched. See isJudgedStatus. */
function isJudgingSubmission(submission: Doc<"submissions">) {
  return isJudgedStatus(submission.status);
}

async function adminEvent(ctx: QueryCtx | MutationCtx, slug: string) {
  return ownedAdminEvent(ctx, slug, await requireOrganization(ctx));
}

async function ownedAdminEvent(
  ctx: QueryCtx | MutationCtx,
  slug: string,
  principal: OrganizationPrincipal,
) {
  const { event } = await requireOwnedEvent(ctx, slug, principal);
  if (event.eventType !== "hackathon") throw new ConvexError("Judging is only available for hackathon events.");
  return event;
}

async function judgeAccess(ctx: QueryCtx | MutationCtx, eventId: Doc<"events">["_id"], token: string) {
  const access = await ctx.db.query("judgeAccess").withIndex("by_token", (q) => q.eq("token", token)).unique();
  if (!access || access.eventId !== eventId || !access.active) throw new ConvexError("Unauthorized");
  return access;
}

export const createJudgeAccessArgs = v.object({ slug: v.string(), judgeName: v.string(), capabilityToken: v.string() });

export async function createJudgeAccessForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof createJudgeAccessArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  const typedName = normalizeJudgeName(args.judgeName);
  if (!typedName || !args.capabilityToken) throw new ConvexError("Judge name and capability token are required.");
  // The caller only has the judge's name, so the judge is found by the name they have now.
  const judge = (await loadJudgeDirectory(ctx, event)).byName(typedName);
  if (!judge?.onRoster) {
    throw new ConvexError("Add this judge to the event before creating their link.");
  }
  const judgeKey = judge.key;
  const judgeName = judge.name;
  const existing = judge.access;
  const tokenOwner = await ctx.db.query("judgeAccess").withIndex("by_token", (q) => q.eq("token", args.capabilityToken)).unique();
  if (tokenOwner && tokenOwner._id !== existing?._id) {
    throw new ConvexError("This private link token is already in use.");
  }
  const now = Date.now();
  const fields = {
    judgeName, token: args.capabilityToken, active: true, updatedAt: now, deactivatedAt: undefined,
    // A new link has not been opened yet.
    ...(existing && existing.token !== args.capabilityToken ? { openedAt: undefined } : {}),
  };
  await recordChange(ctx, {
    event, principal, kind: existing ? "judge_link_updated" : "judge_link_created",
    summary: `${existing ? "updated" : "created"} the judging link for ${judgeName}`, watch: { judgeAccess: "all" },
  }, async () => {
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("judgeAccess", { eventId: event._id, judgeKey, ...fields, createdAt: now });
  });
  return { judgeKey };
}

export const createJudgeAccess = mutation({
  args: createJudgeAccessArgs,
  handler: async (ctx, args) =>
    createJudgeAccessForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const listJudgeAccessArgs = v.object({ slug: v.string(), });

export async function listJudgeAccessForOrganization(
  ctx: QueryCtx,
  args: Infer<typeof listJudgeAccessArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  return await ctx.db.query("judgeAccess").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(100);
}

export const listJudgeAccess = query({
  args: listJudgeAccessArgs,
  handler: async (ctx, args) =>
    listJudgeAccessForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setJudgeLinkActiveArgs = v.object({ slug: v.string(), judgeKey: v.string(), active: v.boolean() });

/** Turns one judge's link off or back on, without moving their projects. */
export async function setJudgeLinkActiveForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof setJudgeLinkActiveArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  const access = await ctx.db.query("judgeAccess").withIndex("by_event_and_judge_key", (q) => q.eq("eventId", event._id).eq("judgeKey", args.judgeKey)).unique();
  if (!access) throw new ConvexError("Judge not found.");
  const now = Date.now();
  await recordChange(ctx, {
    event, principal, kind: args.active ? "judge_link_on" : "judge_link_off",
    summary: `turned ${args.active ? "on" : "off"} the judging link for ${access.judgeName}`, watch: { judgeAccess: "all" },
  }, async () => {
    await ctx.db.patch(access._id, { active: args.active, deactivatedAt: args.active ? undefined : now, updatedAt: now });
  });
}

export const deactivateJudgeAccess = mutation({
  args: setJudgeLinkActiveArgs,
  handler: async (ctx, args) =>
    setJudgeLinkActiveForOrganization(ctx, args, await requireOrganization(ctx)),
});

/** Judges added later get a private link at once: their name is kept on it. */
async function insertJudgeLink(ctx: MutationCtx, event: Doc<"events">, judgeKey: string, judgeName: string) {
  const now = Date.now();
  await ctx.db.insert("judgeAccess", { eventId: event._id, judgeKey, judgeName, token: randomToken(), active: true, createdAt: now, updatedAt: now });
}

function judgeNameError(name: string) {
  if (!name) return "Enter the judge's name.";
  if (name.length > MAX_JUDGE_NAME_LENGTH) return `Judge names must be ${MAX_JUDGE_NAME_LENGTH} characters or fewer.`;
  return null;
}

/**
 * Adds judges by name, each with a new key and their own link. A name a
 * judge on the roster already has is skipped. A judge who was removed comes
 * back as themselves, with their link. Judges added during judging get no
 * projects until assignments change, as before.
 */
export async function addJudgesToEvent(ctx: MutationCtx, event: Doc<"events">, names: string[], { syncSheet = true } = {}) {
  let parsed: string[];
  try {
    parsed = parseJudgeNames(names);
  } catch (error) {
    throw new ConvexError(error instanceof Error ? error.message : "Invalid judge names.");
  }
  const directory = await loadJudgeDirectory(ctx, event);
  const roster = [...(event.roundOneJudges ?? [])];
  const taken = new Set(directory.judges.map((judge) => judge.key));
  const added: { judgeKey: string; judgeName: string }[] = [];
  const skipped: string[] = [];
  const now = Date.now();
  for (const name of parsed) {
    const existing = directory.byName(name);
    if (existing?.onRoster) {
      skipped.push(existing.name);
      continue;
    }
    if (roster.length >= MAX_ROUND_ONE_JUDGES) throw new ConvexError(`Add no more than ${MAX_ROUND_ONE_JUDGES} judges.`);
    if (existing?.access) {
      roster.push(existing.key);
      await ctx.db.patch(existing.access._id, { active: true, deactivatedAt: undefined, updatedAt: now });
      added.push({ judgeKey: existing.key, judgeName: existing.name });
      continue;
    }
    const judgeKey = newJudgeKey(taken);
    taken.add(judgeKey);
    roster.push(judgeKey);
    await insertJudgeLink(ctx, event, judgeKey, name);
    added.push({ judgeKey, judgeName: name });
  }
  if (added.length > 0) {
    await ctx.db.patch(event._id, { roundOneJudges: roster, updatedAt: now });
    if (syncSheet) await queueJudgingSheetSync(ctx, event, 0);
  }
  return { added, skipped };
}

/**
 * Takes a judge off the roster. Refused once they have a score: turn them
 * off instead, so the scores stay. Projects they were given go to the least
 * busy judge who is on, beside the judge already there. Their link stops
 * working and is kept, so adding them again brings it back.
 */
export async function removeJudgeFromEvent(ctx: MutationCtx, event: Doc<"events">, judgeKey: string, { syncSheet = true, leaving = [] as string[] } = {}) {
  const directory = await loadJudgeDirectory(ctx, event);
  const judge = directory.get(judgeKey);
  if (!judge?.onRoster) throw new ConvexError("Judge not found.");
  const scored = await ctx.db.query("reviews").withIndex("by_event_and_judge", (q) => q.eq("eventId", event._id).eq("judgeKey", judge.key)).first();
  if (scored) throw new ConvexError(`${judge.name} has scores, so they can't be removed. Turn them off instead: their scores stay.`);
  const roster = (event.roundOneJudges ?? []).filter((reference) => judgeKeyOf(reference) !== judge.key);
  const submissions = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000);
  const affected = submissions.filter((submission) =>
    isValidRoundOneAssignment(submission.roundOneAssignedJudges) &&
    submission.roundOneAssignedJudges!.some((reference) => judgeKeyOf(reference) === judge.key));
  const now = Date.now();
  if (affected.length > 0) {
    // Judges who are off, or leaving in the same save, take nothing new.
    const candidates = directory.roster.filter((other) => other.key !== judge.key && !leaving.includes(other.key) && other.access?.active !== false).map((other) => other.key);
    const counts = buildJudgeAssignmentCounts(submissions.map((submission) => submission.roundOneAssignedJudges));
    for (const submission of affected) {
      const current = submission.roundOneAssignedJudges!;
      const kept = current.map(judgeKeyOf).find((key) => key !== judge.key)!;
      let replacement: string;
      try {
        replacement = replacementJudge(candidates, [judge.key, kept], counts);
      } catch {
        throw new ConvexError(`Add another judge before removing ${judge.name}: their projects need someone.`);
      }
      await ctx.db.patch(submission._id, {
        roundOneAssignedJudges: current.map((reference) => (judgeKeyOf(reference) === judge.key ? rosterReference(event, replacement) : reference)),
        updatedAt: now,
      });
    }
  }
  if (judge.access?.active) await ctx.db.patch(judge.access._id, { active: false, deactivatedAt: now, updatedAt: now });
  await ctx.db.patch(event._id, { roundOneJudges: roster, updatedAt: now });
  if (syncSheet) await queueJudgingSheetSync(ctx, event, 0);
  return { judgeKey: judge.key, reassignedSubmissionIds: affected.map((submission) => submission._id) };
}

export const addJudgesArgs = v.object({ slug: v.string(), names: v.array(v.string()) });

async function addJudgesOperation(ctx: MutationCtx, args: Infer<typeof addJudgesArgs>, principal: OrganizationPrincipal) {
  return addJudgesToEvent(ctx, await ownedAdminEvent(ctx, args.slug, principal), args.names);
}

export const addJudgesForOrganization = withChange<Infer<typeof addJudgesArgs>, Awaited<ReturnType<typeof addJudgesOperation>>>(
  (_ctx, args) => {
    const names = args.names.map(normalizeJudgeName).filter(Boolean);
    return { kind: "judges_added", summary: `added ${names.length === 1 ? names[0] : `${names.length} judges`}`, watch: { judgeAccess: "all" } };
  },
  addJudgesOperation,
);

export const addJudges = mutation({
  args: addJudgesArgs,
  handler: async (ctx, args) =>
    addJudgesForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const removeJudgeArgs = v.object({ slug: v.string(), judgeKey: v.string() });

async function removeJudgeOperation(ctx: MutationCtx, args: Infer<typeof removeJudgeArgs>, principal: OrganizationPrincipal) {
  return removeJudgeFromEvent(ctx, await ownedAdminEvent(ctx, args.slug, principal), args.judgeKey);
}

export const removeJudgeForOrganization = withChange<Infer<typeof removeJudgeArgs>, Awaited<ReturnType<typeof removeJudgeOperation>>>(
  async (ctx, args, event) => ({ kind: "judge_removed", summary: `removed ${await judgeNameFor(ctx, event, args.judgeKey)}`, watch: { submissions: "all", judgeAccess: "all" } }),
  removeJudgeOperation,
);

export const removeJudge = mutation({
  args: removeJudgeArgs,
  handler: async (ctx, args) =>
    removeJudgeForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const renameJudgeArgs = v.object({ slug: v.string(), judgeKey: v.string(), name: v.string() });

/**
 * Changes only the name a judge is shown by. Their key, link, assignments,
 * scores and evening-out choice stay, since all of them hold the key.
 */
async function renameJudgeOperation(ctx: MutationCtx, args: Infer<typeof renameJudgeArgs>, principal: OrganizationPrincipal) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  const name = normalizeJudgeName(args.name);
  const invalid = judgeNameError(name);
  if (invalid) throw new ConvexError(invalid);
  const directory = await loadJudgeDirectory(ctx, event);
  const judge = directory.get(args.judgeKey);
  if (!judge) throw new ConvexError("Judge not found.");
  const clash = directory.judges.find((other) => other.key !== judge.key && judgeNameKey(other.name) === judgeNameKey(name));
  if (clash) throw new ConvexError(`Another judge is already called ${clash.name}.`);
  if (judge.name !== name) {
    // A judge from before ids with no link yet keeps their name on the roster; their link holds the new one.
    if (judge.access) await ctx.db.patch(judge.access._id, { judgeName: name, updatedAt: Date.now() });
    else await insertJudgeLink(ctx, event, judge.key, name);
    await queueJudgingSheetSync(ctx, event);
  }
  return { judgeKey: judge.key, judgeName: name };
}

export const renameJudgeForOrganization = withChange<Infer<typeof renameJudgeArgs>, Awaited<ReturnType<typeof renameJudgeOperation>>>(
  async (ctx, args, event) => ({ kind: "judge_renamed", summary: `renamed ${await judgeNameFor(ctx, event, args.judgeKey)} to ${normalizeJudgeName(args.name)}`, watch: { judgeAccess: "all" } }),
  renameJudgeOperation,
);

export const renameJudge = mutation({
  args: renameJudgeArgs,
  handler: async (ctx, args) =>
    renameJudgeForOrganization(ctx, args, await requireOrganization(ctx)),
});

/** The private path a judge opens: /judge/<slug>/<token>. */
export function judgeLinkPath(event: Pick<Doc<"events">, "slug">, token: string) {
  return `/judge/${event.slug}/${token}`;
}

export const getJudgesOverviewArgs = v.object({ slug: v.string() });

/**
 * The Judges page table: one row per judge on the roster (and any link left
 * from a removed judge), with their link, whether they opened it, how many
 * of their own projects they scored, and how many others they helped with.
 * "Copy all links" builds its WhatsApp, Slack and Notion text from the
 * active rows.
 */
export async function getJudgesOverviewForOrganization(
  ctx: QueryCtx,
  args: Infer<typeof getJudgesOverviewArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  const [directory, submissions, reviews] = await Promise.all([
    loadJudgeDirectory(ctx, event),
    ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000),
    ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(4000),
  ]);
  const judging = submissions.filter(isJudgingSubmission);
  const judgingIds = new Set(judging.map((submission) => String(submission._id)));
  const reviewedKeys = new Set(reviews.map((review) => review.judgeKey));
  // A judge removed from the roster stays listed only while they have scores.
  const judges = directory.judges.filter((judge) => judge.onRoster || reviewedKeys.has(judge.key));
  const titleById = new Map(submissions.map((submission) => [String(submission._id), submission.demoTitle || submission.teamName || submission.name]));
  const completeBySubmission = new Map<string, number>();
  for (const review of reviews) {
    if (review.completed && judgingIds.has(String(review.submissionId))) {
      completeBySubmission.set(String(review.submissionId), (completeBySubmission.get(String(review.submissionId)) ?? 0) + 1);
    }
  }
  const rows = judges.map(({ key: judgeKey, name: judgeName, onRoster, access: link }) => {
    const assigned = judging.filter((submission) => isAssignedTo(submission, judgeKey));
    const assignedIds = new Set(assigned.map((submission) => String(submission._id)));
    const complete = reviews.filter((review) => review.judgeKey === judgeKey && review.completed && judgingIds.has(String(review.submissionId)));
    const started = reviews.filter((review) => review.judgeKey === judgeKey && judgingIds.has(String(review.submissionId)));
    return {
      judgeKey,
      judgeName,
      onRoster,
      hasLink: Boolean(link),
      active: link?.active ?? false,
      path: link ? judgeLinkPath(event, link.token) : null,
      openedAt: link?.openedAt ?? null,
      deactivatedAt: link?.deactivatedAt ?? null,
      linkCreatedAt: link?.createdAt ?? null,
      assignedCount: assigned.length,
      assignedScoredCount: complete.filter((review) => assignedIds.has(String(review.submissionId))).length,
      // Complete reviews on projects assigned to someone else.
      helpedCount: complete.filter((review) => !assignedIds.has(String(review.submissionId))).length,
      // Started but not finished, on any project.
      inProgressCount: started.filter((review) => !review.completed).length,
      lastScoredAt: started.reduce<number | null>((latest, review) => Math.max(latest ?? 0, review.updatedAt), null),
      // Every project this judge has a review of, finished or not: what Move scores moves.
      reviewedProjects: reviews.filter((review) => review.judgeKey === judgeKey).map((review) => ({
        submissionId: review.submissionId,
        demoTitle: titleById.get(String(review.submissionId)) ?? "A project",
      })),
    };
  });
  return {
    judgingStatus: event.judgingStatus ?? "setup",
    reviewTarget: REVIEW_TARGET,
    totals: {
      judges: rows.filter((row) => row.onRoster).length,
      activeJudges: rows.filter((row) => row.active).length,
      openedJudges: rows.filter((row) => row.active && row.openedAt !== null).length,
      projects: judging.length,
      fullyReviewedProjects: judging.filter((submission) => (completeBySubmission.get(String(submission._id)) ?? 0) >= REVIEW_TARGET).length,
      completeReviews: [...completeBySubmission.values()].reduce((sum, count) => sum + count, 0),
      targetReviews: judging.length * REVIEW_TARGET,
    },
    judges: rows,
  };
}

export const getJudgesOverview = query({
  args: getJudgesOverviewArgs,
  handler: async (ctx, args) =>
    getJudgesOverviewForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const replaceJudgeLinkArgs = v.object({ slug: v.string(), judgeKey: v.string(), capabilityToken: v.string() });

/**
 * Gives a judge a new private link, for when theirs went to the wrong person.
 * The old link stops working at once, and Opened clears until the new one
 * is confirmed. Scores stay with the judge.
 */
export async function replaceJudgeLinkForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof replaceJudgeLinkArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  if (args.capabilityToken.length < 16) throw new ConvexError("The new link token is too short.");
  const access = await ctx.db.query("judgeAccess").withIndex("by_event_and_judge_key", (q) => q.eq("eventId", event._id).eq("judgeKey", args.judgeKey)).unique();
  if (!access) throw new ConvexError("Judge not found.");
  const tokenOwner = await ctx.db.query("judgeAccess").withIndex("by_token", (q) => q.eq("token", args.capabilityToken)).unique();
  if (tokenOwner) throw new ConvexError("This private link token is already in use.");
  const now = Date.now();
  await recordChange(ctx, {
    event, principal, kind: "judge_link_replaced", summary: `replaced the judging link for ${access.judgeName}`, watch: { judgeAccess: "all" },
  }, async () => {
    await ctx.db.patch(access._id, { token: args.capabilityToken, openedAt: undefined, replacedAt: now, updatedAt: now });
  });
  return { judgeKey: access.judgeKey, path: judgeLinkPath(event, args.capabilityToken) };
}

export const replaceJudgeLink = mutation({
  args: replaceJudgeLinkArgs,
  handler: async (ctx, args) =>
    replaceJudgeLinkForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const moveJudgeScoresArgs = v.object({
  slug: v.string(),
  fromJudgeKey: v.string(),
  toJudgeKey: v.string(),
  // Only these projects; every review of the first judge when left out.
  submissionIds: v.optional(v.array(v.id("submissions"))),
});

/**
 * Moves reviews from one judge to another, for when someone scored on the
 * wrong link. Refuses when the other judge already has a review of the same
 * project, naming those projects, so no score is overwritten.
 */
export async function moveJudgeScoresForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof moveJudgeScoresArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  if (args.fromJudgeKey === args.toJudgeKey) throw new ConvexError("Choose another judge to move the scores to.");
  const directory = await loadJudgeDirectory(ctx, event);
  const fromName = directory.get(args.fromJudgeKey)?.name;
  const toName = directory.get(args.toJudgeKey)?.name;
  if (!fromName || !toName) throw new ConvexError("Judge not found.");
  const only = args.submissionIds ? new Set(args.submissionIds.map(String)) : null;
  const fromReviews = (await ctx.db.query("reviews").withIndex("by_event_and_judge", (q) => q.eq("eventId", event._id).eq("judgeKey", args.fromJudgeKey)).take(1000))
    .filter((review) => !only || only.has(String(review.submissionId)));
  if (fromReviews.length === 0) throw new ConvexError(`${fromName} has no scores to move.`);
  const toReviews = await ctx.db.query("reviews").withIndex("by_event_and_judge", (q) => q.eq("eventId", event._id).eq("judgeKey", args.toJudgeKey)).take(1000);
  const clashes = fromReviews.filter((review) => toReviews.some((other) => other.submissionId === review.submissionId));
  if (clashes.length > 0) {
    const titles = await Promise.all(clashes.slice(0, 3).map(async (review) => (await ctx.db.get(review.submissionId))?.demoTitle ?? "a project"));
    throw new ConvexError(`${toName} already scored ${titles.join(", ")}${clashes.length > 3 ? ` and ${clashes.length - 3} more` : ""}. Leave those out to move the rest.`);
  }
  const now = Date.now();
  await recordChange(ctx, {
    event, principal, kind: "judge_scores_moved",
    summary: `moved ${fromReviews.length} score${fromReviews.length === 1 ? "" : "s"} from ${fromName} to ${toName}`,
    watch: { reviews: "all", normalizationDecisions: "all" },
  }, async () => {
    for (const review of fromReviews) await ctx.db.patch(review._id, { judgeKey: args.toJudgeKey, updatedAt: now });
    await markScoreBasisChanged(ctx, event, [args.fromJudgeKey, args.toJudgeKey], now);
  });
  return { moved: fromReviews.length };
}

export const moveJudgeScores = mutation({
  args: moveJudgeScoresArgs,
  handler: async (ctx, args) =>
    moveJudgeScoresForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const closeSubmissionsArgs = v.object({ slug: v.string(), });

export async function closeSubmissionsForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof closeSubmissionsArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  if (event.submissionsClosedAt !== undefined) {
    return { judgingStatus: event.judgingStatus ?? "setup" };
  }
  const judgingStatus = await recordChange(ctx, {
    event, principal, kind: "phase_changed", summary: "closed submissions", undoLabel: "Reopen",
    undo: "phase", fromPhase: eventPhase(event), toPhase: "judging", watch: { submissions: "all" },
  }, () => closeSubmissionsForEvent(ctx, event));
  return { judgingStatus };
}

export const closeSubmissions = mutation({
  args: closeSubmissionsArgs,
  handler: async (ctx, args) =>
    closeSubmissionsForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const startAssignmentPreparationArgs = v.object({ slug: v.string(), });

export async function startAssignmentPreparationForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof startAssignmentPreparationArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  if (!event.submissionsClosedAt) throw new ConvexError("Close submissions first.");
  if ((event.judgingStatus ?? "setup") !== "setup") {
    throw new ConvexError("Assignments can only be prepared before judging starts.");
  }
  if ((event.roundOneJudges ?? []).length < 2) throw new ConvexError("Add at least 2 judges first.");
  await ctx.db.patch(event._id, { judgingStatus: "preparing_assignments", assignmentPreparationCursor: undefined, assignmentPreparationTotal: 0, updatedAt: Date.now() });
  return { status: "preparing_assignments" };
}

export const startAssignmentPreparation = mutation({
  args: startAssignmentPreparationArgs,
  handler: async (ctx, args) =>
    startAssignmentPreparationForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const prepareAssignmentBatchArgs = v.object({ slug: v.string(), });

export async function prepareAssignmentBatchForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof prepareAssignmentBatchArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
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
}

export const prepareAssignmentBatch = mutation({
  args: prepareAssignmentBatchArgs,
  handler: async (ctx, args) =>
    prepareAssignmentBatchForOrganization(ctx, args, await requireOrganization(ctx)),
});

const overrideValidator = v.object({ submissionId: v.id("submissions"), judges: v.array(v.string()) });

/** The least loaded of these judge keys, leaving out `excluded`. */
function replacementJudge(
  candidateKeys: string[],
  excluded: string[],
  counts: ReturnType<typeof buildJudgeAssignmentCounts>,
) {
  const replacement = candidateKeys
    .filter((key) => !excluded.includes(key))
    .map((key, index) => ({ key, index, load: counts.individual.get(key) ?? 0 }))
    .sort((a, b) => a.load - b.load || a.index - b.index)[0]?.key;
  if (!replacement) {
    throw new ConvexError("Add another available judge before redistributing reviews.");
  }
  counts.individual.set(replacement, (counts.individual.get(replacement) ?? 0) + 1);
  return replacement;
}

export const previewRedistributionArgs = v.object({
    slug: v.string(),
    unavailableJudgeKey: v.string(),
    overrides: v.optional(v.array(overrideValidator)),
  });

export async function previewRedistributionForOrganization(
  ctx: QueryCtx,
  args: Infer<typeof previewRedistributionArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  const directory = await loadJudgeDirectory(ctx, event);
  const unavailable = directory.get(args.unavailableJudgeKey)?.access;
  if (!unavailable) throw new ConvexError("Judge not found.");
  const unavailableKey = unavailable.judgeKey;
  const submissions = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000);
  const reviews = await ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(2000);
  const counts = buildJudgeAssignmentCounts(submissions.map((s) => s.roundOneAssignedJudges));
  const overrides = new Map((args.overrides ?? []).map((item) => [String(item.submissionId), item.judges.map(judgeKeyOf)]));
  const completedBySubmission = new Map<string, string[]>();
  for (const review of reviews.filter((review) => review.completed)) {
    const key = String(review.submissionId);
    completedBySubmission.set(key, [...(completedBySubmission.get(key) ?? []), review.judgeKey]);
  }
  // Judges who are turned off take nothing new.
  const candidates = directory.roster.filter((judge) => judge.access?.active !== false).map((judge) => judge.key);

  const changes = [];
  for (const submission of submissions) {
    if (!isJudgingSubmission(submission)) continue;
    const current = submission.roundOneAssignedJudges;
    if (!isValidRoundOneAssignment(current)) continue;
    const currentKeys = current!.map(judgeKeyOf);
    if (!currentKeys.includes(unavailableKey)) continue;
    const completedJudges = completedBySubmission.get(String(submission._id)) ?? [];
    if (completedJudges.includes(unavailableKey)) continue;
    const keptJudge = currentKeys.find((key) => key !== unavailableKey)!;
    const automatic = currentKeys.map((key) =>
      key === unavailableKey ? replacementJudge(candidates, [unavailableKey, keptJudge], counts) : key,
    );
    const judges = overrides.get(String(submission._id)) ?? automatic;
    changes.push({
      submissionId: submission._id,
      // Judge keys, with the names to show beside them.
      previousJudges: currentKeys,
      previousJudgeNames: currentKeys.map(directory.nameOf),
      judges,
      judgeNames: judges.map(directory.nameOf),
      preservedCompletedJudge: completedJudges.find((key) => key === keptJudge) ?? null,
    });
  }
  return changes;
}

export const previewRedistribution = query({
  args: previewRedistributionArgs,
  handler: async (ctx, args) =>
    previewRedistributionForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const applyRedistributionArgs = v.object({
    slug: v.string(),
    unavailableJudgeKey: v.string(),
    assignments: v.array(overrideValidator),
  });

async function applyRedistributionOperation(
  ctx: MutationCtx,
  args: Infer<typeof applyRedistributionArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  const directory = await loadJudgeDirectory(ctx, event);
  const unavailable = directory.get(args.unavailableJudgeKey)?.access;
  if (!unavailable) throw new ConvexError("Judge not found.");
  const unavailableKey = unavailable.judgeKey;
  const allowed = new Set(directory.roster.map((judge) => judge.key).filter((key) => key !== unavailableKey));
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
      .filter((review) => review.completed && review.judgeKey === unavailableKey)
      .map((review) => String(review.submissionId)),
  );
  const assignedToUnavailable = (assignment: string[] | undefined) =>
    isValidRoundOneAssignment(assignment) && assignment!.some((reference) => judgeKeyOf(reference) === unavailableKey);
  const requiredIds: string[] = [];
  for (const submission of submissions) {
    if (!isJudgingSubmission(submission)) continue;
    if (!assignedToUnavailable(submission.roundOneAssignedJudges)) continue;
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
    const judges = item.judges.map(judgeKeyOf);
    if (
      judges.length !== 2 ||
      judges[0] === judges[1] ||
      judges.some((key) => !allowed.has(key))
    ) {
      throw new ConvexError("Invalid judge assignment.");
    }
    const submission = await ctx.db.get(item.submissionId);
    if (!submission || submission.eventId !== event._id) throw new ConvexError("Submission does not belong to this event.");
    const current = submission.roundOneAssignedJudges;
    if (!assignedToUnavailable(current)) continue;
    if (completedUnavailable.has(String(item.submissionId))) continue;
    const keptJudge = current!.map(judgeKeyOf).find((key) => key !== unavailableKey)!;
    if (!judges.includes(keptJudge)) {
      throw new ConvexError("Redistribution must keep the other assigned judge.");
    }
    await ctx.db.patch(item.submissionId, { roundOneAssignedJudges: judges.map((key) => rosterReference(event, key)), updatedAt: Date.now() });
  }
  await ctx.db.patch(unavailable._id, {
    active: false,
    deactivatedAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export const applyRedistribution = mutation({
  args: applyRedistributionArgs,
  handler: async (ctx, args) =>
    applyRedistributionForOrganization(ctx, args, await requireOrganization(ctx)),
});

/**
 * How the roster stores this judge: their key, or on an event set up before
 * judges had ids, their name then. Assignments store the same, so an old
 * event keeps one shape throughout.
 */
export function rosterReference(event: Pick<Doc<"events">, "roundOneJudges">, key: string) {
  return (event.roundOneJudges ?? []).find((reference) => judgeKeyOf(reference) === key) ?? key;
}

/** Judges see submissions only once judging is open, and keep read access after it closes. */
function judgingVisible(event: Doc<"events">) {
  const judgingStatus = event.judgingStatus ?? "setup";
  return judgingStatus === "open" || judgingStatus === "closed";
}

function isAssignedTo(submission: Doc<"submissions">, judgeKey: string) {
  return (submission.roundOneAssignedJudges ?? []).some((reference) => judgeKeyOf(reference) === judgeKey);
}

/**
 * What a judge may read about a submission: the project, its team and its links.
 * Never phones, emails or tokens.
 */
async function judgeSubmissionViews(
  ctx: QueryCtx,
  event: Doc<"events">,
  submissions: Doc<"submissions">[],
) {
  const byId = tracksById(await listEventTracks(ctx, event._id));
  const sponsors = await listEventSponsors(ctx, event._id);
  const members = await ctx.db
    .query("teamMembers")
    .withIndex("by_event", (q) => q.eq("eventId", event._id))
    .take(5000);
  const memberCount = new Map<string, number>();
  for (const member of members) {
    memberCount.set(String(member.submissionId), (memberCount.get(String(member.submissionId)) ?? 0) + 1);
  }
  return submissions.map((submission) => ({
    id: submission._id,
    demoTitle: submission.demoTitle,
    description: submission.description,
    name: submission.name,
    teamName: submission.teamName ?? null,
    // The presenter plus everyone they listed.
    memberCount: 1 + (memberCount.get(String(submission._id)) ?? 0),
    tracks: trackNamesFor(submission, byId),
    // Only ids of the event's current tracks; none means the main event.
    trackIds: (submission.trackIds ?? []).filter((id) => byId.has(id)),
    githubUrl: submission.githubUrl ?? null,
    videoUrl: submission.videoUrl ?? null,
    aiSummary: publicAiSummary(submission),
    aiSummaryStatus: aiSummaryStatus(event, submission),
    aiRead: publicAiRead(event, submission, byId, sponsors),
  }));
}

async function judgeEvent(ctx: QueryCtx, slug: string, token: string) {
  const event = await findEventBySlug(ctx, slug);
  if (!event || event.eventType !== "hackathon") throw new ConvexError("Event not found.");
  const access = await judgeAccess(ctx, event._id, token);
  return { event, access };
}

/** True while submissions are reopened after judging started: judges read, but cannot save. */
function judgingPaused(event: Doc<"events">) {
  return event.submissionsClosedAt === undefined;
}

function judgingTimerView(event: Doc<"events">, now: number) {
  return {
    remainingMs: judgingRemaining(event, now),
    serverNow: now,
    running: event.judgingTimerStatus === "running",
    paused: event.judgingTimerStatus === "paused",
  };
}

export const getMyAssignments = query({
  args: { slug: v.string(), capabilityToken: v.string() },
  handler: async (ctx, args) => {
    const { event, access } = await judgeEvent(ctx, args.slug, args.capabilityToken);
    const submissions = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000);
    const assigned = submissions.filter(
      (submission: Doc<"submissions">) =>
        isJudgingSubmission(submission) && isAssignedTo(submission, access.judgeKey),
    );
    const reviews = await ctx.db.query("reviews").withIndex("by_event_and_judge", (q) => q.eq("eventId", event._id).eq("judgeKey", access.judgeKey)).take(1000);
    const reviewBySubmission = new Map(reviews.map((r: Doc<"reviews">) => [r.submissionId, r]));
    const eventTracks = await listEventTracks(ctx, event._id);
    const now = Date.now();
    const judgingStatus = event.judgingStatus ?? "setup";
    const visible = judgingVisible(event);
    const timer = judgingTimerView(event, now);
    return {
      eventName: event.name,
      judgeName: access.judgeName,
      openedAt: access.openedAt ?? null,
      judgingStatus,
      judgingPaused: judgingPaused(event),
      timer: { remainingMs: timer.remainingMs, serverNow: timer.serverNow, running: timer.running },
      trackNames: visible ? eventTracks.map((track) => track.name) : [],
      assignments: visible
        ? (await judgeSubmissionViews(ctx, event, assigned)).map((view) => ({
            ...view,
            review: reviewBySubmission.get(view.id) ?? null,
          }))
        : [],
    };
  },
});

/**
 * Every other submission in judging, so a judge can open any project.
 * A judge may score any of them too; that review counts as their own.
 */
export const getOtherSubmissions = query({
  args: { slug: v.string(), capabilityToken: v.string() },
  handler: async (ctx, args) => {
    const { event, access } = await judgeEvent(ctx, args.slug, args.capabilityToken);
    if (!judgingVisible(event)) return [];
    const submissions = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000);
    const others = submissions.filter(
      (submission) => isJudgingSubmission(submission) && !isAssignedTo(submission, access.judgeKey),
    );
    return await judgeSubmissionViews(ctx, event, others);
  },
});

/** Reviews still needed per project: the target is two complete reviews. */
export const REVIEW_TARGET = 2;

/**
 * Everything the judge page shows, in one query: who the link is for and
 * whether they confirmed it, the timer, the event's tracks with counts, and
 * every project in judging with its tracks, whether it is the judge's own,
 * the judge's review, and how many complete reviews it has.
 *
 * Groups, as the Show select counts them:
 * - yours: assigned to this judge and not fully scored by them yet
 * - helpOut: assigned to other judges, fewer than 2 complete reviews, not
 *   yet fully scored by this judge
 * - scored: fully scored by this judge
 * - all: every project in judging
 */
export const getJudgeWorkspace = query({
  args: { slug: v.string(), capabilityToken: v.string() },
  handler: async (ctx, args) => {
    const { event, access } = await judgeEvent(ctx, args.slug, args.capabilityToken);
    const now = Date.now();
    const visible = judgingVisible(event);
    const eventTracks = await listEventTracks(ctx, event._id);
    const base = {
      eventName: event.name,
      eventSlug: event.slug,
      practice: event.practice === true,
      judgeName: access.judgeName,
      openedAt: access.openedAt ?? null,
      judgingStatus: event.judgingStatus ?? "setup",
      judgingPaused: judgingPaused(event),
      canScore: event.judgingStatus === "open" && !judgingPaused(event),
      timer: judgingTimerView(event, now),
      reviewTarget: REVIEW_TARGET,
    };
    if (!visible) {
      return {
        ...base,
        tracks: eventTracks.map((track) => ({ id: track._id, name: track.name, description: track.description ?? null, count: 0 })),
        mainEventCount: 0,
        counts: { yours: 0, helpOut: 0, scored: 0, all: 0 },
        yoursTotal: 0,
        yoursScored: 0,
        projects: [],
      };
    }
    const [submissions, reviews] = await Promise.all([
      ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000),
      ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(4000),
    ]);
    const judging = submissions.filter(isJudgingSubmission);
    const completeBySubmission = new Map<string, number>();
    const mine = new Map<string, Doc<"reviews">>();
    for (const review of reviews) {
      if (review.completed) completeBySubmission.set(String(review.submissionId), (completeBySubmission.get(String(review.submissionId)) ?? 0) + 1);
      if (review.judgeKey === access.judgeKey) mine.set(String(review.submissionId), review);
    }
    const views = await judgeSubmissionViews(ctx, event, judging);
    const trackCounts = new Map<string, number>();
    let mainEventCount = 0;
    const counts = { yours: 0, helpOut: 0, scored: 0, all: views.length };
    let yoursTotal = 0;
    let yoursScored = 0;
    const projects = views.map((view, index) => {
      const submission = judging[index];
      const assignedToMe = isAssignedTo(submission, access.judgeKey);
      const review = mine.get(String(view.id)) ?? null;
      const scoredByMe = review?.completed === true;
      const completeReviewCount = completeBySubmission.get(String(view.id)) ?? 0;
      const needsReview = completeReviewCount < REVIEW_TARGET;
      const group: "yours" | "helpOut" | "scored" | "other" = scoredByMe
        ? "scored"
        : assignedToMe ? "yours" : needsReview ? "helpOut" : "other";
      if (group === "yours") counts.yours += 1;
      if (group === "helpOut") counts.helpOut += 1;
      if (group === "scored") counts.scored += 1;
      if (assignedToMe) {
        yoursTotal += 1;
        if (scoredByMe) yoursScored += 1;
      }
      for (const id of view.trackIds) trackCounts.set(String(id), (trackCounts.get(String(id)) ?? 0) + 1);
      if (view.trackIds.length === 0) mainEventCount += 1;
      return {
        ...view,
        assignedToMe,
        group,
        completeReviewCount,
        needsReview,
        review: review
          ? { innovation: review.innovation ?? null, execution: review.execution ?? null, demoClarity: review.demoClarity ?? null, completed: review.completed, updatedAt: review.updatedAt }
          : null,
      };
    });
    return {
      ...base,
      tracks: eventTracks.map((track) => ({ id: track._id, name: track.name, description: track.description ?? null, count: trackCounts.get(String(track._id)) ?? 0 })),
      mainEventCount,
      counts,
      yoursTotal,
      yoursScored,
      projects,
    };
  },
});

/**
 * The judge confirmed "Are you <name>?" on their link. The first confirmation
 * is what the Judges page shows as Opened.
 */
export const confirmJudge = mutation({
  args: { slug: v.string(), capabilityToken: v.string() },
  handler: async (ctx, args) => {
    const event = await findEventBySlug(ctx, args.slug);
    if (!event || event.eventType !== "hackathon") throw new ConvexError("Event not found.");
    const access = await judgeAccess(ctx, event._id, args.capabilityToken);
    const openedAt = access.openedAt ?? Date.now();
    if (access.openedAt === undefined) await ctx.db.patch(access._id, { openedAt, updatedAt: openedAt });
    return { judgeName: access.judgeName, openedAt };
  },
});

export const saveReviewArgs = { slug: v.string(), capabilityToken: v.string(), submissionId: v.id("submissions"), innovation: v.optional(v.number()), execution: v.optional(v.number()), demoClarity: v.optional(v.number()) };

/**
 * Saves one judge's scores for one project. Any active judge may score any
 * project in judging; a review on someone else's project counts as the
 * judge's own. Practice test judges come through here too.
 */
export async function saveReviewForJudge(
  ctx: MutationCtx,
  event: Doc<"events">,
  access: Doc<"judgeAccess">,
  args: { submissionId: Doc<"submissions">["_id"]; innovation?: number; execution?: number; demoClarity?: number },
) {
  if (event.judgingStatus !== "open") throw new ConvexError("Judging is not open.");
  if (judgingPaused(event)) throw new ConvexError("Judging is paused while submissions are open again.");
  const submission = await ctx.db.get(args.submissionId);
  if (!submission || submission.eventId !== event._id || !isJudgingSubmission(submission)) throw new ConvexError("This project is not in judging.");
  for (const value of [args.innovation, args.execution, args.demoClarity]) if (value !== undefined && !isJudgingScore(value)) throw new ConvexError("Scores must be whole numbers from 0 to 10.");
  const existing = await ctx.db.query("reviews").withIndex("by_submission_and_judge", (q) => q.eq("submissionId", submission._id).eq("judgeKey", access.judgeKey)).unique();
  const now = Date.now();
  const values = { innovation: args.innovation, execution: args.execution, demoClarity: args.demoClarity, completed: isCompleteReview({ innovation: args.innovation, execution: args.execution, demoClarity: args.demoClarity }), updatedAt: now };
  if (existing) await ctx.db.patch(existing._id, values); else await ctx.db.insert("reviews", { eventId: event._id, submissionId: submission._id, judgeKey: access.judgeKey, ...values, createdAt: now });
  const valuesChanged =
    !existing ||
    existing.completed !== values.completed ||
    existing.innovation !== values.innovation ||
    existing.execution !== values.execution ||
    existing.demoClarity !== values.demoClarity;
  if (valuesChanged && Boolean(existing?.completed || values.completed)) {
    await markScoreBasisChanged(ctx, event, [access.judgeKey], now);
  }
  return { completed: values.completed };
}

/** A contributing score changed: normalization recomputes and stale raw choices fall back. */
async function markScoreBasisChanged(ctx: MutationCtx, event: Doc<"events">, judgeKeys: string[], now = Date.now()) {
  for (const judgeKey of new Set(judgeKeys)) {
    const decision = await ctx.db.query("normalizationDecisions").withIndex("by_event_and_judge", (q) => q.eq("eventId", event._id).eq("judgeKey", judgeKey)).unique();
    if (decision) await ctx.db.patch(decision._id, { stale: true, updatedAt: now });
  }
  await bumpScoreBasis(ctx, event, now);
}

export const saveReview = mutation({
  args: saveReviewArgs,
  handler: async (ctx, args) => {
    const event = await findEventBySlug(ctx, args.slug);
    if (!event || event.judgingStatus !== "open") throw new ConvexError("Judging is not open.");
    const access = await judgeAccess(ctx, event._id, args.capabilityToken);
    return saveReviewForJudge(ctx, event, access, args);
  },
});

export function scoreSubmissions(submissions: Doc<"submissions">[], reviews: Doc<"reviews">[]) {
  const bySubmission = new Map<string, Doc<"reviews">[]>();
  const submissionById = new Map(submissions.map((submission) => [String(submission._id), submission]));
  // Every complete review counts, including a judge helping on someone else's project.
  for (const review of reviews.filter((r) => r.completed)) {
    const submission = submissionById.get(String(review.submissionId));
    if (!submission) continue;
    bySubmission.set(String(review.submissionId), [...(bySubmission.get(String(review.submissionId)) ?? []), review]);
  }
  return submissions.map((submission) => { const complete = bySubmission.get(String(submission._id)) ?? []; const score = complete.length ? complete.reduce((sum, r) => sum + (r.innovation! + r.execution! + r.demoClarity!) / 3, 0) / complete.length : null; return { submissionId: submission._id, demoTitle: submission.demoTitle, presenterName: submission.name, completeReviewCount: complete.length, score, warning: complete.length === 1 ? "Only one complete review" : complete.length === 0 ? "No complete reviews" : null }; });
}

export const getAdminProgressArgs = v.object({ slug: v.string(), });

export async function getAdminProgressForOrganization(
  ctx: QueryCtx,
  args: Infer<typeof getAdminProgressArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  const submissions = (await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000)).filter(isJudgingSubmission);
  const reviews = await ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(2000);
  const directory = await loadJudgeDirectory(ctx, event);
  const eventTracks = await listEventTracks(ctx, event._id);
  const trackById = tracksById(eventTracks);
  const submissionById = new Map(submissions.map((submission) => [String(submission._id), submission]));
  return {
    eventStatus: event.judgingStatus ?? "setup",
    tracks: eventTracks.map((track) => ({ id: track._id, name: track.name })),
    submissionsClosedAt: event.submissionsClosedAt ?? null,
    assignmentVersion: event.assignmentVersion ?? null,
    totalSubmissions: submissions.length,
    scoring: scoreSubmissions(submissions, reviews).map((row) => {
      const submission = submissionById.get(String(row.submissionId))!;
      return {
        ...row,
        teamName: submission.teamName ?? null,
        tracks: trackNamesFor(submission, trackById),
        trackIds: (submission.trackIds ?? []).filter((id) => trackById.has(id)),
        // Names to show; assignedJudgeKeys says who they are.
        assignedJudges: (submission.roundOneAssignedJudges ?? []).map(directory.nameOf),
        assignedJudgeKeys: (submission.roundOneAssignedJudges ?? []).map(judgeKeyOf),
      };
    }),
    reviews: reviews.map((review) => ({
      submissionId: review.submissionId,
      judgeKey: review.judgeKey,
      judgeName: directory.nameOf(review.judgeKey),
      innovation: review.innovation,
      execution: review.execution,
      demoClarity: review.demoClarity,
      completed: review.completed,
      updatedAt: review.updatedAt,
    })),
  };
}

export const getAdminProgress = query({
  args: getAdminProgressArgs,
  handler: async (ctx, args) =>
    getAdminProgressForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setJudgingTimerArgs = v.object({ slug: v.string(), durationMs: v.number() });

/** Sets the judging time. A running timer keeps running from the new time. */
export async function setJudgingTimerForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof setJudgingTimerArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  const durationMs = Math.max(0, Math.min(MAX_TIMER_MS, Math.round(args.durationMs))) || DEFAULT_TIMER_MS;
  const now = Date.now();
  await recordChange(ctx, { event, principal, kind: "judging_timer_set", summary: `set the judging time to ${formatDuration(durationMs)}` }, async () => {
    await ctx.db.patch(event._id, {
      judgingTimerDurationMs: durationMs,
      judgingTimerRemainingMs: durationMs,
      ...(event.judgingTimerStatus === "running" ? { judgingTimerEndsAt: now + durationMs } : {}),
      updatedAt: now,
    });
  });
}

export const setJudgingTimer = mutation({
  args: setJudgingTimerArgs,
  handler: async (ctx, args) =>
    setJudgingTimerForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const setJudgingTimeLeftArgs = v.object({ slug: v.string(), remainingMs: v.number() });

/**
 * Sets exactly how long judging has left, for "click the time and type it"
 * and the 5, 10, 15 and 30 minute presets. Running or paused, the timer keeps
 * its state.
 */
export async function setJudgingTimeLeftForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof setJudgingTimeLeftArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  if (!Number.isFinite(args.remainingMs)) throw new ConvexError("Enter a time.");
  const remainingMs = Math.max(0, Math.min(MAX_TIMER_MS, Math.round(args.remainingMs / 1000) * 1000));
  const now = Date.now();
  await recordChange(ctx, { event, principal, kind: "judging_time_left_set", summary: `set the judging time left to ${formatDuration(remainingMs)}` }, async () => {
    await ctx.db.patch(event._id, {
      judgingTimerRemainingMs: remainingMs,
      ...(event.judgingTimerDurationMs === undefined || event.judgingTimerDurationMs < remainingMs ? { judgingTimerDurationMs: remainingMs } : {}),
      ...(event.judgingTimerStatus === "running" ? { judgingTimerEndsAt: now + remainingMs } : {}),
      updatedAt: now,
    });
  });
  return { remainingMs };
}

export const setJudgingTimeLeft = mutation({
  args: setJudgingTimeLeftArgs,
  handler: async (ctx, args) =>
    setJudgingTimeLeftForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const pauseJudgingTimerArgs = v.object({ slug: v.string() });

export async function pauseJudgingTimerForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof pauseJudgingTimerArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  if (event.judgingTimerStatus !== "running") throw new ConvexError("The judging timer is not running.");
  const now = Date.now();
  await recordChange(ctx, { event, principal, kind: "judging_timer_paused", summary: "paused the judging timer" }, async () => {
    await ctx.db.patch(event._id, {
      judgingTimerStatus: "paused",
      judgingTimerRemainingMs: judgingRemaining(event, now),
      judgingTimerEndsAt: undefined,
      judgingTimerPausedByPhase: undefined,
      updatedAt: now,
    });
  });
}

export const pauseJudgingTimer = mutation({
  args: pauseJudgingTimerArgs,
  handler: async (ctx, args) =>
    pauseJudgingTimerForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const resumeJudgingTimerArgs = v.object({ slug: v.string() });

export async function resumeJudgingTimerForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof resumeJudgingTimerArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  if (event.judgingStatus !== "open") throw new ConvexError("Judging is not open.");
  if (event.submissionsClosedAt === undefined) throw new ConvexError("Close submissions again to carry on judging.");
  if (event.judgingTimerStatus === "running") return;
  const now = Date.now();
  const remaining = judgingRemaining(event, now);
  await recordChange(ctx, { event, principal, kind: "judging_timer_resumed", summary: "resumed the judging timer" }, async () => {
    await ctx.db.patch(event._id, {
      judgingTimerStatus: "running",
      judgingTimerRemainingMs: remaining,
      judgingTimerEndsAt: now + remaining,
      judgingTimerPausedByPhase: undefined,
      updatedAt: now,
    });
  });
}

export const resumeJudgingTimer = mutation({
  args: resumeJudgingTimerArgs,
  handler: async (ctx, args) =>
    resumeJudgingTimerForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const startJudgingArgs = v.object({ slug: v.string(), });

export async function startJudgingForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof startJudgingArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  if (event.judgingStatus !== "ready") throw new ConvexError("Assignments are not ready.");
  if (event.submissionsClosedAt === undefined) throw new ConvexError("Close submissions first.");
  const now = Date.now();
  const remaining = event.judgingTimerRemainingMs ?? event.judgingTimerDurationMs ?? DEFAULT_TIMER_MS;
  await recordChange(ctx, { event, principal, kind: "judging_started", summary: "started judging" }, async () => {
    await ctx.db.patch(event._id, { judgingStatus: "open", phase: "judging", judgingTimerStatus: "running", judgingTimerEndsAt: now + remaining, judgingTimerRemainingMs: remaining, updatedAt: now });
  });
}

export const startJudging = mutation({
  args: startJudgingArgs,
  handler: async (ctx, args) =>
    startJudgingForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const addJudgingTimeArgs = v.object({ slug: v.string(), deltaMs: v.number() });

export async function addJudgingTimeForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof addJudgingTimeArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  const now = Date.now();
  const current = judgingRemaining(event, now);
  const minutes = Math.round(Math.abs(args.deltaMs) / 60000);
  const amount = minutes >= 1 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : formatDuration(Math.abs(args.deltaMs));
  await recordChange(ctx, { event, principal, kind: "judging_time_added", summary: args.deltaMs >= 0 ? `added ${amount}` : `took off ${amount}` }, async () => {
    await ctx.db.patch(event._id, { judgingTimerRemainingMs: current + args.deltaMs, judgingTimerEndsAt: event.judgingTimerStatus === "running" ? now + current + args.deltaMs : event.judgingTimerEndsAt, updatedAt: now });
  });
}

export const addJudgingTime = mutation({
  args: addJudgingTimeArgs,
  handler: async (ctx, args) =>
    addJudgingTimeForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const closeJudgingArgs = v.object({ slug: v.string(), });

export async function closeJudgingForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof closeJudgingArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  if (event.judgingStatus !== "open") throw new ConvexError("Judging is not open.");
  if (event.submissionsClosedAt === undefined) throw new ConvexError("Close submissions first.");
  await recordChange(ctx, {
    event, principal, kind: "phase_changed", summary: "closed judging", undoLabel: "Reopen",
    undo: "phase", fromPhase: eventPhase(event), toPhase: "stage",
  }, () => closeJudgingForEvent(ctx, event));
}

export const closeJudging = mutation({
  args: closeJudgingArgs,
  handler: async (ctx, args) =>
    closeJudgingForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const reopenJudgingArgs = v.object({ slug: v.string(), });

export async function reopenJudgingForOrganization(
  ctx: MutationCtx,
  args: Infer<typeof reopenJudgingArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  if (event.judgingStatus !== "closed") throw new ConvexError("Judging is not closed.");
  await recordChange(ctx, {
    event, principal, kind: "phase_changed", summary: "reopened judging",
    undo: "phase", fromPhase: eventPhase(event), toPhase: "judging",
  }, () => reopenJudgingForEvent(ctx, event));
}

export const reopenJudging = mutation({
  args: reopenJudgingArgs,
  handler: async (ctx, args) =>
    reopenJudgingForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const getJudgingTimerArgs = v.object({ slug: v.string(), });

export async function getJudgingTimerForOrganization(
  ctx: QueryCtx,
  args: Infer<typeof getJudgingTimerArgs>,
  principal: OrganizationPrincipal,
) { const event = await ownedAdminEvent(ctx, args.slug, principal); const now = Date.now(); const remainingMs = event.judgingTimerStatus === "running" && event.judgingTimerEndsAt !== undefined ? event.judgingTimerEndsAt - now : event.judgingTimerRemainingMs ?? event.judgingTimerDurationMs ?? DEFAULT_TIMER_MS; return { status: event.judgingStatus ?? "setup", timerStatus: event.judgingTimerStatus ?? "idle", remainingMs, serverNow: now }; }

export const getJudgingTimer = query({
  args: getJudgingTimerArgs,
  handler: async (ctx, args) =>
    getJudgingTimerForOrganization(ctx, args, await requireOrganization(ctx)),
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
  // A judge helping on another judge's project scores it as themselves, so it counts.
  const completeReviews = reviews.filter((review) => {
    if (!review.completed || !reviewRow(review)) return false;
    return submissionById.has(String(review.submissionId));
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
  args: { slug: v.string(), judgeKey: v.string() },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug);
    const judge = (await loadJudgeDirectory(ctx, event)).get(args.judgeKey);
    if (!judge?.onRoster) throw new ConvexError("Judge not found.");
    const judgeName = judge.name;
    const [submissions, reviews, decisions] = await Promise.all([
      ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000),
      ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(2000),
      ctx.db.query("normalizationDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(100),
    ]);
    const state = normalizationState(submissions, reviews, decisions);
    return {
      ...normalizationPreviewForJudge(args.judgeKey, judgeName, submissions, state),
      scoreBasisReady: state.ready,
      scoreBasisVersion: (await readScoreBasis(ctx, event)).version,
    };
  },
});

export const getNormalizationOverviewArgs = v.object({ slug: v.string(), });

export async function getNormalizationOverviewForOrganization(
  ctx: QueryCtx,
  args: Infer<typeof getNormalizationOverviewArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
  const [submissions, reviews, decisions, directory] = await Promise.all([
    ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000),
    ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(2000),
    ctx.db.query("normalizationDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(100),
    loadJudgeDirectory(ctx, event),
  ]);
  const state = normalizationState(submissions, reviews, decisions);
  const basis = await readScoreBasis(ctx, event);
  return {
    judgingStatus: event.judgingStatus ?? "setup",
    scoreBasisReady: state.ready,
    scoreBasisVersion: basis.version,
    judges: directory.roster.map((judge) => normalizationPreviewForJudge(judge.key, judge.name, submissions, state)),
  };
}

export const getNormalizationOverview = query({
  args: getNormalizationOverviewArgs,
  handler: async (ctx, args) =>
    getNormalizationOverviewForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const saveNormalizationDecisionArgs = v.object({ slug: v.string(), judgeKey: v.string(), decision: v.union(v.literal("apply"), v.literal("raw")) });

async function saveNormalizationDecisionOperation(
  ctx: MutationCtx,
  args: Infer<typeof saveNormalizationDecisionArgs>,
  principal: OrganizationPrincipal,
) {
  const event = await ownedAdminEvent(ctx, args.slug, principal);
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
  const version = (await readScoreBasis(ctx, event)).version;
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
  await confirmScoreBasis(ctx, event, now);
  return { scoreBasisReady: true };
}

export const saveNormalizationDecision = mutation({
  args: saveNormalizationDecisionArgs,
  handler: async (ctx, args) =>
    saveNormalizationDecisionForOrganization(ctx, args, await requireOrganization(ctx)),
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
  args: { slug: v.string(), },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug);
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
      scoreBasisVersion: result.ready ? (await readScoreBasis(ctx, event)).version : null,
      submissions: result.scored,
      finalistIds: decision?.finalistIds ?? [],
      finalistStatus: decision?.finalistStatus ?? "draft",
      finalistVersion: decision?.finalistVersion ?? 0,
      placementIds: decision?.placementIds ?? [],
      placementStatus: decision?.placementStatus ?? "draft",
      placementVersion: decision?.placementVersion ?? 0,
      updatedAt: decision?.updatedAt ?? null,
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
  args: { slug: v.string(), finalistIds: idList },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug);
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
  args: { slug: v.string(), finalistIds: idList },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug);
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
    await confirmScoreBasis(ctx, event, now);
    await ctx.db.patch(event._id, { updatedAt: now });
    // During Stage the lineup follows the finalists; before it, moving to Stage does this.
    if (eventPhase(event) === "stage") await syncFinalistLineup(ctx, event);
  },
});

export const savePlacementDraft = mutation({
  args: { slug: v.string(), placementIds: idList },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug);
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
  args: { slug: v.string(), placementIds: idList },
  handler: async (ctx, args) => {
    const event = await adminEvent(ctx, args.slug);
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

async function judgeNameFor(ctx: MutationCtx, event: Doc<"events">, judgeKey: string) {
  return (await loadJudgeDirectory(ctx, event)).nameOf(judgeKey);
}

/** Turn off: the judge's unscored projects go to others, and their link stops working. Undoable. */
export const applyRedistributionForOrganization = withChange<Infer<typeof applyRedistributionArgs>, Awaited<ReturnType<typeof applyRedistributionOperation>>>(
  async (ctx, args, event) => ({ kind: "judge_turned_off", summary: `turned off ${await judgeNameFor(ctx, event, args.unavailableJudgeKey)} and moved their projects`, watch: { submissions: "all", judgeAccess: "all" } }),
  applyRedistributionOperation,
);

export const saveNormalizationDecisionForOrganization = withChange<Infer<typeof saveNormalizationDecisionArgs>, Awaited<ReturnType<typeof saveNormalizationDecisionOperation>>>(
  async (ctx, args, event) => ({ kind: "normalization_decision", summary: `${args.decision === "raw" ? "used raw scores" : "normalized scores"} for ${await judgeNameFor(ctx, event, args.judgeKey)}`, watch: { normalizationDecisions: "all" } }),
  saveNormalizationDecisionOperation,
);
