import { requireApproval } from "./mcpConnectionPolicy";
import { ConvexError, v, type Infer } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { organizationPrincipalValidator, requireOwnedEvent } from "./organizationAuth";
import * as events from "./events";
import * as judging from "./judging";
import * as phases from "./phases";
import * as changes from "./changes";
import * as practice from "./practice";
import * as organizationStyles from "./organizationStyles";
import { visualStyleValidator } from "./visualStyle";

type Admin = Awaited<ReturnType<typeof events.getAdminForOrganization>>;
type Submission = Admin["lineup"][number];

function submissionId(ctx: Pick<QueryCtx, "db">, value: string) {
  const id = ctx.db.normalizeId("submissions", value);
  if (!id) throw new ConvexError("Submission not found");
  return id;
}

/** MCP takes track ids as strings; the operation still checks they belong to the event. */
function trackIds(ctx: Pick<QueryCtx, "db">, values: string[] | undefined) {
  return values?.map((value) => {
    const id = ctx.db.normalizeId("eventTracks", value);
    if (!id) throw new ConvexError("Track not found");
    return id;
  });
}

function submissionDto(s: Submission) {
  return {
    id: s.id, name: s.name, demoTitle: s.demoTitle, description: s.description,
    tracks: s.tracks, trackIds: s.trackIds, teamName: s.teamName, githubUrl: s.githubUrl,
    status: s.status, queueOrder: s.queueOrder, teamMembers: s.teamMembers,
    videoUrl: s.videoUrl, videoDeleteAt: s.videoDeleteAt, videoDeletedAt: s.videoDeletedAt,
    rulesAcceptedAt: s.rulesAcceptedAt, roundOneAssignedJudges: s.roundOneAssignedJudges,
    aiSummary: s.aiSummary, aiRead: s.aiRead, createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

export const getAdminInput = events.getAdminArgs;
export const getEventOverviewInput = events.getOrganizationEventDetailsArgs;
export const getEventOverview = internalQuery({
  args: { principal: organizationPrincipalValidator, input: getEventOverviewInput },
  handler: async (ctx, { principal, input }) => {
    if (principal.mcp) await requireApproval(ctx, principal.mcp.approvalId, principal.organizationId, "events:read");
    return events.getOrganizationEventDetailsForOrganization(ctx, input, principal);
  },
});
export const getAdminForAction = internalQuery({
  args: { principal: organizationPrincipalValidator, input: getAdminInput },
  handler: (ctx, { principal, input }) => events.getAdminForOrganization(ctx, input, principal),
});
export const getEventAdmin = internalQuery({
  args: { principal: organizationPrincipalValidator, input: getAdminInput },
  handler: async (ctx, { principal, input }) => {
    const admin = await events.getAdminForOrganization(ctx, input, principal);
    return {
      event: admin.event,
      // Track ids here are what add_submission and update_submission take.
      tracks: admin.tracks, noTrackCount: admin.noTrackCount, legacyCategoryCount: admin.legacyCategoryCount,
      // A hackathon's sponsors, with what counts as using each: the AI read checks projects for them.
      sponsors: admin.sponsors,
      lineup: admin.lineup.map(submissionDto), pool: admin.pool.map(submissionDto),
      hidden: admin.hidden.map(submissionDto), completed: admin.completed.map(submissionDto),
      noShows: admin.noShows.map(submissionDto), withdrawn: admin.withdrawn.map(submissionDto),
    };
  },
});
export const getSubmissionContactsInput = getAdminInput.extend({ submissionId: v.string() });
export const getSubmissionContacts = internalQuery({
  args: { principal: organizationPrincipalValidator, input: getSubmissionContactsInput },
  handler: async (ctx, { principal, input }) => {
    const admin = await events.getAdminForOrganization(ctx, input, principal);
    const id = submissionId(ctx, input.submissionId);
    const submission = [...admin.lineup, ...admin.pool, ...admin.hidden, ...admin.completed, ...admin.noShows, ...admin.withdrawn].find((s) => s.id === id);
    if (!submission) throw new ConvexError("Submission not found");
    return {
      id: submission.id, name: submission.name, phone: submission.phone,
      email: submission.email, twitter: submission.twitter, linkedin: submission.linkedin, githubProfile: submission.githubProfile,
      teamMemberContacts: submission.teamMemberContacts,
    };
  },
});

export const addSubmissionInput = v.object({ ...events.adminAddSubmissionArgs.omit("participantToken").fields, trackIds: v.optional(v.array(v.string())) });
export const addSubmission = internalMutation({
  args: { principal: organizationPrincipalValidator, input: addSubmissionInput },
  handler: (ctx, { principal, input }) => events.adminAddSubmissionForOrganization(ctx, { ...input, trackIds: trackIds(ctx, input.trackIds), participantToken: crypto.randomUUID() }, principal),
});
export const addTestSubmissionsInput = v.object({
  ...events.adminAddTestSubmissionsArgs.fields,
  submissions: v.array(v.object({
    ...events.adminAddTestSubmissionsArgs.fields.submissions.element.omit("participantToken").fields,
    trackIds: v.optional(v.array(v.string())),
  })),
});
export const addTestSubmissions = internalMutation({
  args: { principal: organizationPrincipalValidator, input: addTestSubmissionsInput },
  handler: (ctx, { principal, input }) => events.adminAddTestSubmissionsForOrganization(ctx, {
    ...input, submissions: input.submissions.map((s) => ({ ...s, trackIds: trackIds(ctx, s.trackIds), participantToken: crypto.randomUUID() })),
  }, principal),
});
export const listJudgeLinksInput = judging.listJudgeAccessArgs;
export const listJudgeLinks = internalQuery({
  args: { principal: organizationPrincipalValidator, input: listJudgeLinksInput },
  handler: async (ctx, { principal, input }) => {
    const { event } = await requireOwnedEvent(ctx, input.slug, principal);
    const links = await judging.listJudgeAccessForOrganization(ctx, input, principal);
    return links.map((link) => ({
      judgeKey: link.judgeKey, judgeName: link.judgeName, active: link.active,
      path: `/judge/${event.slug}/${link.token}`, createdAt: link.createdAt, updatedAt: link.updatedAt,
    }));
  },
});
export const createJudgeLinkInput = judging.createJudgeAccessArgs.omit("capabilityToken");
export const createJudgeLink = internalMutation({
  args: { principal: organizationPrincipalValidator, input: createJudgeLinkInput },
  handler: async (ctx, { principal, input }) => {
    const { event } = await requireOwnedEvent(ctx, input.slug, principal);
    const capabilityToken = crypto.randomUUID();
    const access = await judging.createJudgeAccessForOrganization(ctx, { ...input, capabilityToken }, principal);
    return { ...access, path: `/judge/${event.slug}/${capabilityToken}` };
  },
});

export const clearQueueInput = events.clearQueueArgs.extend({
  confirmation: v.object({ action: v.literal("clear_queue"), slug: v.string() }),
});
export const clearQueue = internalMutation({
  args: { principal: organizationPrincipalValidator, input: clearQueueInput },
  handler: (ctx, { principal, input }) => {
    if (input.confirmation.slug !== input.slug) throw new ConvexError("Confirmation must match the event.");
    return events.clearQueueForOrganization(ctx, input, principal);
  },
});
export const changeEventTypeInput = events.changeEventTypeArgs.extend({
  confirmation: v.object({ action: v.literal("change_event_type"), slug: v.string(), eventType: events.changeEventTypeArgs.fields.eventType }),
});
export const changeEventType = internalMutation({
  args: { principal: organizationPrincipalValidator, input: changeEventTypeInput },
  handler: (ctx, { principal, input }) => {
    if (input.confirmation.slug !== input.slug || input.confirmation.eventType !== input.eventType) throw new ConvexError("Confirmation must match the event and type.");
    return events.changeEventTypeForOrganization(ctx, input, principal);
  },
});

export const saveRoundOneJudgesInput = events.saveRoundOneJudgesArgs;
export const saveRoundOneJudges = internalMutation({
  args: { principal: organizationPrincipalValidator, input: saveRoundOneJudgesInput },
  handler: (ctx, { principal, input }) => events.saveRoundOneJudgesForOrganization(ctx, input, principal),
});

export const requestJudgingSheetSyncInput = events.requestJudgingSheetSyncArgs;
export const requestJudgingSheetSync = internalMutation({
  args: { principal: organizationPrincipalValidator, input: requestJudgingSheetSyncInput },
  handler: (ctx, { principal, input }) => events.requestJudgingSheetSyncForOrganization(ctx, input, principal),
});

export const updateSubmissionInput = v.object({ ...events.updateSubmissionArgs.fields, submissionId: v.string(), trackIds: v.optional(v.array(v.string())) });
export const updateSubmission = internalMutation({
  args: { principal: organizationPrincipalValidator, input: updateSubmissionInput },
  handler: (ctx, { principal, input }) => events.updateSubmissionForOrganization(ctx, { ...input, submissionId: submissionId(ctx, input.submissionId), trackIds: trackIds(ctx, input.trackIds) }, principal),
});

export const publishQueueInput = events.publishQueueArgs;
export const publishQueue = internalMutation({
  args: { principal: organizationPrincipalValidator, input: publishQueueInput },
  handler: (ctx, { principal, input }) => events.publishQueueForOrganization(ctx, input, principal),
});

export const setStageScreenModeInput = events.setStageScreenModeArgs;
export const setStageScreenMode = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setStageScreenModeInput },
  handler: (ctx, { principal, input }) => events.setStageScreenModeForOrganization(ctx, input, principal),
});

