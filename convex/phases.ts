import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireOrganization, requireOwnedEvent, type OrganizationPrincipal } from "./organizationAuth";
import { aiSummariesConfigured, summaryMode } from "./aiSummaries";
import { recordChange } from "./changeLog";
import { assignRoundOneJudgePair, buildJudgeAssignmentCounts, isValidRoundOneAssignment, judgeKeyOf } from "../lib/judging-assignment";
import {
  EVENT_PHASES,
  PHASE_EFFECT_TEXT,
  PHASE_LABELS,
  eventPhase,
  phaseSteps,
  phasesFor,
  type EventPhase,
  type PhaseEffect,
} from "../lib/event-phase";
import { finalistLineupPlan } from "../lib/finalist-lineup";
import { isJudgedStatus } from "../lib/judged-status";

export const DEFAULT_JUDGING_TIMER_MS = 60 * 60 * 1000;
export const MAX_JUDGING_TIMER_MS = 99 * 60 * 60 * 1000;
export const phaseValidator = v.union(...EVENT_PHASES.map((phase) => v.literal(phase)));

/** Judging statuses that come after assignments were made. */
const ASSIGNED_STATUSES = new Set(["ready", "open", "closed"]);

function isJudgingSubmission(submission: Doc<"submissions">) {
  return isJudgedStatus(submission.status);
}

/** The judging timer's time left now: counting down when running, held when paused or idle. */
export function judgingRemaining(event: Doc<"events">, now: number) {
  return event.judgingTimerStatus === "running" && event.judgingTimerEndsAt !== undefined
    ? event.judgingTimerEndsAt - now
    : event.judgingTimerRemainingMs ?? event.judgingTimerDurationMs ?? DEFAULT_JUDGING_TIMER_MS;
}

/**
 * Gives two judges to every submission in judging that has none, for when
 * submissions reopened after assignments were made. Judges whose link is
 * turned off get none. Bounded like the rest of judging at 1000 submissions.
 */
async function assignNewSubmissions(ctx: MutationCtx, event: Doc<"events">) {
  const links = await ctx.db.query("judgeAccess").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(200);
  const off = new Set(links.filter((link) => !link.active).map((link) => link.judgeKey));
  const roster = (event.roundOneJudges ?? []).filter((reference) => !off.has(judgeKeyOf(reference)));
  if (roster.length < 2) return 0;
  const submissions = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000);
  const counts = buildJudgeAssignmentCounts(submissions.map((submission) => submission.roundOneAssignedJudges));
  let assigned = 0;
  for (const submission of submissions) {
    if (!isJudgingSubmission(submission) || isValidRoundOneAssignment(submission.roundOneAssignedJudges)) continue;
    await ctx.db.patch(submission._id, { roundOneAssignedJudges: assignRoundOneJudgePair(roster, counts), updatedAt: Date.now() });
    assigned += 1;
  }
  if (assigned > 0) await ctx.db.patch(event._id, { assignmentVersion: (event.assignmentVersion ?? 0) + 1 });
  return assigned;
}

async function queueSummaries(ctx: MutationCtx, event: Doc<"events">) {
  // Judges get a short AI summary of each project; this pass also refreshes ones whose README changed.
  // A practice event on sample summaries needs no model key.
  if (aiSummariesConfigured() || summaryMode(event) === "sample") {
    await ctx.scheduler.runAfter(0, internal.aiSummaries.queueEventSummaries, { eventId: event._id, refreshReadme: true });
  } else {
    console.log(JSON.stringify({ event: "ai-summary", status: "skipped", reason: "not_configured" }));
  }
}

/**
 * Closes a hackathon's submissions. The first time, judging starts in setup.
 * After a reopen, judging keeps its state, new projects get judges, and a
 * timer that the reopen paused carries on.
 */
export async function closeSubmissionsForEvent(ctx: MutationCtx, event: Doc<"events">) {
  if (event.submissionsClosedAt !== undefined) return event.judgingStatus ?? "setup";
  const now = Date.now();
  const status = event.judgingStatus ?? "setup";
  const resume = event.judgingTimerPausedByPhase === true && event.judgingTimerStatus === "paused";
  const remaining = judgingRemaining(event, now);
  await ctx.db.patch(event._id, {
    submissionsClosedAt: now,
    judgingStatus: status,
    phase: "judging",
    judgingTimerPausedByPhase: undefined,
    ...(resume ? { judgingTimerStatus: "running" as const, judgingTimerEndsAt: now + remaining, judgingTimerRemainingMs: remaining } : {}),
    updatedAt: now,
  });
  if (ASSIGNED_STATUSES.has(status)) await assignNewSubmissions(ctx, event);
  await queueSummaries(ctx, event);
  return status;
}

