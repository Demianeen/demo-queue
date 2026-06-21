import { ConvexError, v } from "convex/values";
import { DatabaseReader, DatabaseWriter, mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  SUBMISSION_FIELD_LABELS,
  SUBMISSION_FIELD_LIMITS,
  type SubmissionFieldName,
} from "../lib/validation";

const STAGE_LINEUP_LIMIT = 10;
const DEFAULT_STAGE_TIMER_MS = 5 * 60 * 1000;
const MIN_STAGE_TIMER_DURATION_MS = 60 * 1000;
const MAX_STAGE_TIMER_MS = 99 * 60 * 1000;
const MIN_STAGE_TIMER_MS = 0;
const MIN_OVERTIME_TIMER_MS = -MAX_STAGE_TIMER_MS;
type PublicStageTimerStatus = "idle" | "running" | "paused";

const publicSubmissionFields = (submission: Doc<"submissions">) => ({
  id: submission._id,
  name: submission.name,
  demoTitle: submission.demoTitle,
  description: submission.description,
  category: submission.category,
  status: submission.status,
  queueOrder: submission.queueOrder,
});

const adminSubmissionFields = (submission: Doc<"submissions">) => ({
  ...publicSubmissionFields(submission),
  phone: submission.phone,
  email: submission.email,
  twitter: submission.twitter,
  linkedin: submission.linkedin,
  participantToken: submission.participantToken,
  screenshotId: submission.screenshotId,
  createdAt: submission.createdAt,
  updatedAt: submission.updatedAt,
});

async function eventBySlug(ctx: { db: DatabaseReader }, slug: string) {
  const event = await ctx.db
    .query("events")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();

  if (!event) {
    throw new ConvexError("Event not found");
  }

  return event;
}

function requireAdmin(event: Doc<"events">, adminToken: string) {
  if (event.adminToken !== adminToken) {
    throw new ConvexError("Unauthorized");
  }
}

function sortQueue(a: Doc<"submissions">, b: Doc<"submissions">) {
  return (a.queueOrder ?? Number.MAX_SAFE_INTEGER) - (b.queueOrder ?? Number.MAX_SAFE_INTEGER);
}

// The lineup is the ordered running order: every "queued" submission, sorted by
// queueOrder. Position 0 is "now demoing" (current), position 1 is "up next".
function lineupSorted(submissions: Doc<"submissions">[]) {
  return submissions.filter((submission) => submission.status === "queued").sort(sortQueue);
}

function clampTimerMs(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_STAGE_TIMER_MS;
  }

  return Math.max(MIN_STAGE_TIMER_MS, Math.min(MAX_STAGE_TIMER_MS, Math.round(value)));
}

function clampSignedTimerMs(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_STAGE_TIMER_MS;
  }

  return Math.max(MIN_OVERTIME_TIMER_MS, Math.min(MAX_STAGE_TIMER_MS, Math.round(value)));
}

function stageTimerDuration(event: Doc<"events">) {
  return clampTimerDurationMs(event.stageTimerDurationMs ?? DEFAULT_STAGE_TIMER_MS);
}

function clampTimerDurationMs(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_STAGE_TIMER_MS;
  }

  return Math.max(
    MIN_STAGE_TIMER_DURATION_MS,
    Math.min(MAX_STAGE_TIMER_MS, Math.round(value)),
  );
}

function currentStageTimerRemaining(event: Doc<"events">, now: number) {
  const durationMs = stageTimerDuration(event);

  if (event.stageTimerStatus === "running" && event.stageTimerEndsAt !== undefined) {
    return clampSignedTimerMs(event.stageTimerEndsAt - now);
  }

  return event.stageTimerStatus === "paused"
    ? clampSignedTimerMs(event.stageTimerRemainingMs ?? durationMs)
    : clampTimerMs(event.stageTimerRemainingMs ?? durationMs);
}

function publicStageTimer(event: Doc<"events">, now = Date.now()) {
  const durationMs = stageTimerDuration(event);
  const remainingMs = currentStageTimerRemaining(event, now);
  const status: PublicStageTimerStatus = event.stageTimerStatus ?? "idle";

  return {
    status,
    durationMs,
    remainingMs,
    endsAt: event.stageTimerStatus === "running" ? event.stageTimerEndsAt : undefined,
    serverNow: now,
  };
}

async function logAction(
  ctx: { db: DatabaseWriter },
  eventId: Id<"events">,
  action: string,
  actor: string,
  details?: string,
) {
  await ctx.db.insert("auditLog", {
    eventId,
    action,
    actor,
    details,
    createdAt: Date.now(),
  });
}

