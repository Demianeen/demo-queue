import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { visualStyleValidator } from "./visualStyle";

export default defineSchema({
  events: defineTable({
    name: v.string(),
    slug: v.string(),
    eventType: v.optional(v.union(v.literal("demo"), v.literal("hackathon"))),
    visualStyle: v.optional(visualStyleValidator),
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
    submissionsClosedAt: v.optional(v.number()),
    judgingStatus: v.optional(v.union(v.literal("setup"), v.literal("preparing_assignments"), v.literal("ready"), v.literal("open"), v.literal("closed"))),
    judgingTimerDurationMs: v.optional(v.number()),
    judgingTimerRemainingMs: v.optional(v.number()),
    judgingTimerEndsAt: v.optional(v.number()),
    judgingTimerStatus: v.optional(v.union(v.literal("idle"), v.literal("running"), v.literal("paused"))),
    assignmentVersion: v.optional(v.number()),
    assignmentPreparationCursor: v.optional(v.string()),
    assignmentPreparationTotal: v.optional(v.number()),
    confirmedScoreBasisVersion: v.optional(v.number()),
    scoreBasisVersion: v.optional(v.number()),
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
    finalist: v.optional(v.boolean()),
    screenshotId: v.optional(v.id("_storage")),
    videoUrl: v.optional(v.string()),
    // Legacy fields keep existing uploads viewable until their scheduled expiry.
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
    email: v.optional(v.string()),
    whatsappPhone: v.optional(v.string()),
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

  judgeAccess: defineTable({
    eventId: v.id("events"),
    judgeKey: v.string(),
    judgeName: v.string(),
    token: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    deactivatedAt: v.optional(v.number()),
  }).index("by_event", ["eventId"]).index("by_event_and_judge_key", ["eventId", "judgeKey"]).index("by_token", ["token"]),

  reviews: defineTable({
    eventId: v.id("events"),
    submissionId: v.id("submissions"),
    judgeKey: v.string(),
    innovation: v.optional(v.number()),
    execution: v.optional(v.number()),
    demoClarity: v.optional(v.number()),
    completed: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_event", ["eventId"]).index("by_submission", ["submissionId"]).index("by_submission_and_judge", ["submissionId", "judgeKey"]).index("by_event_and_judge", ["eventId", "judgeKey"]),

  normalizationDecisions: defineTable({
    eventId: v.id("events"),
    judgeKey: v.string(),
    decision: v.union(v.literal("apply"), v.literal("raw")),
    scoreBasisVersion: v.number(),
    stale: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_event", ["eventId"]).index("by_event_and_judge", ["eventId", "judgeKey"]),

  judgingDecisions: defineTable({
    eventId: v.id("events"),
    finalistIds: v.array(v.id("submissions")),
    placementIds: v.array(v.id("submissions")),
    finalistVersion: v.number(),
    placementVersion: v.number(),
    finalistStatus: v.union(v.literal("draft"), v.literal("submitted"), v.literal("needs_review")),
    placementStatus: v.union(v.literal("draft"), v.literal("submitted"), v.literal("needs_review")),
    updatedAt: v.number(),
  }).index("by_event", ["eventId"]),
});
