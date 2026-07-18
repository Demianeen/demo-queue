import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  events: defineTable({
    name: v.string(),
    slug: v.string(),
    eventType: v.optional(v.union(v.literal("demo"), v.literal("hackathon"))),
    meetUrl: v.string(),
    adminToken: v.string(),
    judgingSheetId: v.optional(v.string()),
    judgingSheetUrl: v.optional(v.string()),
    judgingSheetCreatedAt: v.optional(v.number()),
    judgingSheetSyncRevision: v.optional(v.number()),
    judgingSheetSyncedRevision: v.optional(v.number()),
    judgingSheetSyncedAt: v.optional(v.number()),
    judgingSheetSyncError: v.optional(v.string()),
    roundOneJudges: v.optional(v.array(v.string())),
    queuePublished: v.boolean(),
    stageScreenMode: v.optional(v.union(v.literal("qr"), v.literal("demo"))),
    showSubmissionCountOnStage: v.optional(v.boolean()),
    showMeetLinkOnStage: v.optional(v.boolean()),
    lineupTarget: v.optional(v.number()),
    showStageTimerOnStage: v.optional(v.boolean()),
    stageTimerStatus: v.optional(
      v.union(v.literal("idle"), v.literal("running"), v.literal("paused")),
    ),
    stageTimerDurationMs: v.optional(v.number()),
    stageTimerRemainingMs: v.optional(v.number()),
    stageTimerEndsAt: v.optional(v.number()),
    showDemoTimerOnStage: v.optional(v.boolean()),
    demoTimerStatus: v.optional(
      v.union(v.literal("idle"), v.literal("running"), v.literal("paused")),
    ),
    demoTimerDurationMs: v.optional(v.number()),
    demoTimerRemainingMs: v.optional(v.number()),
    demoTimerEndsAt: v.optional(v.number()),
    lastAdvanceSnapshot: v.optional(
      v.object({
        createdAt: v.number(),
        currentSubmissionId: v.id("submissions"),
        currentQueueOrder: v.optional(v.number()),
        demoTimerStatus: v.union(v.literal("idle"), v.literal("running"), v.literal("paused")),
        demoTimerDurationMs: v.number(),
        demoTimerRemainingMs: v.number(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  submissions: defineTable({
    eventId: v.id("events"),
    participantToken: v.string(),
    name: v.string(),
    demoTitle: v.string(),
    description: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    twitter: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    category: v.optional(v.string()),
    teamName: v.optional(v.string()),
    githubUrl: v.optional(v.string()),
    rulesAcceptedAt: v.optional(v.number()),
    roundOneAssignedJudges: v.optional(v.array(v.string())),
    screenshotId: v.optional(v.id("_storage")),
    videoStorageId: v.optional(v.id("_storage")),
    videoUploadedAt: v.optional(v.number()),
    videoDeleteAt: v.optional(v.number()),
    videoDeletedAt: v.optional(v.number()),
    status: v.union(
      v.literal("candidate"),
      v.literal("queued"),
      v.literal("hidden"),
      v.literal("up_next"),
      v.literal("current"),
      v.literal("done"),
      v.literal("no_show"),
      v.literal("withdrawn"),
    ),
    queueOrder: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_event_status", ["eventId", "status"])
    .index("by_participant_token", ["participantToken"])
    .index("by_screenshot_id", ["screenshotId"])
    .index("by_video_delete_at", ["videoDeleteAt"])
    .index("by_video_storage_id", ["videoStorageId"]),

  teamMembers: defineTable({
    eventId: v.id("events"),
    submissionId: v.id("submissions"),
    name: v.string(),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_submission", ["submissionId"]),

  auditLog: defineTable({
    eventId: v.id("events"),
    action: v.string(),
    actor: v.string(),
    details: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_event", ["eventId"]),
});