type SubmissionTextArgs = {
  name: string;
  demoTitle: string;
  description: string;
  phone: string;
  email?: string;
  twitter?: string;
  linkedin?: string;
  category?: string;
};

function limitedText(field: SubmissionFieldName, value: string) {
  const trimmed = value.trim();
  const limit = SUBMISSION_FIELD_LIMITS[field];

  if (trimmed.length > limit) {
    throw new ConvexError(`${SUBMISSION_FIELD_LABELS[field]} must be ${limit} characters or fewer.`);
  }

  return trimmed;
}

function optionalLimitedText(field: SubmissionFieldName, value: string | undefined) {
  if (value === undefined) return undefined;
  return limitedText(field, value) || undefined;
}

function normalizeSubmissionTextFields(args: SubmissionTextArgs) {
  return {
    name: limitedText("name", args.name),
    demoTitle: limitedText("demoTitle", args.demoTitle),
    description: limitedText("description", args.description),
    phone: limitedText("phone", args.phone),
    email: optionalLimitedText("email", args.email),
    twitter: optionalLimitedText("twitter", args.twitter),
    linkedin: optionalLimitedText("linkedin", args.linkedin),
    category: optionalLimitedText("category", args.category),
  };
}

function normalizeContactTextFields(args: Pick<SubmissionTextArgs, "phone" | "email" | "twitter" | "linkedin">) {
  return {
    phone: limitedText("phone", args.phone),
    email: optionalLimitedText("email", args.email),
    twitter: optionalLimitedText("twitter", args.twitter),
    linkedin: optionalLimitedText("linkedin", args.linkedin),
  };
}

export const createEvent = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    meetUrl: v.string(),
    adminToken: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("events")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (existing) {
      throw new ConvexError("That event slug already exists");
    }

    const now = Date.now();
    const eventId = await ctx.db.insert("events", {
      name: args.name.trim(),
      slug: args.slug,
      meetUrl: args.meetUrl.trim(),
      adminToken: args.adminToken,
      queuePublished: false,
      showMeetLinkOnStage: false,
      createdAt: now,
      updatedAt: now,
    });

    await logAction(ctx, eventId, "event_created", "admin");
    return { eventId };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const getStage = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const event = await eventBySlug(ctx, slug);
    const now = Date.now();
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    const lineup = lineupSorted(submissions);
    const activeSubmissionCount = submissions.filter(
      (submission) => submission.status === "queued" || submission.status === "candidate",
    ).length;
    const stageLineup = event.queuePublished ? lineup.slice(0, STAGE_LINEUP_LIMIT) : [];
    const current = stageLineup[0] ?? null;
    const upNext = stageLineup[1] ?? null;
    const showMeetLinkOnStage = event.showMeetLinkOnStage ?? false;

    return {
      event: {
        name: event.name,
        slug: event.slug,
        queuePublished: event.queuePublished,
        showMeetLinkOnStage,
      },
      stageTimer: publicStageTimer(event, now),
      current: current ? publicSubmissionFields(current) : null,
      upNext: upNext ? publicSubmissionFields(upNext) : null,
      lineup: stageLineup.map(publicSubmissionFields),
      remainingCount: lineup.length,
      waitingCount: activeSubmissionCount,
      meetUrl: event.queuePublished && showMeetLinkOnStage ? event.meetUrl : null,
    };
  },
});

export const getAdmin = query({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, { slug, adminToken }) => {
    const event = await eventBySlug(ctx, slug);
    requireAdmin(event, adminToken);

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    return {
      event: {
        id: event._id,
        name: event.name,
        slug: event.slug,
        meetUrl: event.meetUrl,
        queuePublished: event.queuePublished,
        showMeetLinkOnStage: event.showMeetLinkOnStage ?? false,
        lineupTarget: event.lineupTarget,
        stageTimer: publicStageTimer(event),
      },
      lineup: lineupSorted(submissions).map(adminSubmissionFields),
      pool: submissions
        .filter((submission) => submission.status === "candidate")
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(adminSubmissionFields),
      hidden: submissions
        .filter((submission) => submission.status === "hidden")
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(adminSubmissionFields),
      inactive: submissions
        .filter((submission) =>
          ["done", "no_show", "withdrawn"].includes(submission.status),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(adminSubmissionFields),
    };
  },
});

