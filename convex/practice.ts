import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { action, internalAction, internalMutation, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { organizationPrincipalValidator, requireOrganization, requireOwnedEvent, type OrganizationPrincipal } from "./organizationAuth";
import { actorUserId, insertChange, recordChange } from "./changeLog";
import {
  PRACTICE_TIDY_AFTER_MS,
  blankEventState,
  createOrganizationEvent,
  deleteSubmissionData,
  saveRoundOneJudgesForOrganization,
  submitDemoForEvent,
  submitHackathonForEvent,
} from "./events";
import { createJudgeAccessForOrganization, saveReviewForJudge } from "./judging";
import { judgingRemaining } from "./phases";
import { listEventTracks } from "./tracks";
import { workosUserEmail } from "./members";
import { eventPhase } from "../lib/event-phase";
import { emailKey, isValidEmail } from "../lib/validation";

/**
 * Practice events: a real event with the practice flag, so it runs exactly
 * the same code. Practice events are listed only here and never count as the
 * live event. Test people go through the real submit form code and the real
 * judge links, and use plus-addresses of the creator's email so every email
 * they trigger arrives in the creator's inbox.
 */

export const MAX_TEST_SUBMISSIONS_PER_CALL = 50;
export const MAX_TEST_JUDGES = 10;
const PRACTICE_LIST_LIMIT = 100;
const TIDY_BATCH = 400;
/** Change rows can be up to 600 KB each, so a tidy pass deletes only a few. */
const TIDY_CHANGE_ROWS = 20;
const DEFAULT_MEET_URL = "https://meet.google.com/";
// Ofcom keeps 020 7946 0000 to 0999 for drama, so these never reach a real phone.
const TEST_PHONE_PREFIX = "+44 20 7946 0";

const startValidator = v.union(
  v.object({ kind: v.literal("copy"), slug: v.string() }),
  v.object({ kind: v.literal("blank"), eventType: v.union(v.literal("demo"), v.literal("hackathon")) }),
);

export const createPracticeEventArgs = v.object({
  expectedOrganizationId: v.string(),
  start: startValidator,
  name: v.optional(v.string()),
  testSubmissions: v.number(),
  testJudges: v.number(),
});

/** A plus-address of the owner's email: ana@example.com becomes ana+dq-practice-7@example.com. */
export function plusAddress(email: string, tag: string) {
  const at = email.lastIndexOf("@");
  if (at <= 0) throw new ConvexError("Your email cannot take a plus-address.");
  const local = email.slice(0, at).split("+")[0];
  return `${local}+${tag}@${email.slice(at + 1)}`;
}

function wholeNumber(value: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new ConvexError(`${label} must be a whole number from 0 to ${max}.`);
  return value;
}

/** Small deterministic generator so test people differ from each other but tests stay stable. */
function seeded(seed: number) {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

const PROJECT_WORDS = ["Guardrail", "Bus Buddy", "SearchLight", "Hanzi Dungeon", "Wild GTMs", "TrySDK", "Inbox Zero", "QuickABTest", "Outpost Radar", "Policy Pilot", "Delay Repay", "Volley Bot"];
const DESCRIPTIONS = [
  "A practice project that turns team notes into a weekly summary with links to every source.",
  "A practice project that checks shell commands from coding agents before they run.",
  "A practice project that finds the next bus home and warns when it is late.",
  "A practice project that turns a spreadsheet into a small web app for the team.",
];

function practiceSlug(name: string, random: () => number) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "event";
  const suffix = Math.floor(random() * 36 ** 5).toString(36).padStart(5, "0");
  return `practice-${base}-${suffix}`.replace(/-+/g, "-");
}

function requirePractice(event: Doc<"events">) {
  if (event.practice !== true) throw new ConvexError("This only works on a practice event.");
}

/**
 * Adds test submissions through the real submit code (with its checks, its
 * confirmation email and, for hackathons, its AI summary), with random
 * tracks (about a third with none) and, for hackathons, random team members.
 */
export async function addPracticeSubmissionsForEvent(ctx: MutationCtx, event: Doc<"events">, count: number) {
  requirePractice(event);
  wholeNumber(count, MAX_TEST_SUBMISSIONS_PER_CALL, "Test submissions");
  if (count === 0) return { submissionIds: [] as Id<"submissions">[] };
  if (event.submissionsClosedAt !== undefined) throw new ConvexError("Submissions are closed. Move back to Submissions to add more.");
  const ownerEmail = event.practiceOwnerEmail;
  if (!ownerEmail || !isValidEmail(ownerEmail)) throw new ConvexError("This practice event has no owner email for test people.");
  const tracks = await listEventTracks(ctx, event._id);
  const start = event.practiceTestPeopleCount ?? 0;
  const submissionIds: Id<"submissions">[] = [];
  let people = start;
  for (let index = 0; index < count; index += 1) {
    const number = start + index + 1;
    const random = seeded(event._creationTime + number);
    const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)];
    const trackIds = random() < 1 / 3 || tracks.length === 0
      ? []
      : tracks.filter(() => random() < 0.5).slice(0, 3).map((track) => track._id);
    const chosenTracks = trackIds.length === 0 && tracks.length > 0 && random() < 0.5 ? [pick(tracks)._id] : trackIds;
    people += 1;
    const person = {
      name: `Test person ${number}`,
      email: plusAddress(ownerEmail, `dq-test-${people}`),
      phone: `${TEST_PHONE_PREFIX}${String(people % 1000).padStart(3, "0")}`,
    };
    const common = {
      slug: event.slug,
      participantToken: crypto.randomUUID(),
      clientId: "practice-tools-0000",
      name: person.name,
      demoTitle: `${pick(PROJECT_WORDS)} ${number}`,
      description: pick(DESCRIPTIONS),
      phone: person.phone,
      email: person.email,
      trackIds: chosenTracks,
    };
    let result: { submissionId?: Id<"submissions"> } | unknown;
    if ((event.eventType ?? "demo") === "hackathon") {
      const memberCount = Math.floor(random() * 4);
      const members = Array.from({ length: memberCount }, (_, member) => {
        people += 1;
        return {
          name: `Test teammate ${number}.${member + 1}`,
          email: plusAddress(ownerEmail, `dq-test-${people}`),
          whatsappPhone: `${TEST_PHONE_PREFIX}${String(people % 1000).padStart(3, "0")}`,
        };
      });
      result = await submitHackathonForEvent(ctx, event, {
        ...common,
        teamName: `Test team ${number}`,
        teamMembers: members.map((member) => member.name),
        teamMemberContacts: members,
        githubUrl: `https://github.com/demo-queue/practice-project-${number}`,
        rulesAccepted: true,
        videoUrl: `https://example.com/practice-video-${number}`,
      }, { practiceTest: true });
    } else {
      result = await submitDemoForEvent(ctx, event, { ...common, queueOrder: 0 }, { practiceTest: true });
    }
    const id = (result as { submissionId?: Id<"submissions"> }).submissionId;
    if (!id) throw new ConvexError("A test person's email was already used. Try again.");
    submissionIds.push(id);
  }
  await ctx.db.patch(event._id, { practiceTestPeopleCount: people, updatedAt: Date.now() });
  return { submissionIds };
}