export const setSubmissionCountVisibleInput = events.setSubmissionCountVisibleArgs;
export const setSubmissionCountVisible = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setSubmissionCountVisibleInput },
  handler: (ctx, { principal, input }) => events.setSubmissionCountVisibleForOrganization(ctx, input, principal),
});

export const setStageMeetLinkVisibleInput = events.setStageMeetLinkVisibleArgs;
export const setStageMeetLinkVisible = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setStageMeetLinkVisibleInput },
  handler: (ctx, { principal, input }) => events.setStageMeetLinkVisibleForOrganization(ctx, input, principal),
});

export const setStageTimerVisibleInput = events.setStageTimerVisibleArgs;
export const setStageTimerVisible = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setStageTimerVisibleInput },
  handler: (ctx, { principal, input }) => events.setStageTimerVisibleForOrganization(ctx, input, principal),
});

export const setStageTimerDurationInput = events.setStageTimerDurationArgs;
export const setStageTimerDuration = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setStageTimerDurationInput },
  handler: (ctx, { principal, input }) => events.setStageTimerDurationForOrganization(ctx, input, principal),
});

export const startStageTimerInput = events.startStageTimerArgs;
export const startStageTimer = internalMutation({
  args: { principal: organizationPrincipalValidator, input: startStageTimerInput },
  handler: (ctx, { principal, input }) => events.startStageTimerForOrganization(ctx, input, principal),
});