export const getParticipant = query({
  args: { slug: v.string(), participantToken: v.string() },
  handler: async (ctx, { slug, participantToken }) => {
    const event = await eventBySlug(ctx, slug);
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_participant_token", (q) => q.eq("participantToken", participantToken))
      .unique();

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    // Current/up-next are positional: index 0 and 1 of the published lineup.
    const allSubmissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const lineup = lineupSorted(allSubmissions);
    const lineupIndex = lineup.findIndex((entry) => entry._id === submission._id);

    let liveStatus = submission.status as string;
    if (lineupIndex === 0) {
      liveStatus = "current";
    } else if (lineupIndex === 1) {
      liveStatus = "up_next";
    } else if (lineupIndex > 1) {
      liveStatus = "queued";
    }

    // Anyone in the published lineup can see the Meet link (lineupIndex >= 0),
    // not just the current/up-next speakers. Pool/candidate entries (index -1)
    // still don't get it until they're added to the lineup.
    const mayJoin = event.queuePublished && lineupIndex >= 0;

    return {
      event: {
        name: event.name,
        slug: event.slug,
      },
      submission: {
        ...publicSubmissionFields(submission),
        status: liveStatus,
        phone: submission.phone,
        email: submission.email,
        twitter: submission.twitter,
        linkedin: submission.linkedin,
        createdAt: submission.createdAt,
      },
      meetUrl: mayJoin ? event.meetUrl : null,
    };
  },
});

export const submitDemo = mutation({
  args: {
    slug: v.string(),
    participantToken: v.string(),
    name: v.string(),
    demoTitle: v.string(),
    description: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    twitter: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    category: v.optional(v.string()),
    screenshotId: v.optional(v.id("_storage")),
    queueOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    const now = Date.now();
    const fields = normalizeSubmissionTextFields(args);

    const submissionId = await ctx.db.insert("submissions", {
      eventId: event._id,
      participantToken: args.participantToken,
      ...fields,
      screenshotId: args.screenshotId,
      // New submissions land in the pool ("all people"); the admin drags chosen
      // people into the lineup.
      status: "candidate",
      queueOrder: undefined,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(event._id, { updatedAt: now });
    await logAction(ctx, event._id, "submission_created", "participant", submissionId);
    return { submissionId };
  },
});

export const adminAddSubmission = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    participantToken: v.string(),
    name: v.string(),
    demoTitle: v.string(),
    description: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    twitter: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    category: v.optional(v.string()),
    queueOrder: v.number(),
    list: v.optional(v.union(v.literal("lineup"), v.literal("pool"))),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);
    const now = Date.now();
    const toPool = args.list === "pool";
    const fields = normalizeSubmissionTextFields(args);

    const submissionId = await ctx.db.insert("submissions", {
      eventId: event._id,
      participantToken: args.participantToken,
      ...fields,
      status: toPool ? "candidate" : "queued",
      queueOrder: toPool ? undefined : args.queueOrder,
      createdAt: now,
      updatedAt: now,
    });

    await logAction(ctx, event._id, "submission_admin_added", "admin", submissionId);
    return { submissionId };
  },
});

export const editParticipantContact = mutation({
  args: {
    slug: v.string(),
    participantToken: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    twitter: v.optional(v.string()),
    linkedin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_participant_token", (q) => q.eq("participantToken", args.participantToken))
      .unique();

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    await ctx.db.patch(submission._id, {
      ...normalizeContactTextFields(args),
      updatedAt: Date.now(),
    });
  },
});

export const withdrawSubmission = mutation({
  args: { slug: v.string(), participantToken: v.string() },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_participant_token", (q) => q.eq("participantToken", args.participantToken))
      .unique();

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    await ctx.db.patch(submission._id, { status: "withdrawn", updatedAt: Date.now() });
    await logAction(ctx, event._id, "submission_withdrawn", "participant", submission._id);
  },
});

export const updateEvent = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    name: v.string(),
    meetUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    await ctx.db.patch(event._id, {
      name: args.name.trim(),
      meetUrl: args.meetUrl.trim(),
      updatedAt: Date.now(),
    });
  },
});

export const updateSubmission = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    submissionId: v.id("submissions"),
    name: v.string(),
    demoTitle: v.string(),
    description: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    twitter: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);
    const submission = await ctx.db.get(args.submissionId);

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    await ctx.db.patch(args.submissionId, {
      ...normalizeSubmissionTextFields(args),
      updatedAt: Date.now(),
    });
  },
});

export const publishQueue = mutation({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    await ctx.db.patch(event._id, { queuePublished: true, updatedAt: Date.now() });
    await logAction(ctx, event._id, "queue_published", "admin");
  },
});