/** Opens a hackathon's submit link again. A running judging timer pauses; scores and assignments stay. */
export async function reopenSubmissionsForEvent(ctx: MutationCtx, event: Doc<"events">) {
  if (event.submissionsClosedAt === undefined) return;
  const now = Date.now();
  const running = event.judgingTimerStatus === "running";
  await ctx.db.patch(event._id, {
    submissionsClosedAt: undefined,
    phase: "submissions",
    ...(running
      ? { judgingTimerStatus: "paused" as const, judgingTimerRemainingMs: judgingRemaining(event, now), judgingTimerEndsAt: undefined, judgingTimerPausedByPhase: true }
      : {}),
    updatedAt: now,
  });
}

export async function closeJudgingForEvent(ctx: MutationCtx, event: Doc<"events">) {
  if (event.judgingStatus !== "open") throw new ConvexError("Judging is not open.");
  const now = Date.now();
  await ctx.db.patch(event._id, {
    judgingStatus: "closed",
    phase: "stage",
    judgingTimerStatus: "idle",
    judgingTimerRemainingMs: event.judgingTimerStatus === "running" || event.judgingTimerStatus === "paused" ? judgingRemaining(event, now) : event.judgingTimerRemainingMs ?? 0,
    judgingTimerEndsAt: undefined,
    judgingTimerPausedByPhase: undefined,
    updatedAt: now,
  });
}

/**
 * On a hackathon the stage lineup is the submitted finalists, in pitch order,
 * so the queue's machinery (current presenter, advance, the per-pitch clock,
 * the projector's "Now pitching") runs the final presentations. Runs when the
 * event reaches Stage and whenever finalists are submitted during Stage.
 * Nothing is deleted: see finalistLineupPlan.
 */
export async function syncFinalistLineup(ctx: MutationCtx, event: Doc<"events">) {
  if (event.eventType !== "hackathon") return null;
  const decision = await ctx.db.query("judgingDecisions").withIndex("by_event", (q) => q.eq("eventId", event._id)).unique();
  if (!decision || decision.finalistStatus !== "submitted") return null;
  const submissions = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000);
  const plan = finalistLineupPlan(
    submissions.map((submission) => ({ id: String(submission._id), status: submission.status, queueOrder: submission.queueOrder })),
    decision.finalistIds.map(String),
  );
  const now = Date.now();
  const byId = new Map(submissions.map((submission) => [String(submission._id), submission]));
  // Queued and waiting both hold their emails, so this is only a status and order change.
  for (const update of plan.updates) {
    await ctx.db.patch(byId.get(update.id)!._id, { status: update.status, queueOrder: update.queueOrder, updatedAt: now });
  }
  if (plan.lineup.length > 0 && !event.queuePublished) {
    await ctx.db.patch(event._id, { queuePublished: true, stageScreenMode: "demo", updatedAt: now });
  }
  return plan;
}

export async function reopenJudgingForEvent(ctx: MutationCtx, event: Doc<"events">) {
  if (event.judgingStatus !== "closed") throw new ConvexError("Judging is not closed.");
  const now = Date.now();
  const remaining = event.judgingTimerRemainingMs ?? event.judgingTimerDurationMs ?? DEFAULT_JUDGING_TIMER_MS;
  await ctx.db.patch(event._id, {
    judgingStatus: "open",
    phase: "judging",
    judgingTimerStatus: "running",
    judgingTimerEndsAt: now + remaining,
    updatedAt: now,
  });
}

type Step = { from: EventPhase; to: EventPhase };