export const setDemoTimerVisibleInput = events.setDemoTimerVisibleArgs;
export const setDemoTimerVisible = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setDemoTimerVisibleInput },
  handler: (ctx, { principal, input }) => events.setDemoTimerVisibleForOrganization(ctx, input, principal),
});

export const setDemoTimerDurationInput = events.setDemoTimerDurationArgs;
export const setDemoTimerDuration = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setDemoTimerDurationInput },
  handler: (ctx, { principal, input }) => events.setDemoTimerDurationForOrganization(ctx, input, principal),
});

export const startDemoTimerInput = events.startDemoTimerArgs;
export const startDemoTimer = internalMutation({
  args: { principal: organizationPrincipalValidator, input: startDemoTimerInput },
  handler: (ctx, { principal, input }) => events.startDemoTimerForOrganization(ctx, input, principal),
});

export const pauseDemoTimerInput = events.pauseDemoTimerArgs;
export const pauseDemoTimer = internalMutation({
  args: { principal: organizationPrincipalValidator, input: pauseDemoTimerInput },
  handler: (ctx, { principal, input }) => events.pauseDemoTimerForOrganization(ctx, input, principal),
});

export const adjustDemoTimerInput = events.adjustDemoTimerArgs;
export const adjustDemoTimer = internalMutation({
  args: { principal: organizationPrincipalValidator, input: adjustDemoTimerInput },
  handler: (ctx, { principal, input }) => events.adjustDemoTimerForOrganization(ctx, input, principal),
});

