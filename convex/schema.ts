import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { eventThemeValidator } from "./eventTheme";
import { visualStyleValidator } from "./visualStyle";
import { changeDocValidator, undoKindValidator, undoLabelValidator } from "./changeLog";

const phaseValidator = v.union(v.literal("submissions"), v.literal("judging"), v.literal("stage"), v.literal("finished"));
const summarySectionValidator = v.object({ key: v.string(), label: v.string(), instruction: v.string() });
// How a practice event writes AI summaries: "sample" (no model call, the default) or "model".
export const practiceAiSummariesValidator = v.union(v.literal("sample"), v.literal("model"));

/** Where each social came from: typed by the team, or imported from Luma. */
const socialSource = v.union(v.literal("typed"), v.literal("luma"));
// AI usage: what a call to OpenAI did (lib/ai-usage.ts).
export const aiUsageFeatureValidator = v.union(v.literal("summary"), v.literal("shuffle"));
export const aiUsageResultValidator = v.union(
  v.literal("saved"), v.literal("retried"), v.literal("rejected"), v.literal("discarded"), v.literal("failed"), v.literal("error"),
);

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
  }).index("by_slug", ["slug"]).index("by_event", ["eventId"]),
  // A built-in style has a row (with `preset`) only once it is the default or has a brand.
  organizationStyles: defineTable({
    organizationId: v.string(), name: v.string(), theme: eventThemeValidator,
    preset: v.optional(visualStyleValidator),
    isDefault: v.boolean(), updatedAt: v.number(),
    brandId: v.optional(v.id("styleBrands")),
  }).index("by_organization", ["organizationId"]),
  // The brands an organization groups its styles by, such as a sponsor. Listed in creation order.
  styleBrands: defineTable({
    organizationId: v.string(), name: v.string(), updatedAt: v.number(),
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
    // When the event finishes, the stage shows the winners and the other finalists (true, the default) or the winners only.
    stageResultsShowFinalists: v.optional(v.boolean()),
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
    // Where the organiser has moved the event. Older events derive it (lib/event-phase.ts).
    phase: v.optional(phaseValidator),
    finishedAt: v.optional(v.number()),
    // Set when moving back to submissions paused a running judging timer, so moving forward resumes it.
    judgingTimerPausedByPhase: v.optional(v.boolean()),
    // AI summary runs queued today (UTC day number), for the per-event daily budget.
    aiSummaryBudget: v.optional(v.object({ day: v.number(), used: v.number() })),
    // AI summary sections for this event; the defaults in lib/ai-summary.ts when unset.
    aiSummarySections: v.optional(v.array(summarySectionValidator)),
    // The last "Regenerate AI summaries" for the whole event: when, how many projects, and how many today (UTC day number).
    aiSummaryRegeneration: v.optional(v.object({ startedAt: v.number(), total: v.number(), day: v.number(), today: v.number() })),
    // A practice event: a real event with only test people, listed apart from real events.
    practice: v.optional(v.boolean()),
    practiceOwnerActor: v.optional(v.string()),
    // Test people get plus-addresses of this email, so their emails reach the owner.
    practiceOwnerEmail: v.optional(v.string()),
    practiceCopiedFromEventId: v.optional(v.id("events")),
    practiceCopiedFromName: v.optional(v.string()),
    // How many test people have been made, so each gets its own plus-address.
    practiceTestPeopleCount: v.optional(v.number()),
    // Practice events only: "sample" (the default when unset) writes sample summaries
    // with no OpenAI or GitHub call; "model" uses the real path. Real events ignore it.
    practiceAiSummaries: v.optional(practiceAiSummariesValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"])
    .index("by_workosOrganizationId", ["workosOrganizationId"])
    .index("by_workosOrganizationId_and_practice", ["workosOrganizationId", "practice"])
    .index("by_practice_and_updatedAt", ["practice", "updatedAt"]),

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
    // When the next AI summary run is or was scheduled to start, for the per-submission throttle.
    summaryQueuedFor: v.optional(v.number()),
    // When the newest queued summary run is set to start, until that run ends.
    // While set, judges see the AI read as being checked; nothing else shows it.
    summaryRunPending: v.optional(v.number()),
    // The last run for this description and repository ended without a summary
    // (rejected, or out of retries): judges see "No summary", not "being written".
    aiSummaryGaveUp: v.optional(v.object({ sourceKey: v.string(), reason: v.string(), at: v.number() })),
    // Three lines written by AI from the description and README, for judges and admins.
    // sourceKey says which description and repository it was written from.
    aiSummary: v.optional(
      v.object({
        // Older summaries hold only these three; newer ones hold sections too.
        whatItDoes: v.optional(v.string()),
        howItWorks: v.optional(v.string()),
        demoFocus: v.optional(v.string()),
        sections: v.optional(v.array(v.object({ key: v.string(), label: v.string(), text: v.string() }))),
        sourceKey: v.string(),
        model: v.string(),
        usedReadme: v.boolean(),
        // SHA-256 of the README text the summary was written from, when there was one.
        readmeHash: v.optional(v.string()),
        // No longer written: the video captions read was removed. Summaries written while it was
        // in still carry it.
        transcriptHash: v.optional(v.string()),
        // SHA-256 of the code read it was written from, or "none" when the model had none. Missing on
        // summaries from before the code read: they are not rewritten for it.
        codeHash: v.optional(v.string()),
        // summaryTracksKey of the track descriptions and sponsors it was written from; missing before track descriptions went in.
        tracksKey: v.optional(v.string()),
        // The AI read: a sentence overall, then a level and a reason for each described track and each sponsor.
        read: v.optional(v.object({
          overall: v.string(),
          tracks: v.array(v.object({ trackId: v.id("eventTracks"), level: v.union(v.literal("strong"), v.literal("partial"), v.literal("weak")), reason: v.string() })),
          sponsors: v.array(v.object({ sponsorId: v.id("eventSponsors"), level: v.union(v.literal("core"), v.literal("used"), v.literal("light"), v.literal("none")), reason: v.string() })),
        })),
        // v3 only: each main feature the team claims, and whether the code read shows it built.
        builtVsStubbed: v.optional(v.array(v.object({
          part: v.string(),
          status: v.union(v.literal("working"), v.literal("partial"), v.literal("stubbed"), v.literal("not_read")),
          evidence: v.string(),
        }))),
        // v3 only: two or three questions a judge could ask after the demo.
        questions: v.optional(v.array(v.string())),
        // v3 only: counts from the repository's commits, computed by the app, and the commit read.
        build: v.optional(v.object({
          sha: v.string(),
          readAt: v.number(),
          deadline: v.number(),
          deadlineKind: v.union(v.literal("closed"), v.literal("written")),
          commits: v.number(),
          people: v.number(),
          firstAt: v.number(),
          lastAt: v.number(),
          afterDeadline: v.number(),
          firstCommitLines: v.optional(v.number()),
          firstCommitFiles: v.optional(v.number()),
          truncated: v.boolean(),
          filesRead: v.number(),
        })),
        // SUMMARY_PROMPT_VERSION it was written with; missing on the first version.
        promptVersion: v.optional(v.number()),
        // A practice sample summary, written without the model.
        sample: v.optional(v.boolean()),
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
    // Set while withdrawn: the status before, and who withdrew it. Submit again
    // works only for an entry the team withdrew from candidate or queued.
    withdrawnFromStatus: v.optional(v.union(v.literal("candidate"), v.literal("queued"))),
    withdrawnBy: v.optional(v.union(v.literal("participant"), v.literal("organiser"))),
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
  // A hackathon's sponsors: the AI read checks each project for what counts as using one.
  eventSponsors: defineTable({
    eventId: v.id("events"),
    name: v.string(),
    usage: v.optional(v.string()),
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
  }).index("by_event", ["eventId"])
    .index("by_event_and_action", ["eventId", "action"]),

  // Organiser changes, for Recent changes and Undo (convex/changeLog.ts).
  eventChanges: defineTable({
    eventId: v.id("events"),
    actor: v.string(),
    actorUserId: v.optional(v.string()),
    // "participant": the team did it from their status page (Submit again).
    via: v.union(v.literal("app"), v.literal("assistant"), v.literal("participant")),
    kind: v.string(),
    // A short phrase after the person's name: "hid Bus Buddy II".
    summary: v.string(),
    subjectId: v.optional(v.string()),
    undo: undoKindValidator,
    undoLabel: undoLabelValidator,
    fromPhase: v.optional(phaseValidator),
    toPhase: v.optional(phaseValidator),
    // The phase the event was in when a snapshot change was made.
    phaseAtChange: v.optional(phaseValidator),
    docs: v.array(changeDocValidator),
    undoOf: v.optional(v.id("eventChanges")),
    undoneAt: v.optional(v.number()),
    undoneBy: v.optional(v.id("eventChanges")),
    // Why undo is "none", when it is not the plain "This change can't be undone."
    noUndoReason: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_event", ["eventId"]).index("by_createdAt", ["createdAt"]),

  // The Getting started guide's own choices, per person and organization.
  gettingStartedGuides: defineTable({
    ownerAccountKey: v.string(),
    organizationId: v.string(),
    hidden: v.boolean(),
    dryRunMarkedAt: v.optional(v.number()),
    // Not everyone has a team to invite, so the step can be skipped.
    teamSkippedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_owner_and_organization", ["ownerAccountKey", "organizationId"]),

  judgeAccess: defineTable({
    eventId: v.id("events"),
    judgeKey: v.string(),
    judgeName: v.string(),
    token: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    deactivatedAt: v.optional(v.number()),
    // When the judge confirmed their name on this link. Cleared when the link is replaced.
    openedAt: v.optional(v.number()),
    replacedAt: v.optional(v.number()),
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

  // The score basis, kept off the event so a saved score doesn't touch it (convex/scoreBasis.ts).
  scoreBases: defineTable({
    eventId: v.id("events"),
    version: v.number(),
    confirmedVersion: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_event", ["eventId"]),
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

  // One row per call to OpenAI, including retries and rejected output, because
  // OpenAI bills them all. Token counts only, never the prompt, the project
  // text or the output. Dollars are worked out when read (lib/ai-prices.ts).
  aiUsage: defineTable({
    organizationId: v.string(),
    eventId: v.id("events"),
    submissionId: v.optional(v.id("submissions")),
    feature: aiUsageFeatureValidator,
    // The model OpenAI reported; the requested one when the call failed before answering.
    model: v.string(),
    serviceTier: v.optional(v.string()),
    // Unset when the call failed before OpenAI reported usage.
    inputTokens: v.optional(v.number()),
    // Part of inputTokens.
    cachedInputTokens: v.optional(v.number()),
    // Includes reasoningTokens.
    outputTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
    result: aiUsageResultValidator,
    createdAt: v.number(),
  }).index("by_organization_and_createdAt", ["organizationId", "createdAt"])
    .index("by_event_and_createdAt", ["eventId", "createdAt"]),

  // One row per practice sample summary written: no model call, so not in
  // aiUsage, but the AI usage page counts them. Removed with the practice event.
  aiSampleSummaries: defineTable({
    organizationId: v.string(),
    eventId: v.id("events"),
    submissionId: v.id("submissions"),
    createdAt: v.number(),
  }).index("by_organization_and_createdAt", ["organizationId", "createdAt"])
    .index("by_event", ["eventId"]),
});