/** What one step does, given the event as it will be when the step runs. */
function stepEffects(event: Pick<Doc<"events">, "eventType" | "judgingStatus" | "judgingTimerStatus" | "judgingTimerPausedByPhase" | "queuePublished">, step: Step): PhaseEffect[] {
  const hackathon = event.eventType === "hackathon";
  const { from, to } = step;
  if (hackathon && from === "submissions" && to === "judging") {
    const effects: PhaseEffect[] = ["submissions_close", "ai_summaries_queue"];
    if (ASSIGNED_STATUSES.has(event.judgingStatus ?? "setup")) effects.push("new_projects_assigned");
    if (event.judgingTimerPausedByPhase && event.judgingTimerStatus === "paused") effects.push("judging_timer_resume");
    return effects;
  }
  if (hackathon && from === "judging" && to === "submissions") {
    return [
      "submissions_reopen",
      ...(event.judgingTimerStatus === "running" ? ["judging_timer_pause" as const] : []),
      "scores_kept",
    ];
  }
  if (hackathon && from === "judging" && to === "stage") {
    const judging: PhaseEffect[] = event.judgingStatus === "open" ? ["judging_close"] : event.judgingStatus === "closed" ? [] : ["judging_skipped"];
    // With judging skipped there are no finalists to line up.
    return event.judgingStatus === "open" || event.judgingStatus === "closed" ? [...judging, "finalists_lineup"] : judging;
  }
  if (hackathon && from === "stage" && to === "judging") {
    return event.judgingStatus === "closed" ? ["judging_reopen", "scores_kept"] : [];
  }
  if (!hackathon && from === "submissions" && to === "stage") return event.queuePublished ? [] : ["queue_publish"];
  // Proposed: going back leaves the lineup published, and the confirm says so.
  if (!hackathon && from === "stage" && to === "submissions") return event.queuePublished ? ["lineup_stays_published"] : [];
  if (to === "finished") return ["finish"];
  if (from === "finished") return ["unfinish"];
  return [];
}

/** The state after one step, for previewing a multi-step move. */
function afterStep(event: Doc<"events">, step: Step): Doc<"events"> {
  const hackathon = event.eventType === "hackathon";
  const next = { ...event, phase: step.to };
  if (hackathon && step.from === "submissions" && step.to === "judging") {
    next.submissionsClosedAt = 1;
    next.judgingStatus = event.judgingStatus ?? "setup";
    if (event.judgingTimerPausedByPhase && event.judgingTimerStatus === "paused") next.judgingTimerStatus = "running";
    next.judgingTimerPausedByPhase = undefined;
  } else if (hackathon && step.from === "judging" && step.to === "submissions") {
    next.submissionsClosedAt = undefined;
    if (event.judgingTimerStatus === "running") { next.judgingTimerStatus = "paused"; next.judgingTimerPausedByPhase = true; }
  } else if (hackathon && step.from === "judging" && step.to === "stage" && event.judgingStatus === "open") {
    next.judgingStatus = "closed";
    next.judgingTimerStatus = "idle";
  } else if (hackathon && step.from === "stage" && step.to === "judging" && event.judgingStatus === "closed") {
    next.judgingStatus = "open";
    next.judgingTimerStatus = "running";
  } else if (!hackathon && step.to === "stage") {
    next.queuePublished = true;
  }
  return next;
}

export function planPhaseChange(event: Doc<"events">, to: EventPhase) {
  const from = eventPhase(event);
  if (!phasesFor(event.eventType).includes(to)) {
    throw new ConvexError(event.eventType === "hackathon" ? "This event has no such phase." : "A demo night has no judging phase.");
  }
  const steps = phaseSteps(event.eventType, from, to);
  const effects: PhaseEffect[] = [];
  let state = event;
  for (const step of steps) {
    if (event.eventType === "hackathon" && step.from === "judging" && step.to !== "submissions" && state.judgingStatus === "preparing_assignments") {
      throw new ConvexError("Judges are being assigned. Wait a moment, then try again.");
    }
    for (const effect of stepEffects(state, step)) if (!effects.includes(effect)) effects.push(effect);
    state = afterStep(state, step);
  }
  return { from, to, steps, effects };
}

async function runStep(ctx: MutationCtx, event: Doc<"events">, step: Step) {
  const hackathon = event.eventType === "hackathon";
  const now = Date.now();
  if (hackathon && step.from === "submissions" && step.to === "judging") {
    await closeSubmissionsForEvent(ctx, event);
  } else if (hackathon && step.from === "judging" && step.to === "submissions") {
    await reopenSubmissionsForEvent(ctx, event);
  } else if (hackathon && step.from === "judging" && step.to === "stage") {
    if (event.judgingStatus === "open") await closeJudgingForEvent(ctx, event);
    await syncFinalistLineup(ctx, (await ctx.db.get(event._id)) ?? event);
  } else if (hackathon && step.from === "stage" && step.to === "judging" && event.judgingStatus === "closed") {
    await reopenJudgingForEvent(ctx, event);
  } else if (!hackathon && step.from === "submissions" && step.to === "stage" && !event.queuePublished) {
    await ctx.db.patch(event._id, { queuePublished: true, stageScreenMode: "demo", phase: "stage", updatedAt: now });
  }
  await ctx.db.patch(event._id, {
    phase: step.to,
    ...(step.to === "finished" ? { finishedAt: now } : {}),
    ...(step.from === "finished" ? { finishedAt: undefined } : {}),
    updatedAt: now,
  });
}