export const pauseStageTimerInput = events.pauseStageTimerArgs;
export const pauseStageTimer = internalMutation({
  args: { principal: organizationPrincipalValidator, input: pauseStageTimerInput },
  handler: (ctx, { principal, input }) => events.pauseStageTimerForOrganization(ctx, input, principal),
});

export const resetStageTimerInput = events.resetStageTimerArgs;
export const resetStageTimer = internalMutation({
  args: { principal: organizationPrincipalValidator, input: resetStageTimerInput },
  handler: (ctx, { principal, input }) => events.resetStageTimerForOrganization(ctx, input, principal),
});

export const adjustStageTimerInput = events.adjustStageTimerArgs;
export const adjustStageTimer = internalMutation({
  args: { principal: organizationPrincipalValidator, input: adjustStageTimerInput },
  handler: (ctx, { principal, input }) => events.adjustStageTimerForOrganization(ctx, input, principal),
});

export const hideSubmissionInput = v.object({ ...events.hideSubmissionArgs.fields, submissionId: v.string() });
export const hideSubmission = internalMutation({
  args: { principal: organizationPrincipalValidator, input: hideSubmissionInput },
  handler: (ctx, { principal, input }) => events.hideSubmissionForOrganization(ctx, { ...input, submissionId: submissionId(ctx, input.submissionId) }, principal),
});

export const restoreSubmissionInput = v.object({ ...events.restoreSubmissionArgs.fields, submissionId: v.string() });
export const restoreSubmission = internalMutation({
  args: { principal: organizationPrincipalValidator, input: restoreSubmissionInput },
  handler: (ctx, { principal, input }) => events.restoreSubmissionForOrganization(ctx, { ...input, submissionId: submissionId(ctx, input.submissionId) }, principal),
});

export const reorderLineupInput = v.object({ ...events.reorderLineupArgs.fields, orderedIds: v.array(v.string()) });
export const reorderLineup = internalMutation({
  args: { principal: organizationPrincipalValidator, input: reorderLineupInput },
  handler: (ctx, { principal, input }) => events.reorderLineupForOrganization(ctx, { ...input, orderedIds: input.orderedIds.map((id) => submissionId(ctx, id)) }, principal),
});

export const shuffleLineupInput = events.shuffleLineupArgs;
export const shuffleLineup = internalMutation({
  args: { principal: organizationPrincipalValidator, input: shuffleLineupInput },
  handler: (ctx, { principal, input }) => events.shuffleLineupForOrganization(ctx, input, principal),
});

export const setLineupOrderInput = events.setLineupOrderArgs;
export const setLineupOrder = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setLineupOrderInput },
  handler: (ctx, { principal, input }) => events.setLineupOrderForOrganization(ctx, input, principal),
});

export const moveToPoolInput = v.object({ ...events.moveToPoolArgs.fields, submissionId: v.string() });
export const moveToPool = internalMutation({
  args: { principal: organizationPrincipalValidator, input: moveToPoolInput },
  handler: (ctx, { principal, input }) => events.moveToPoolForOrganization(ctx, { ...input, submissionId: submissionId(ctx, input.submissionId) }, principal),
});

export const setLineupTargetInput = events.setLineupTargetArgs;
export const setLineupTarget = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setLineupTargetInput },
  handler: (ctx, { principal, input }) => events.setLineupTargetForOrganization(ctx, input, principal),
});

export const markNoShowInput = events.markNoShowArgs;
export const markNoShow = internalMutation({
  args: { principal: organizationPrincipalValidator, input: markNoShowInput },
  handler: (ctx, { principal, input }) => events.markNoShowForOrganization(ctx, input, principal),
});