export const setStageMeetLinkVisible = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    visible: v.boolean(),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    if (args.visible && !event.queuePublished) {
      throw new ConvexError("Publish the queue before showing the Meet link on stage");
    }

    await ctx.db.patch(event._id, {
      showMeetLinkOnStage: args.visible,
      updatedAt: Date.now(),
    });
    await logAction(
      ctx,
      event._id,
      args.visible ? "stage_meet_link_enabled" : "stage_meet_link_disabled",
      "admin",
    );
  },
});

export const startStageTimer = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    const now = Date.now();
    const durationMs = clampTimerDurationMs(args.durationMs ?? stageTimerDuration(event));
    const currentRemainingMs = currentStageTimerRemaining(event, now);
    const remainingMs =
      event.stageTimerStatus === "paused" && currentRemainingMs > 0
        ? currentRemainingMs
        : durationMs;

    await ctx.db.patch(event._id, {
      stageTimerStatus: "running",
      stageTimerDurationMs: durationMs,
      stageTimerRemainingMs: remainingMs,
      stageTimerEndsAt: now + remainingMs,
      updatedAt: now,
    });
    await logAction(ctx, event._id, "stage_timer_started", "admin", String(remainingMs));
  },
});

export const pauseStageTimer = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    const now = Date.now();
    const remainingMs = currentStageTimerRemaining(event, now);

    await ctx.db.patch(event._id, {
      stageTimerStatus: "paused",
      stageTimerRemainingMs: remainingMs,
      stageTimerEndsAt: undefined,
      updatedAt: now,
    });
    await logAction(ctx, event._id, "stage_timer_paused", "admin", String(remainingMs));
  },
});

export const resetStageTimer = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    const now = Date.now();
    const durationMs = clampTimerDurationMs(args.durationMs ?? stageTimerDuration(event));

    await ctx.db.patch(event._id, {
      stageTimerStatus: "idle",
      stageTimerDurationMs: durationMs,
      stageTimerRemainingMs: durationMs,
      stageTimerEndsAt: undefined,
      updatedAt: now,
    });
    await logAction(ctx, event._id, "stage_timer_reset", "admin", String(durationMs));
  },
});

export const adjustStageTimer = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    deltaMs: v.number(),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    const now = Date.now();
    const isRunning = event.stageTimerStatus === "running";
    const nextRemainingMs = currentStageTimerRemaining(event, now) + args.deltaMs;
    const remainingMs = isRunning ? clampSignedTimerMs(nextRemainingMs) : clampTimerMs(nextRemainingMs);

    await ctx.db.patch(event._id, {
      stageTimerStatus: isRunning ? "running" : event.stageTimerStatus ?? "idle",
      stageTimerRemainingMs: remainingMs,
      stageTimerEndsAt: isRunning ? now + remainingMs : undefined,
      updatedAt: now,
    });
    await logAction(ctx, event._id, "stage_timer_adjusted", "admin", String(args.deltaMs));
  },
});

export const hideSubmission = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    submissionId: v.id("submissions"),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);
    const submission = await ctx.db.get(args.submissionId);

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    await ctx.db.patch(args.submissionId, {
      status: "hidden",
      queueOrder: undefined,
      updatedAt: Date.now(),
    });
    await logAction(ctx, event._id, "submission_hidden", "admin", args.submissionId);
  },
});

export const restoreSubmission = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    submissionId: v.id("submissions"),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);
    const submission = await ctx.db.get(args.submissionId);

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    // Restoring a hidden person returns them to the pool, not straight into the
    // lineup; the admin drags them into the running order if they want them.
    await ctx.db.patch(args.submissionId, {
      status: "candidate",
      queueOrder: undefined,
      updatedAt: Date.now(),
    });
    await logAction(ctx, event._id, "submission_restored", "admin", args.submissionId);
  },
});

// Reorders the lineup AND pulls in any pool/hidden person whose id appears in
// orderedIds (used for both intra-lineup drag and pool -> lineup drops). Every
// listed id becomes "queued" with queueOrder set to its position.
export const reorderLineup = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    orderedIds: v.array(v.id("submissions")),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);
    const now = Date.now();

    for (const [index, submissionId] of args.orderedIds.entries()) {
      const submission = await ctx.db.get(submissionId);
      if (
        !submission ||
        submission.eventId !== event._id ||
        ["done", "no_show", "withdrawn"].includes(submission.status)
      ) {
        continue;
      }
      await ctx.db.patch(submissionId, {
        status: "queued",
        queueOrder: index + 1,
        updatedAt: now,
      });
    }

    await logAction(ctx, event._id, "lineup_reordered", "admin");
  },
});