async function addTestJudges(ctx: MutationCtx, event: Doc<"events">, count: number, principal: OrganizationPrincipal) {
  if (count === 0 || event.eventType !== "hackathon") return [];
  const names = Array.from({ length: count }, (_, index) => `Test judge ${String.fromCharCode(65 + index)}`);
  await saveRoundOneJudgesForOrganization(ctx, { slug: event.slug, judges: names }, principal);
  for (const judgeName of names) {
    await createJudgeAccessForOrganization(ctx, { slug: event.slug, judgeName, capabilityToken: crypto.randomUUID() }, principal);
  }
  return names;
}

/** Creates the practice event once the action has the creator's email. */
export const createPracticeEventForOwner = internalMutation({
  args: { principal: organizationPrincipalValidator, ownerEmail: v.string(), input: createPracticeEventArgs },
  handler: async (ctx, { principal, ownerEmail, input }) => {
    if (input.expectedOrganizationId !== principal.organizationId) throw new ConvexError("Your organization changed. Reload before making a practice event.");
    const testSubmissions = wholeNumber(input.testSubmissions, MAX_TEST_SUBMISSIONS_PER_CALL, "Test submissions");
    const testJudges = wholeNumber(input.testJudges, MAX_TEST_JUDGES, "Test judges");
    if (!isValidEmail(ownerEmail)) throw new ConvexError("Your email cannot take a plus-address.");
    const random = seeded(Date.now());
    let source: Doc<"events"> | null = null;
    if (input.start.kind === "copy") {
      source = (await requireOwnedEvent(ctx, input.start.slug, principal)).event;
      if (source.practice === true) throw new ConvexError("Copy a real event, not another practice event.");
    }
    const eventType = source ? source.eventType ?? "demo" : input.start.kind === "blank" ? input.start.eventType : "demo";
    if (testJudges > 0 && eventType !== "hackathon") throw new ConvexError("A demo night has no judges.");
    if (testJudges === 1) throw new ConvexError("Add at least 2 test judges, or none.");
    const name = (input.name?.trim() || (source ? `Dry run for ${source.name}` : eventType === "hackathon" ? "Practice hackathon" : "Practice demo night")).slice(0, 160);
    const slug = practiceSlug(name, random);
    const tracks = source ? (await listEventTracks(ctx, source._id)).map((track) => ({ name: track.name, description: track.description })) : [];
    const { eventId } = await createOrganizationEvent(ctx, {
      expectedOrganizationId: principal.organizationId,
      name,
      slug,
      eventType,
      visualStyle: source?.visualStyle ?? undefined,
      meetUrl: source?.meetUrl || DEFAULT_MEET_URL,
    }, principal, tracks);
    await ctx.db.patch(eventId, {
      practice: true,
      practiceOwnerActor: principal.actor,
      practiceOwnerEmail: emailKey(ownerEmail),
      practiceCopiedFromEventId: source?._id,
      practiceCopiedFromName: source?.name,
      practiceTestPeopleCount: 0,
      phase: "submissions",
      ...(source
        ? {
            theme: source.theme,
            visualStyle: source.visualStyle,
            judgingTimerDurationMs: source.judgingTimerDurationMs,
            judgingTimerRemainingMs: source.judgingTimerDurationMs,
            stageTimerDurationMs: source.stageTimerDurationMs,
            stageTimerRemainingMs: source.stageTimerDurationMs,
            demoTimerDurationMs: source.demoTimerDurationMs,
            demoTimerRemainingMs: source.demoTimerDurationMs,
            lineupTarget: source.lineupTarget,
            aiSummarySections: source.aiSummarySections,
            showSubmissionCountOnStage: source.showSubmissionCountOnStage,
            showMeetLinkOnStage: source.showMeetLinkOnStage,
          }
        : {}),
      updatedAt: Date.now(),
    });
    let event = (await ctx.db.get(eventId))!;
    const judges = await addTestJudges(ctx, event, testJudges, principal);
    event = (await ctx.db.get(eventId))!;
    const { submissionIds } = await addPracticeSubmissionsForEvent(ctx, event, testSubmissions);
    event = (await ctx.db.get(eventId))!;
    await insertChange(ctx, {
      event, principal, kind: "practice_created", undo: "none",
      summary: source ? `made this practice event from ${source.name}` : "made this practice event",
    }, []);
    return { eventId, slug, judges, submissionCount: submissionIds.length };
  },
});