export const pickNextInput = events.pickNextArgs;
export const pickNext = internalMutation({
  args: { principal: organizationPrincipalValidator, input: pickNextInput },
  handler: (ctx, { principal, input }) => events.pickNextForOrganization(ctx, input, principal),
});

export const restorePreviousPresenterInput = events.restorePreviousPresenterArgs;
export const restorePreviousPresenter = internalMutation({
  args: { principal: organizationPrincipalValidator, input: restorePreviousPresenterInput },
  handler: (ctx, { principal, input }) => events.restorePreviousPresenterForOrganization(ctx, input, principal),
});

export const skipCurrentInput = events.skipCurrentArgs;
export const skipCurrent = internalMutation({
  args: { principal: organizationPrincipalValidator, input: skipCurrentInput },
  handler: (ctx, { principal, input }) => events.skipCurrentForOrganization(ctx, input, principal),
});

export const saveJudgingSheetInput = events.saveJudgingSheetArgs;
export const saveJudgingSheet = internalMutation({
  args: { principal: organizationPrincipalValidator, input: saveJudgingSheetInput },
  handler: (ctx, { principal, input }) => events.saveJudgingSheetForOrganization(ctx, input, principal),
});

export const closeSubmissionsInput = judging.closeSubmissionsArgs;
export const closeSubmissions = internalMutation({
  args: { principal: organizationPrincipalValidator, input: closeSubmissionsInput },
  handler: (ctx, { principal, input }) => judging.closeSubmissionsForOrganization(ctx, input, principal),
});

export const startAssignmentPreparationInput = judging.startAssignmentPreparationArgs;
export const startAssignmentPreparation = internalMutation({
  args: { principal: organizationPrincipalValidator, input: startAssignmentPreparationInput },
  handler: (ctx, { principal, input }) => judging.startAssignmentPreparationForOrganization(ctx, input, principal),
});

export const prepareAssignmentBatchInput = judging.prepareAssignmentBatchArgs;
export const prepareAssignmentBatch = internalMutation({
  args: { principal: organizationPrincipalValidator, input: prepareAssignmentBatchInput },
  handler: (ctx, { principal, input }) => judging.prepareAssignmentBatchForOrganization(ctx, input, principal),
});

export const applyRedistributionInput = v.object({
  ...judging.applyRedistributionArgs.fields,
  assignments: v.array(v.object({ ...judging.applyRedistributionArgs.fields.assignments.element.fields, submissionId: v.string() })),
});
export const applyRedistribution = internalMutation({
  args: { principal: organizationPrincipalValidator, input: applyRedistributionInput },
  handler: (ctx, { principal, input }) => judging.applyRedistributionForOrganization(ctx, {
    ...input, assignments: input.assignments.map((row) => ({ ...row, submissionId: submissionId(ctx, row.submissionId) })),
  }, principal),
});

export const setJudgingTimerInput = judging.setJudgingTimerArgs;
export const setJudgingTimer = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setJudgingTimerInput },
  handler: (ctx, { principal, input }) => judging.setJudgingTimerForOrganization(ctx, input, principal),
});

export const startJudgingInput = judging.startJudgingArgs;
export const startJudging = internalMutation({
  args: { principal: organizationPrincipalValidator, input: startJudgingInput },
  handler: (ctx, { principal, input }) => judging.startJudgingForOrganization(ctx, input, principal),
});

export const addJudgingTimeInput = judging.addJudgingTimeArgs;
export const addJudgingTime = internalMutation({
  args: { principal: organizationPrincipalValidator, input: addJudgingTimeInput },
  handler: (ctx, { principal, input }) => judging.addJudgingTimeForOrganization(ctx, input, principal),
});

export const closeJudgingInput = judging.closeJudgingArgs;
export const closeJudging = internalMutation({
  args: { principal: organizationPrincipalValidator, input: closeJudgingInput },
  handler: (ctx, { principal, input }) => judging.closeJudgingForOrganization(ctx, input, principal),
});

