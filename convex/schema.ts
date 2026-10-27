import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { eventThemeValidator } from "./eventTheme";
import { visualStyleValidator } from "./visualStyle";

/** Where each social came from: typed by the team, or imported from Luma. */
const socialSource = v.union(v.literal("typed"), v.literal("luma"));
export const socialSourcesValidator = v.object({
  twitter: v.optional(socialSource),
  linkedin: v.optional(socialSource),
  githubProfile: v.optional(socialSource),
});

export default defineSchema({
  mcpApprovals: defineTable({
    ownerAccountKey: v.string(), workosUserId: v.string(), actor: v.string(),
    source: v.union(v.literal("oauth"), v.literal("device"), v.literal("apiKey")),
    name: v.string(), access: v.union(v.literal("read"), v.literal("manage")),
    requestId: v.optional(v.string()), requestedScopes: v.array(v.string()), approvedScopes: v.array(v.string()),
    revokedAt: v.optional(v.number()),
    allOrganizations: v.optional(v.literal(true)),
  }).index("by_ownerAccountKey", ["ownerAccountKey"]),
  mcpApprovalOrganizations: defineTable({
    approvalId: v.id("mcpApprovals"), organizationId: v.string(),
  }).index("by_approvalId_and_organizationId", ["approvalId", "organizationId"]),
  eventSlugAliases: defineTable({
    slug: v.string(),
    eventId: v.id("events"),
  }).index("by_slug", ["slug"]),
  organizationStyles: defineTable({
    organizationId: v.string(), name: v.string(), theme: eventThemeValidator,
    preset: v.optional(visualStyleValidator),
    isDefault: v.boolean(), updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),
  events: defineTable({
    name: v.string(),
    workosOrganizationId: v.optional(v.string()),
    slug: v.string(),
    eventType: v.optional(v.union(v.literal("demo"), v.literal("hackathon"))),
    visualStyle: v.optional(visualStyleValidator),
    theme: v.optional(eventThemeValidator),
    meetUrl: v.string(),
    adminToken: v.optional(v.string()),
    judgingSheetId: v.optional(v.string()),
    judgingSheetUrl: v.optional(v.string()),
    judgingSheetCreatedAt: v.optional(v.number()),
    judgingSheetSyncRevision: v.optional(v.number()),
    judgingSheetSyncedRevision: v.optional(v.number()),
    judgingSheetSyncedAt: v.optional(v.number()),
    judgingSheetSyncError: v.optional(v.string()),
    roundOneJudges: v.optional(v.array(v.string())),
    submissionsClosedAt: v.optional(v.number()),
    // Last time public submits arrived faster than the event-wide limit; the admin warns.
    submissionSurgeAt: v.optional(v.number()),
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
    // The Luma event whose registrations prefill socials on the submit form.
    lumaEventId: v.optional(v.string()),
    lumaEventName: v.optional(v.string()),
    lumaEventUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"])
    .index("by_workosOrganizationId", ["workosOrganizationId"]),

  submissions: defineTable({
    eventId: v.id("events"),
    participantToken: v.string(),
    name: v.string(),
    demoTitle: v.string(),
    description: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    // emailKey(email), or "" without an email. Missing only on rows from before it.
    normalizedEmail: v.optional(v.string()),
    twitter: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    // The presenter's GitHub username or profile link (not the project repo).
    githubProfile: v.optional(v.string()),
    socialSources: v.optional(socialSourcesValidator),
    // When the status link was last emailed, to throttle "email me the link again".
    statusLinkEmailedAt: v.optional(v.number()),
    // Legacy free-text category. Kept for existing data; tracks replace it.
    category: v.optional(v.string()),
    // Ordered by the event's track order. Undefined means tracks were never set.
    trackIds: v.optional(v.array(v.id("eventTracks"))),
    teamName: v.optional(v.string()),
    githubUrl: v.optional(v.string()),
    // Three lines written by AI from the description and README, for judges and admins.
    // sourceKey says which description and repository it was written from.
    aiSummary: v.optional(
      v.object({
        whatItDoes: v.string(),
        howItWorks: v.string(),
        demoFocus: v.string(),
        sourceKey: v.string(),
        model: v.string(),
        usedReadme: v.boolean(),
        // SHA-256 of the README text the summary was written from, when there was one.
        readmeHash: v.optional(v.string()),
        generatedAt: v.number(),
      }),
    ),
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
    .index("by_event_and_normalized_email", ["eventId", "normalizedEmail"])
    .index("by_participant_token", ["participantToken"])
    .index("by_screenshot_id", ["screenshotId"])
    .index("by_video_delete_at", ["videoDeleteAt"])
    .index("by_video_storage_id", ["videoStorageId"]),

  eventTracks: defineTable({
    eventId: v.id("events"),
    name: v.string(),
    description: v.optional(v.string()),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_event_and_order", ["eventId", "order"]),

  teamMembers: defineTable({
    eventId: v.id("events"),
    submissionId: v.id("submissions"),
    name: v.string(),
    email: v.optional(v.string()),
    whatsappPhone: v.optional(v.string()),
    twitter: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    githubProfile: v.optional(v.string()),
    // emailKey(email), or "" without an email. Missing only on rows from before it.
    normalizedEmail: v.optional(v.string()),
    socialSources: v.optional(socialSourcesValidator),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_submission", ["submissionId"])
    .index("by_event_and_normalized_email", ["eventId", "normalizedEmail"]),

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

  // Short-lived cache of Luma social lookups, keyed by a hash of the email.
  // Each row is deleted when it expires.
  lumaGuestLookups: defineTable({
    eventId: v.id("events"),
    lumaEventId: v.string(),
    emailHash: v.string(),
    socials: v.object({
      twitter: v.optional(v.string()),
      linkedin: v.optional(v.string()),
      githubProfile: v.optional(v.string()),
    }),
    expiresAt: v.number(),
  }).index("by_event_and_email", ["eventId", "emailHash"]),
});