/** Moves the event to a phase, one step at a time. Used by setPhase and by undo. */
export async function movePhase(ctx: MutationCtx, event: Doc<"events">, to: EventPhase) {
  const plan = planPhaseChange(event, to);
  for (const step of plan.steps) {
    const current = await ctx.db.get(event._id);
    if (!current) throw new ConvexError("Event not found");
    await runStep(ctx, current, step);
  }
  return plan;
}

function phaseSummary(from: EventPhase, to: EventPhase, eventType: Doc<"events">["eventType"]) {
  if (eventType === "hackathon" && from === "submissions" && to === "judging") return "closed submissions";
  if (eventType === "hackathon" && to === "submissions") return "reopened submissions";
  if (eventType === "hackathon" && from === "judging" && to === "stage") return "closed judging";
  if (eventType === "hackathon" && from === "stage" && to === "judging") return "reopened judging";
  return `moved the event to ${PHASE_LABELS[to]}`;
}

export const setPhaseArgs = v.object({ slug: v.string(), phase: phaseValidator });

export async function setPhaseForOrganization(ctx: MutationCtx, args: Infer<typeof setPhaseArgs>, principal: OrganizationPrincipal) {
  const { event } = await requireOwnedEvent(ctx, args.slug, principal);
  const plan = planPhaseChange(event, args.phase);
  if (plan.steps.length === 0) return { phase: plan.to, effects: [] as PhaseEffect[] };
  await recordChange(ctx, {
    event, principal, kind: "phase_changed", summary: phaseSummary(plan.from, plan.to, event.eventType),
    undo: "phase", fromPhase: plan.from, toPhase: plan.to,
    undoLabel: plan.effects.includes("submissions_close") || plan.effects.includes("judging_close") ? "Reopen" : "Undo",
    watch: { submissions: "all" },
  }, () => movePhase(ctx, event, args.phase));
  return { phase: plan.to, effects: plan.effects };
}

export const setPhase = mutation({
  args: setPhaseArgs,
  handler: async (ctx, args) => setPhaseForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const previewPhaseChangeArgs = setPhaseArgs;

export async function previewPhaseChangeForOrganization(ctx: QueryCtx, args: Infer<typeof previewPhaseChangeArgs>, principal: OrganizationPrincipal) {
  const { event } = await requireOwnedEvent(ctx, args.slug, principal);
  const plan = planPhaseChange(event, args.phase);
  const now = Date.now();
  return {
    from: plan.from,
    to: plan.to,
    direction: plan.steps.length === 0 ? "none" as const : phasesFor(event.eventType).indexOf(plan.to) > phasesFor(event.eventType).indexOf(plan.from) ? "forward" as const : "back" as const,
    // Time left on the judging timer now, for "Judging pauses at 18:42".
    judgingRemainingMs: event.eventType === "hackathon" ? judgingRemaining(event, now) : null,
    effects: plan.effects.map((code) => ({ code, text: PHASE_EFFECT_TEXT[code] })),
  };
}

/** What moving to a phase will do, for the confirm. Moving to the current phase does nothing. */
export const previewPhaseChange = query({
  args: previewPhaseChangeArgs,
  handler: async (ctx, args) => previewPhaseChangeForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const reopenSubmissionsArgs = v.object({ slug: v.string() });

/** Opens a closed hackathon's submit link again. Judging pauses and every score is kept. */
export async function reopenSubmissionsForOrganization(ctx: MutationCtx, args: Infer<typeof reopenSubmissionsArgs>, principal: OrganizationPrincipal) {
  const { event } = await requireOwnedEvent(ctx, args.slug, principal);
  if (event.eventType !== "hackathon") throw new ConvexError("A demo night's submit link is always open.");
  if (event.submissionsClosedAt === undefined) return { phase: eventPhase(event) };
  return setPhaseForOrganization(ctx, { slug: args.slug, phase: "submissions" }, principal);
}

export const reopenSubmissions = mutation({
  args: reopenSubmissionsArgs,
  handler: async (ctx, args) => reopenSubmissionsForOrganization(ctx, args, await requireOrganization(ctx)),
});

/** The phase fields every event payload carries. */
export function phaseFields(event: Doc<"events">) {
  return {
    phase: eventPhase(event),
    phases: phasesFor(event.eventType),
    finishedAt: event.finishedAt ?? null,
    submissionsOpen: event.submissionsClosedAt === undefined,
    // True while submissions are reopened after judging started: judges cannot save scores.
    judgingPaused: event.eventType === "hackathon" && event.submissionsClosedAt === undefined && ASSIGNED_STATUSES.has(event.judgingStatus ?? "setup"),
  };
}