// Repopulate the lineup with a random draw from everyone currently in the lineup
// or the pool, honoring the lineup target. Everyone not drawn goes to the pool.
export const shuffleLineup = mutation({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    const eligible = submissions.filter(
      (s) => s.status === "queued" || s.status === "candidate",
    );

    // Fisher-Yates. Convex seeds Math.random per mutation, so retries are stable.
    for (let i = eligible.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }

    const target =
      event.lineupTarget && event.lineupTarget > 0
        ? Math.min(event.lineupTarget, eligible.length)
        : eligible.length;

    const now = Date.now();
    for (let i = 0; i < eligible.length; i += 1) {
      const inLineup = i < target;
      await ctx.db.patch(eligible[i]._id, {
        status: inLineup ? "queued" : "candidate",
        queueOrder: inLineup ? i + 1 : undefined,
        updatedAt: now,
      });
    }

    await logAction(ctx, event._id, "lineup_shuffled", "admin");
  },
});

// Apply an explicit lineup order (e.g. from the AI shuffle): the given ids
// become the lineup in that order; every other eligible person goes to the pool.
export const setLineupOrder = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    orderedIds: v.array(v.id("submissions")),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();
    const eligibleIds = new Set(
      submissions
        .filter((s) => s.status === "queued" || s.status === "candidate")
        .map((s) => s._id),
    );

    const now = Date.now();
    const placed = new Set<string>();
    let order = 1;
    for (const id of args.orderedIds) {
      if (!eligibleIds.has(id) || placed.has(id)) continue;
      await ctx.db.patch(id, { status: "queued", queueOrder: order, updatedAt: now });
      placed.add(id);
      order += 1;
    }
    for (const id of eligibleIds) {
      if (!placed.has(id)) {
        await ctx.db.patch(id, { status: "candidate", queueOrder: undefined, updatedAt: now });
      }
    }

    await logAction(ctx, event._id, "lineup_ai_ordered", "admin");
  },
});

// Pulls a person out of the lineup back into the pool ("all people").
export const moveToPool = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    submissionId: v.id("submissions"),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);
    const submission = await ctx.db.get(args.submissionId);

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    await ctx.db.patch(args.submissionId, {
      status: "candidate",
      queueOrder: undefined,
      updatedAt: Date.now(),
    });
    await logAction(ctx, event._id, "submission_to_pool", "admin", args.submissionId);
  },
});

export const setLineupTarget = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    target: v.number(),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    const clamped = Math.max(0, Math.min(99, Math.round(args.target)));
    await ctx.db.patch(event._id, { lineupTarget: clamped, updatedAt: Date.now() });
  },
});

export const markNoShow = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    submissionId: v.id("submissions"),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);
    const submission = await ctx.db.get(args.submissionId);

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    await ctx.db.patch(args.submissionId, {
      status: "no_show",
      queueOrder: undefined,
      updatedAt: Date.now(),
    });
    await logAction(ctx, event._id, "submission_no_show", "admin", args.submissionId);
  },
});

// Advance the show: the person at the top of the lineup (current) is marked
// done, so the next person becomes position 0. Order is positional, so nothing
// else needs to move.
export const pickNext = mutation({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);
    if (!event.queuePublished) {
      return;
    }

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    const lineup = lineupSorted(submissions);
    const current = lineup[0];
    if (!current) {
      return;
    }

    await ctx.db.patch(current._id, {
      status: "done",
      queueOrder: undefined,
      updatedAt: Date.now(),
    });

    await logAction(ctx, event._id, "pick_next", "admin");
  },
});

export const skipCurrent = mutation({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);
    if (!event.queuePublished) {
      return;
    }

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    const lineup = lineupSorted(submissions);
    const current = lineup[0];
    if (!current || lineup.length < 2) {
      return;
    }

    const lastQueueOrder = lineup.reduce(
      (max, submission) => Math.max(max, submission.queueOrder ?? 0),
      0,
    );

    await ctx.db.patch(current._id, {
      queueOrder: lastQueueOrder + 1,
      updatedAt: Date.now(),
    });

    await logAction(ctx, event._id, "current_skipped", "admin", current._id);
  },
});

export const clearQueue = mutation({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    // Permanently remove every submission and any uploaded screenshot blob,
    // returning the event to its blank, pre-publish state.
    for (const submission of submissions) {
      if (submission.screenshotId) {
        await ctx.storage.delete(submission.screenshotId);
      }
      await ctx.db.delete(submission._id);
    }

    await ctx.db.patch(event._id, {
      queuePublished: false,
      showMeetLinkOnStage: false,
      updatedAt: Date.now(),
    });
    await logAction(ctx, event._id, "queue_cleared", "admin");
  },
});