/**
 * New practice event: a copy of a real event (its tracks, style, judging and
 * stage timers, meet link and summary sections) or a blank hackathon or demo
 * night, filled with test judges and test submissions. An action, because
 * the creator's email comes from WorkOS.
 */
export async function createPracticeEventForOrganization(
  ctx: Pick<ActionCtx, "runMutation">,
  input: Infer<typeof createPracticeEventArgs>,
  principal: OrganizationPrincipal,
): Promise<{ eventId: Id<"events">; slug: string; judges: string[]; submissionCount: number }> {
  const userId = actorUserId(principal.actor);
  if (!userId) throw new ConvexError("Sign in as a person to make a practice event.");
  const ownerEmail = await workosUserEmail(userId);
  return await ctx.runMutation(internal.practice.createPracticeEventForOwner, { principal, ownerEmail, input });
}

export const createPracticeEvent = action({
  args: createPracticeEventArgs,
  handler: async (ctx, input): Promise<{ eventId: Id<"events">; slug: string; judges: string[]; submissionCount: number }> =>
    createPracticeEventForOrganization(ctx, input, await requireOrganization(ctx)),
});

export const createPracticeEventMcp = internalAction({
  args: { principal: organizationPrincipalValidator, input: createPracticeEventArgs },
  handler: async (ctx, { principal, input }): Promise<{ eventId: Id<"events">; slug: string; judges: string[]; submissionCount: number }> =>
    createPracticeEventForOrganization(ctx, input, principal),
});