export const reopenJudgingInput = judging.reopenJudgingArgs;
export const reopenJudging = internalMutation({
  args: { principal: organizationPrincipalValidator, input: reopenJudgingInput },
  handler: (ctx, { principal, input }) => judging.reopenJudgingForOrganization(ctx, input, principal),
});

export const saveNormalizationDecisionInput = judging.saveNormalizationDecisionArgs;
export const saveNormalizationDecision = internalMutation({
  args: { principal: organizationPrincipalValidator, input: saveNormalizationDecisionInput },
  handler: (ctx, { principal, input }) => judging.saveNormalizationDecisionForOrganization(ctx, input, principal),
});

export const getAdminProgressInput = judging.getAdminProgressArgs;
export const getAdminProgress = internalQuery({
  args: { principal: organizationPrincipalValidator, input: getAdminProgressInput },
  handler: (ctx, { principal, input }) => judging.getAdminProgressForOrganization(ctx, input, principal),
});

export const getJudgingTimerInput = judging.getJudgingTimerArgs;
export const getJudgingTimer = internalQuery({
  args: { principal: organizationPrincipalValidator, input: getJudgingTimerInput },
  handler: (ctx, { principal, input }) => judging.getJudgingTimerForOrganization(ctx, input, principal),
});

export const getNormalizationOverviewInput = judging.getNormalizationOverviewArgs;
export const getNormalizationOverview = internalQuery({
  args: { principal: organizationPrincipalValidator, input: getNormalizationOverviewInput },
  handler: (ctx, { principal, input }) => judging.getNormalizationOverviewForOrganization(ctx, input, principal),
});

export const previewRedistributionInput = v.object({
  ...judging.previewRedistributionArgs.fields,
  overrides: v.optional(v.array(v.object({ ...judging.previewRedistributionArgs.fields.overrides.element.fields, submissionId: v.string() }))),
});
export const previewRedistribution = internalQuery({
  args: { principal: organizationPrincipalValidator, input: previewRedistributionInput },
  handler: (ctx, { principal, input }) => judging.previewRedistributionForOrganization(ctx, {
    ...input, overrides: input.overrides?.map((row) => ({ ...row, submissionId: submissionId(ctx, row.submissionId) })),
  }, principal),
});

// New behaviour: phases, exact timers, Recent changes and Undo, the Judges table, the live event and practice events.

export const setPhaseInput = phases.setPhaseArgs;
export const setPhase = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setPhaseInput },
  handler: (ctx, { principal, input }) => phases.setPhaseForOrganization(ctx, input, principal),
});

export const previewPhaseChangeInput = phases.previewPhaseChangeArgs;
export const previewPhaseChange = internalQuery({
  args: { principal: organizationPrincipalValidator, input: previewPhaseChangeInput },
  handler: (ctx, { principal, input }) => phases.previewPhaseChangeForOrganization(ctx, input, principal),
});

export const reopenSubmissionsInput = phases.reopenSubmissionsArgs;
export const reopenSubmissions = internalMutation({
  args: { principal: organizationPrincipalValidator, input: reopenSubmissionsInput },
  handler: (ctx, { principal, input }) => phases.reopenSubmissionsForOrganization(ctx, input, principal),
});

export const setJudgingTimeLeftInput = judging.setJudgingTimeLeftArgs;
export const setJudgingTimeLeft = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setJudgingTimeLeftInput },
  handler: (ctx, { principal, input }) => judging.setJudgingTimeLeftForOrganization(ctx, input, principal),
});

export const pauseJudgingTimerInput = judging.pauseJudgingTimerArgs;
export const pauseJudgingTimer = internalMutation({
  args: { principal: organizationPrincipalValidator, input: pauseJudgingTimerInput },
  handler: (ctx, { principal, input }) => judging.pauseJudgingTimerForOrganization(ctx, input, principal),
});

export const resumeJudgingTimerInput = judging.resumeJudgingTimerArgs;
export const resumeJudgingTimer = internalMutation({
  args: { principal: organizationPrincipalValidator, input: resumeJudgingTimerInput },
  handler: (ctx, { principal, input }) => judging.resumeJudgingTimerForOrganization(ctx, input, principal),
});

