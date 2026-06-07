import { ConvexError, v } from "convex/values";
import { DatabaseReader, DatabaseWriter, mutation, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";

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
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    const current = event.queuePublished
      ? submissions.find((submission) => submission.status === "current")
      : null;
    const upNext = event.queuePublished
      ? submissions.find((submission) => submission.status === "up_next") ??
        submissions.filter((submission) => submission.status === "queued").sort(sortQueue)[0]
      : null;

    return {
      event: {
        name: event.name,
        slug: event.slug,
        queuePublished: event.queuePublished,
      },
      current: current ? publicSubmissionFields(current) : null,
      upNext: upNext ? publicSubmissionFields(upNext) : null,
      remainingCount: submissions.filter((submission) => submission.status === "queued").length,
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
      },
      current: submissions.find((submission) => submission.status === "current")
        ? adminSubmissionFields(submissions.find((submission) => submission.status === "current")!)
        : null,
      upNext: submissions.find((submission) => submission.status === "up_next")
        ? adminSubmissionFields(submissions.find((submission) => submission.status === "up_next")!)
        : null,
      queue: submissions
        .filter((submission) => submission.status === "queued")
        .sort(sortQueue)
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

    const mayJoin = submission.status === "up_next" || submission.status === "current";

    return {
      event: {
        name: event.name,
        slug: event.slug,
      },
      submission: {
        ...publicSubmissionFields(submission),
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

    const submissionId = await ctx.db.insert("submissions", {
      eventId: event._id,
      participantToken: args.participantToken,
      name: args.name.trim(),
      demoTitle: args.demoTitle.trim(),
      description: args.description.trim(),
      phone: args.phone.trim(),
      email: args.email?.trim() || undefined,
      twitter: args.twitter?.trim() || undefined,
      linkedin: args.linkedin?.trim() || undefined,
      category: args.category?.trim() || undefined,
      screenshotId: args.screenshotId,
      status: "queued",
      queueOrder: args.queueOrder,
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
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);
    const now = Date.now();

    const submissionId = await ctx.db.insert("submissions", {
      eventId: event._id,
      participantToken: args.participantToken,
      name: args.name.trim(),
      demoTitle: args.demoTitle.trim(),
      description: args.description.trim(),
      phone: args.phone.trim(),
      email: args.email?.trim() || undefined,
      twitter: args.twitter?.trim() || undefined,
      linkedin: args.linkedin?.trim() || undefined,
      category: args.category?.trim() || undefined,
      status: "queued",
      queueOrder: args.queueOrder,
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
      phone: args.phone.trim(),
      email: args.email?.trim() || undefined,
      twitter: args.twitter?.trim() || undefined,
      linkedin: args.linkedin?.trim() || undefined,
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
      name: args.name.trim(),
      demoTitle: args.demoTitle.trim(),
      description: args.description.trim(),
      phone: args.phone.trim(),
      email: args.email?.trim() || undefined,
      twitter: args.twitter?.trim() || undefined,
      linkedin: args.linkedin?.trim() || undefined,
      category: args.category?.trim() || undefined,
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

export const shuffleQueue = mutation({
  args: {
    slug: v.string(),
    adminToken: v.string(),
    orderedIds: v.array(v.id("submissions")),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    for (const [index, submissionId] of args.orderedIds.entries()) {
      const submission = await ctx.db.get(submissionId);
      if (!submission || submission.eventId !== event._id || submission.status !== "queued") {
        continue;
      }
      await ctx.db.patch(submissionId, { queueOrder: index + 1, updatedAt: Date.now() });
    }

    await logAction(ctx, event._id, "queue_reordered", "admin");
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
    queueOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);
    const submission = await ctx.db.get(args.submissionId);

    if (!submission || submission.eventId !== event._id) {
      throw new ConvexError("Submission not found");
    }

    await ctx.db.patch(args.submissionId, {
      status: "queued",
      queueOrder: args.queueOrder,
      updatedAt: Date.now(),
    });
    await logAction(ctx, event._id, "submission_restored", "admin", args.submissionId);
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

export const pickNext = mutation({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    const current = submissions.find((submission) => submission.status === "current");
    const upNext = submissions.find((submission) => submission.status === "up_next");
    const queued = submissions.filter((submission) => submission.status === "queued").sort(sortQueue);

    if (current) {
      await ctx.db.patch(current._id, {
        status: "done",
        queueOrder: undefined,
        updatedAt: Date.now(),
      });
    }

    if (upNext) {
      await ctx.db.patch(upNext._id, {
        status: "current",
        queueOrder: undefined,
        updatedAt: Date.now(),
      });
    } else if (queued[0]) {
      await ctx.db.patch(queued[0]._id, {
        status: "current",
        queueOrder: undefined,
        updatedAt: Date.now(),
      });
      queued.shift();
    }

    const nextQueued = queued.find((submission) => submission.status === "queued");
    if (nextQueued) {
      await ctx.db.patch(nextQueued._id, {
        status: "up_next",
        queueOrder: undefined,
        updatedAt: Date.now(),
      });
    }

    await logAction(ctx, event._id, "pick_next", "admin");
  },
});

export const resetQueue = mutation({
  args: { slug: v.string(), adminToken: v.string() },
  handler: async (ctx, args) => {
    const event = await eventBySlug(ctx, args.slug);
    requireAdmin(event, args.adminToken);

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .collect();

    // Stable draft order: oldest submissions first, then re-numbered 1..N.
    const ordered = [...submissions].sort((a, b) => a.createdAt - b.createdAt);

    let order = 1;
    for (const submission of ordered) {
      await ctx.db.patch(submission._id, {
        status: "queued",
        queueOrder: order,
        updatedAt: Date.now(),
      });
      order += 1;
    }

    await ctx.db.patch(event._id, { queuePublished: false, updatedAt: Date.now() });
    await logAction(ctx, event._id, "queue_reset", "admin");
  },
});