export const listPracticeEventsArgs = v.object({});

/** Practice events only, newest first. Real events never appear here. */
export async function listPracticeEventsForOrganization(ctx: QueryCtx, _args: Infer<typeof listPracticeEventsArgs>, principal: OrganizationPrincipal) {
  const events = await ctx.db.query("events")
    .withIndex("by_workosOrganizationId_and_practice", (q) => q.eq("workosOrganizationId", principal.organizationId).eq("practice", true))
    .order("desc")
    .take(PRACTICE_LIST_LIMIT);
  return events.map((event) => ({
    id: event._id,
    name: event.name,
    slug: event.slug,
    eventType: event.eventType ?? "demo",
    phase: eventPhase(event),
    copiedFromName: event.practiceCopiedFromName ?? null,
    ownerUserId: event.practiceOwnerActor ? actorUserId(event.practiceOwnerActor) ?? null : null,
    isYours: event.practiceOwnerActor === principal.actor,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    tidiesAwayAt: event.updatedAt + PRACTICE_TIDY_AFTER_MS,
  }));
}

export const listPracticeEvents = query({
  args: listPracticeEventsArgs,
  handler: async (ctx, args) => listPracticeEventsForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const addPracticeSubmissionsArgs = v.object({ slug: v.string(), count: v.number() });

export async function addPracticeSubmissionsForOrganization(ctx: MutationCtx, args: Infer<typeof addPracticeSubmissionsArgs>, principal: OrganizationPrincipal) {
  const { event } = await requireOwnedEvent(ctx, args.slug, principal);
  requirePractice(event);
  return recordChange(ctx, {
    event, principal, kind: "practice_submissions_added", summary: `added ${args.count} test submission${args.count === 1 ? "" : "s"}`,
    watch: { submissions: "all", teamMembers: "all" },
  }, () => addPracticeSubmissionsForEvent(ctx, event, args.count));
}

/** Practice tools: +5, +20, +50 test submissions through the real submit code. */
export const addPracticeSubmissions = mutation({
  args: addPracticeSubmissionsArgs,
  handler: async (ctx, args) => addPracticeSubmissionsForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const scoreAsTestJudgesArgs = v.object({ slug: v.string(), limit: v.optional(v.number()) });

/**
 * Practice tools: each test judge scores their own unscored projects through
 * the real review code, taking turns, up to `limit` reviews (all when left
 * out). Scores are whole numbers between 3 and 9.
 */
export async function scoreAsTestJudgesForOrganization(ctx: MutationCtx, args: Infer<typeof scoreAsTestJudgesArgs>, principal: OrganizationPrincipal) {
  const { event } = await requireOwnedEvent(ctx, args.slug, principal);
  requirePractice(event);
  if (event.judgingStatus !== "open") throw new ConvexError("Start judging first.");
  const limit = args.limit === undefined ? Number.POSITIVE_INFINITY : wholeNumber(args.limit, 1000, "The number to score");
  const [links, submissions, reviews] = await Promise.all([
    ctx.db.query("judgeAccess").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(200),
    ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000),
    ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(4000),
  ]);
  const done = new Set(reviews.filter((review) => review.completed).map((review) => `${review.judgeKey}:${review.submissionId}`));
  const queues = links.filter((link) => link.active).map((link) => ({
    access: link,
    todo: submissions.filter((submission) =>
      (submission.status === "candidate" || submission.status === "queued") &&
      (submission.roundOneAssignedJudges ?? []).some((judge) => judge.normalize("NFKC").trim().toLocaleLowerCase("en") === link.judgeKey) &&
      !done.has(`${link.judgeKey}:${submission._id}`)),
  }));
  return recordChange(ctx, {
    event, principal, kind: "practice_scored", summary: "scored as test judges", watch: { reviews: "all" },
  }, async () => {
    let scored = 0;
    for (let round = 0; scored < limit; round += 1) {
      let any = false;
      for (const queue of queues) {
        const submission = queue.todo[round];
        if (!submission || scored >= limit) continue;
        any = true;
        const random = seeded(submission._creationTime + queue.access._creationTime);
        const value = () => 3 + Math.floor(random() * 7);
        const current = (await ctx.db.get(event._id))!;
        await saveReviewForJudge(ctx, current, queue.access, { submissionId: submission._id, innovation: value(), execution: value(), demoClarity: value() });
        scored += 1;
      }
      if (!any) break;
    }
    const remaining = queues.reduce((sum, queue) => sum + queue.todo.length, 0) - scored;
    return { scored, remaining };
  });
}

export const scoreAsTestJudges = mutation({
  args: scoreAsTestJudgesArgs,
  handler: async (ctx, args) => scoreAsTestJudgesForOrganization(ctx, args, await requireOrganization(ctx)),
});

const timerValidator = v.union(v.literal("judging"), v.literal("stage"), v.literal("demo"));
export const skipTimerToLastSecondsArgs = v.object({ slug: v.string(), timer: v.optional(timerValidator), seconds: v.optional(v.number()) });

/**
 * Practice tools: jumps a running timer to its last seconds (10 by default)
 * so you can see what happens at zero. Without `timer`, the judging timer
 * when it runs, then the stage timer, then the demo timer.
 */
export async function skipTimerToLastSecondsForOrganization(ctx: MutationCtx, args: Infer<typeof skipTimerToLastSecondsArgs>, principal: OrganizationPrincipal) {
  const { event } = await requireOwnedEvent(ctx, args.slug, principal);
  requirePractice(event);
  const seconds = args.seconds === undefined ? 10 : wholeNumber(args.seconds, 600, "Seconds");
  const remainingMs = seconds * 1000;
  const running = {
    judging: event.judgingTimerStatus === "running",
    stage: event.stageTimerStatus === "running",
    demo: event.demoTimerStatus === "running",
  };
  const timer = args.timer ?? (running.judging ? "judging" : running.stage ? "stage" : running.demo ? "demo" : null);
  if (!timer || !running[timer]) throw new ConvexError("Start the timer first.");
  const now = Date.now();
  const patch =
    timer === "judging" ? { judgingTimerRemainingMs: remainingMs, judgingTimerEndsAt: now + remainingMs }
      : timer === "stage" ? { stageTimerRemainingMs: remainingMs, stageTimerEndsAt: now + remainingMs }
        : { demoTimerRemainingMs: remainingMs, demoTimerEndsAt: now + remainingMs };
  await recordChange(ctx, { event, principal, kind: "practice_timer_skipped", summary: `skipped the ${timer} timer to the last ${seconds} seconds` }, async () => {
    await ctx.db.patch(event._id, { ...patch, updatedAt: now });
  });
  return { timer, remainingMs, previousRemainingMs: timer === "judging" ? judgingRemaining(event, now) : null };
}

export const skipTimerToLastSeconds = mutation({
  args: skipTimerToLastSecondsArgs,
  handler: async (ctx, args) => skipTimerToLastSecondsForOrganization(ctx, args, await requireOrganization(ctx)),
});

export const resetPracticeEventArgs = v.object({ slug: v.string(), keepSubmissions: v.optional(v.boolean()) });

/**
 * Reset to the start: back to Submissions with no scores, assignments,
 * lineup or running timers. Test submissions and test judges stay unless
 * keepSubmissions is false. This deletes data, so it cannot be undone.
 */
export async function resetPracticeEventForOrganization(ctx: MutationCtx, args: Infer<typeof resetPracticeEventArgs>, principal: OrganizationPrincipal) {
  const { event } = await requireOwnedEvent(ctx, args.slug, principal);
  requirePractice(event);
  const keep = args.keepSubmissions !== false;
  const now = Date.now();
  for (const table of ["reviews", "normalizationDecisions", "judgingDecisions"] as const) {
    for (const row of await ctx.db.query(table).withIndex("by_event", (q) => q.eq("eventId", event._id)).take(4000)) await ctx.db.delete(row._id);
  }
  const submissions = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", event._id)).take(1000);
  if (keep) {
    for (const submission of submissions) {
      const back = ["queued", "up_next", "current", "done", "no_show"].includes(submission.status);
      await ctx.db.patch(submission._id, {
        roundOneAssignedJudges: undefined,
        finalist: undefined,
        ...(back ? { status: "candidate" as const, queueOrder: undefined } : {}),
        updatedAt: now,
      });
    }
  } else {
    await deleteSubmissionData(ctx, event, submissions);
  }
  await ctx.db.patch(event._id, {
    ...blankEventState(now),
    submissionsClosedAt: undefined,
    judgingStatus: undefined,
    judgingTimerStatus: undefined,
    judgingTimerEndsAt: undefined,
    judgingTimerRemainingMs: event.judgingTimerDurationMs,
    judgingTimerPausedByPhase: undefined,
    assignmentVersion: undefined,
    assignmentPreparationCursor: undefined,
    assignmentPreparationTotal: undefined,
    scoreBasisVersion: (event.scoreBasisVersion ?? 0) + 1,
    confirmedScoreBasisVersion: undefined,
    phase: "submissions",
    finishedAt: undefined,
    stageTimerDurationMs: event.stageTimerDurationMs,
    stageTimerRemainingMs: event.stageTimerDurationMs,
    demoTimerDurationMs: event.demoTimerDurationMs ?? blankEventState(now).demoTimerDurationMs,
    demoTimerRemainingMs: event.demoTimerDurationMs ?? blankEventState(now).demoTimerRemainingMs,
    lineupTarget: event.lineupTarget,
  });
  await insertChange(ctx, { event, principal, kind: "practice_reset", undo: "none", summary: keep ? "reset the practice event to the start" : "reset the practice event and removed its submissions" }, []);
  return { phase: "submissions" as const, keptSubmissions: keep ? submissions.length : 0 };
}

export const resetPracticeEvent = mutation({
  args: resetPracticeEventArgs,
  handler: async (ctx, args) => resetPracticeEventForOrganization(ctx, args, await requireOrganization(ctx)),
});

/**
 * Tidies away practice events 14 days after their last change (Proposed):
 * deletes one event's rows in batches, scheduling itself again until done.
 * Only events with the practice flag are ever touched.
 */
export const tidyPracticeEvents = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number; eventDone: boolean }> => {
    const cutoff = Date.now() - PRACTICE_TIDY_AFTER_MS;
    const event = await ctx.db.query("events").withIndex("by_practice_and_updatedAt", (q) => q.eq("practice", true).lt("updatedAt", cutoff)).first();
    if (!event || event.practice !== true) return { deleted: 0, eventDone: false };
    let budget = TIDY_BATCH;
    let deleted = 0;
    const remove = async (ids: Id<TableNames>[]) => {
      for (const id of ids) {
        await ctx.db.delete(id);
        budget -= 1;
        deleted += 1;
      }
    };
    const eventId = event._id;
    const ids = (rows: { _id: Id<TableNames> }[]) => rows.map((row) => row._id);
    if (budget > 0) await remove(ids(await ctx.db.query("reviews").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(budget)));
    if (budget > 0) await remove(ids(await ctx.db.query("normalizationDecisions").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(budget)));
    if (budget > 0) await remove(ids(await ctx.db.query("judgingDecisions").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(budget)));
    if (budget > 0) await remove(ids(await ctx.db.query("judgeAccess").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(budget)));
    if (budget > 0) {
      const changes = await ctx.db.query("eventChanges").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(Math.min(budget, TIDY_CHANGE_ROWS));
      await remove(ids(changes));
      // A full batch may leave more: finish them in the next pass before deleting the event.
      if (changes.length === TIDY_CHANGE_ROWS) budget = 0;
    }
    if (budget > 0) await remove(ids(await ctx.db.query("auditLog").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(budget)));
    if (budget > 0) await remove(ids(await ctx.db.query("teamMembers").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(budget)));
    if (budget > 0) await remove(ids(await ctx.db.query("eventTracks").withIndex("by_event_and_order", (q) => q.eq("eventId", eventId)).take(budget)));
    if (budget > 0) await remove(ids(await ctx.db.query("lumaGuestLookups").withIndex("by_event_and_email", (q) => q.eq("eventId", eventId)).take(budget)));
    if (budget > 0) await remove(ids(await ctx.db.query("eventSlugAliases").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(budget)));
    if (budget > 0) {
      const submissions = await ctx.db.query("submissions").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(budget);
      for (const row of submissions) {
        if (row.screenshotId) await ctx.storage.delete(row.screenshotId);
        if (row.videoStorageId) await ctx.storage.delete(row.videoStorageId);
      }
      await remove(ids(submissions));
    }
    if (budget > 0) {
      await ctx.db.delete(event._id);
      console.log(JSON.stringify({ event: "practice-tidy", status: "deleted" }));
    }
    // More to do, for this event or the next one.
    await ctx.scheduler.runAfter(0, internal.practice.tidyPracticeEvents, {});
    return { deleted, eventDone: budget > 0 };
  },
});