export const setStageTimerRemainingInput = events.setStageTimerRemainingArgs;
export const setStageTimerRemaining = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setStageTimerRemainingInput },
  handler: (ctx, { principal, input }) => events.setStageTimerRemainingForOrganization(ctx, input, principal),
});

export const listRecentChangesInput = changes.listRecentChangesArgs;
export const listRecentChanges = internalQuery({
  args: { principal: organizationPrincipalValidator, input: listRecentChangesInput },
  handler: (ctx, { principal, input }) => changes.listRecentChangesForOrganization(ctx, input, principal),
});

export const undoChangeInput = changes.undoChangeArgs;
export const undoChange = internalMutation({
  args: { principal: organizationPrincipalValidator, input: undoChangeInput },
  handler: (ctx, { principal, input }) => changes.undoChangeForOrganization(ctx, input, principal),
});

export const getJudgesOverviewInput = judging.getJudgesOverviewArgs;
export const getJudgesOverview = internalQuery({
  args: { principal: organizationPrincipalValidator, input: getJudgesOverviewInput },
  handler: (ctx, { principal, input }) => judging.getJudgesOverviewForOrganization(ctx, input, principal),
});

/** The tool makes the new token, as create_judge_link does. */
export const replaceJudgeLinkInput = judging.replaceJudgeLinkArgs.omit("capabilityToken");
export const replaceJudgeLink = internalMutation({
  args: { principal: organizationPrincipalValidator, input: replaceJudgeLinkInput },
  handler: (ctx, { principal, input }) =>
    judging.replaceJudgeLinkForOrganization(ctx, { ...input, capabilityToken: crypto.randomUUID() }, principal),
});

export const moveJudgeScoresInput = v.object({ ...judging.moveJudgeScoresArgs.fields, submissionIds: v.optional(v.array(v.string())) });
export const moveJudgeScores = internalMutation({
  args: { principal: organizationPrincipalValidator, input: moveJudgeScoresInput },
  handler: (ctx, { principal, input }) => judging.moveJudgeScoresForOrganization(ctx, {
    ...input, submissionIds: input.submissionIds?.map((value) => submissionId(ctx, value)),
  }, principal),
});

export const setJudgeLinkActiveInput = judging.setJudgeLinkActiveArgs;
export const setJudgeLinkActive = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setJudgeLinkActiveInput },
  handler: (ctx, { principal, input }) => judging.setJudgeLinkActiveForOrganization(ctx, input, principal),
});

export const getLiveEventInput = events.getLiveEventArgs;
export const getLiveEvent = internalQuery({
  args: { principal: organizationPrincipalValidator, input: getLiveEventInput },
  handler: (ctx, { principal, input }) => events.getLiveEventForOrganization(ctx, input, principal),
});

/** The organization comes from the tool call, so the tool does not repeat it. */
export const createPracticeEventInput = practice.createPracticeEventArgs.omit("expectedOrganizationId");

export const listPracticeEventsInput = practice.listPracticeEventsArgs;
export const listPracticeEvents = internalQuery({
  args: { principal: organizationPrincipalValidator, input: listPracticeEventsInput },
  handler: (ctx, { principal, input }) => practice.listPracticeEventsForOrganization(ctx, input, principal),
});

export const addPracticeSubmissionsInput = practice.addPracticeSubmissionsArgs;
export const addPracticeSubmissions = internalMutation({
  args: { principal: organizationPrincipalValidator, input: addPracticeSubmissionsInput },
  handler: (ctx, { principal, input }) => practice.addPracticeSubmissionsForOrganization(ctx, input, principal),
});

export const scoreAsTestJudgesInput = practice.scoreAsTestJudgesArgs;
export const scoreAsTestJudges = internalMutation({
  args: { principal: organizationPrincipalValidator, input: scoreAsTestJudgesInput },
  handler: (ctx, { principal, input }) => practice.scoreAsTestJudgesForOrganization(ctx, input, principal),
});

export const skipPracticeTimerInput = practice.skipTimerToLastSecondsArgs;
export const skipPracticeTimer = internalMutation({
  args: { principal: organizationPrincipalValidator, input: skipPracticeTimerInput },
  handler: (ctx, { principal, input }) => practice.skipTimerToLastSecondsForOrganization(ctx, input, principal),
});

export const setPracticeAiSummariesInput = practice.setPracticeAiSummariesArgs;
export const setPracticeAiSummaries = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setPracticeAiSummariesInput },
  handler: (ctx, { principal, input }) => practice.setPracticeAiSummariesForOrganization(ctx, input, principal),
});

export const resetPracticeEventInput = practice.resetPracticeEventArgs.extend({
  confirmation: v.object({ action: v.literal("reset_practice_event"), slug: v.string() }),
});
export const resetPracticeEvent = internalMutation({
  args: { principal: organizationPrincipalValidator, input: resetPracticeEventInput },
  handler: (ctx, { principal, input: { confirmation, ...input } }) => {
    if (confirmation.slug !== input.slug) throw new ConvexError("Confirmation must match the event.");
    return practice.resetPracticeEventForOrganization(ctx, input, principal);
  },
});

// Style brands. MCP takes ids as strings; the operations check they belong to the organization.
const styleRefInput = v.union(v.object({ kind: v.literal("preset"), preset: visualStyleValidator }), v.object({ kind: v.literal("saved"), id: v.string() }));

function styleRef(ctx: Pick<QueryCtx, "db">, style: Infer<typeof styleRefInput>): Infer<typeof organizationStyles.styleRefValidator> {
  if (style.kind === "preset") return style;
  const id = ctx.db.normalizeId("organizationStyles", style.id);
  if (!id) throw new ConvexError("Style not found.");
  return { kind: "saved", id };
}

function brandId(ctx: Pick<QueryCtx, "db">, value: string) {
  const id = ctx.db.normalizeId("styleBrands", value);
  if (!id) throw new ConvexError("Brand not found.");
  return id;
}

export const createStyleBrandInput = v.object({ name: v.string(), style: v.optional(styleRefInput) });
export const createStyleBrand = internalMutation({
  args: { principal: organizationPrincipalValidator, input: createStyleBrandInput },
  handler: async (ctx, { principal, input }) => {
    if (principal.mcp) await requireApproval(ctx, principal.mcp.approvalId, principal.organizationId, "events:manage");
    const style = input.style && styleRef(ctx, input.style);
    const id = await organizationStyles.createStyleBrand(ctx, { expectedOrganizationId: principal.organizationId, name: input.name, style }, principal.organizationId);
    return { brandId: id };
  },
});

export const renameStyleBrandInput = v.object({ brandId: v.string(), name: v.string() });
export const renameStyleBrand = internalMutation({
  args: { principal: organizationPrincipalValidator, input: renameStyleBrandInput },
  handler: async (ctx, { principal, input }) => {
    if (principal.mcp) await requireApproval(ctx, principal.mcp.approvalId, principal.organizationId, "events:manage");
    const id = await organizationStyles.renameStyleBrand(ctx, { expectedOrganizationId: principal.organizationId, id: brandId(ctx, input.brandId), name: input.name }, principal.organizationId);
    return { brandId: id };
  },
});

export const setStyleBrandInput = v.object({ style: styleRefInput, brandId: v.union(v.string(), v.null()) });
export const setStyleBrand = internalMutation({
  args: { principal: organizationPrincipalValidator, input: setStyleBrandInput },
  handler: async (ctx, { principal, input }) => {
    if (principal.mcp) await requireApproval(ctx, principal.mcp.approvalId, principal.organizationId, "events:manage");
    const brand = input.brandId === null ? undefined : brandId(ctx, input.brandId);
    const styleId = await organizationStyles.setOrganizationStyleBrand(ctx, { style: styleRef(ctx, input.style), brandId: brand }, principal.organizationId);
    return { styleId, brandId: input.brandId };
  },
});
