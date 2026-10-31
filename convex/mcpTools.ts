import { type CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { createTool } from "@convex-dev/mcp";
import { componentToolCall, toolFailure } from "./mcpRuntime";
import type { Id } from "./_generated/dataModel";
import { v, type PropertyValidators, type ObjectType, type VObject } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { OrganizationPrincipal } from "./organizationAuth";
import type { ConnectUser } from "./mcpAuth";
import { adminToolSchema } from "./mcpSchema";
import * as operations from "./mcpAdmin";
import { aiShuffleArgs, createJudgingSheetArgs } from "./adminActionArgs";

const componentTool = createTool<Id<"mcpApprovals">>();
type ToolContext = Pick<ActionCtx, "runQuery" | "runMutation" | "runAction">;
type Protect = (organizationId: string, operation: () => Promise<unknown>) => Promise<CallToolResult>;
type Effect = "read" | "sensitive" | "write" | "destructive" | "action";
type RegisteredAdminTool = {
  name: string;
  browser: string;
  effect: Effect;
  component: ReturnType<typeof componentTool>;
  register: (server: McpServer, ctx: ToolContext, user: ConnectUser, protect: Protect) => void;
};

function defineAdminTool<Fields extends PropertyValidators>(definition: {
  name: string;
  browser: string;
  input: VObject<ObjectType<Fields>, Fields, "required", string>;
  effect: Effect;
  description: string;
  invoke: (ctx: ToolContext, principal: OrganizationPrincipal, input: ObjectType<Fields>) => Promise<unknown>;
}): RegisteredAdminTool {
  return {
    name: definition.name,
    browser: definition.browser,
    effect: definition.effect,
    component: componentTool({
      description: definition.description,
      args: { organizationId: v.string(), ...definition.input.fields },
      scope: definition.effect === "read" ? "events:read" : "events:manage",
      annotations: {
        readOnlyHint: definition.effect === "read" || definition.effect === "sensitive",
        destructiveHint: definition.effect === "destructive", idempotentHint: false,
        openWorldHint: definition.effect === "action",
      },
      handler: async (ctx, args, user) => {
        try {
          const parsed = await adminToolSchema(definition.input)["~standard"].validate(args);
          if (parsed.issues) throw new Error("Invalid tool arguments");
          const { organizationId, input } = parsed.value;
          return componentToolCall(ctx, user, organizationId,
            definition.effect === "read" ? "events:read" : "events:manage",
            (principal) => definition.invoke(ctx, principal, input));
        } catch (error) { return toolFailure(error); }
      },
    }),
    register(server: McpServer, ctx: ToolContext, user: ConnectUser, protect: Protect) {
      server.registerTool(definition.name, {
        description: definition.description,
        inputSchema: adminToolSchema(definition.input),
        annotations: {
          readOnlyHint: definition.effect === "read" || definition.effect === "sensitive",
          destructiveHint: definition.effect === "destructive",
          idempotentHint: false,
        },
      }, ({ organizationId, input }) => protect(organizationId, () => definition.invoke(ctx, {
        organizationId: user.organizationId, actor: user.actor,
      }, input)));
    },
  };
}

export const LEGACY_ADMIN_TOOL_MAPPINGS = [
  { name: "list_events", browser: "events.listOrganizationEvents" },
  { name: "create_event", browser: "events.createEvent" },
  { name: "list_styles", browser: "organizationStyles.list" },
  { name: "set_default_style", browser: "organizationStyles.setPresetDefault" },
  { name: "set_default_style", browser: "organizationStyles.setSavedDefault" },
  { name: "set_default_style", browser: "organizationStyles.clearDefault" },
];

export const ADMIN_TOOLS: RegisteredAdminTool[] = [
  defineAdminTool({
    name: "create_style_brand", browser: "organizationStyles.createBrand", input: operations.createStyleBrandInput, effect: "write",
    description: "Make a brand to group styles by, such as a sponsor, and optionally put one style in it. list_styles shows brands and each style's brandId.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.createStyleBrand, { principal, input }),
  }),
  defineAdminTool({
    name: "rename_style_brand", browser: "organizationStyles.renameBrand", input: operations.renameStyleBrandInput, effect: "write",
    description: "Rename a style brand. Its styles stay in it.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.renameStyleBrand, { principal, input }),
  }),
  defineAdminTool({
    name: "set_style_brand", browser: "organizationStyles.setStyleBrand", input: operations.setStyleBrandInput, effect: "write",
    description: "Put a built-in or saved style in a brand, or in no brand with brandId null. Events are not changed.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setStyleBrand, { principal, input }),
  }),
  defineAdminTool({
    name: "get_event_overview", browser: "events.getOrganizationEventDetails", input: operations.getEventOverviewInput, effect: "read",
    description: "Read the event summary, submission count, judging and confirmed results status.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.getEventOverview, { principal, input }),
  }),
  defineAdminTool({
    name: "get_event_admin", browser: "events.getAdmin", input: operations.getAdminInput, effect: "read",
    description: "Read event controls, tracks and their ids, all six submission groups, team and video links, stage/demo timers and Sheet sync state. Contacts and capability tokens are excluded.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.getEventAdmin, { principal, input }),
  }),
  defineAdminTool({
    name: "get_submission_contacts", browser: "events.getAdmin", input: operations.getSubmissionContactsInput, effect: "sensitive",
    description: "Explicit sensitive read of one submission's contact/social fields and team-member contacts.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.getSubmissionContacts, { principal, input }),
  }),
  defineAdminTool({
    name: "add_submission", browser: "events.adminAddSubmission", input: operations.addSubmissionInput, effect: "write",
    description: "Add one demo submission to the lineup or pool. Participant capability is generated privately.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.addSubmission, { principal, input }),
  }),
  defineAdminTool({
    name: "add_test_submissions", browser: "events.adminAddTestSubmissions", input: operations.addTestSubmissionsInput, effect: "write",
    description: "Add 1 to 25 test submissions per call, including hackathon teams. All participant capabilities are generated privately.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.addTestSubmissions, { principal, input }),
  }),
  defineAdminTool({
    name: "save_judges", browser: "events.saveRoundOneJudges", input: operations.saveRoundOneJudgesInput, effect: "write",
    description: "Save the event's round-one judge roster, preserving existing assignment/review constraints.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.saveRoundOneJudges, { principal, input }),
  }),
  defineAdminTool({
    name: "change_event_type", browser: "events.changeEventType", input: operations.changeEventTypeInput, effect: "destructive",
    description: "Change event type. Requires matching confirmation and confirmReset when submissions exist. Deletes submissions, team members and uploads, resets queue/timers and disconnects the Sheet. Does not delete the external Sheet. A demo night needs a meetUrl: pass one when the event has none.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.changeEventType, { principal, input }),
  }),
  defineAdminTool({
    name: "request_judging_sheet_sync", browser: "events.requestJudgingSheetSync", input: operations.requestJudgingSheetSyncInput, effect: "write",
    description: "Request asynchronous Sheet synchronization. Read get_event_admin revisions and errors to verify completion.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.requestJudgingSheetSync, { principal, input }),
  }),
  defineAdminTool({
    name: "update_submission", browser: "events.updateSubmission", input: operations.updateSubmissionInput, effect: "write",
    description: "Edit submission text and contact fields with the same validation as the admin app.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.updateSubmission, { principal, input }),
  }),
  defineAdminTool({
    name: "publish_queue", browser: "events.publishQueue", input: operations.publishQueueInput, effect: "write",
    description: "Publish the lineup and switch the stage to demo mode.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.publishQueue, { principal, input }),
  }),
  defineAdminTool({
    name: "set_stage_screen_mode", browser: "events.setStageScreenMode", input: operations.setStageScreenModeInput, effect: "write",
    description: "Choose the stage's QR or demo screen.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setStageScreenMode, { principal, input }),
  }),
  defineAdminTool({
    name: "set_submission_count_visible", browser: "events.setSubmissionCountVisible", input: operations.setSubmissionCountVisibleInput, effect: "write",
    description: "Show or hide the submission count on the stage.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setSubmissionCountVisible, { principal, input }),
  }),
  defineAdminTool({
    name: "set_stage_meet_link_visible", browser: "events.setStageMeetLinkVisible", input: operations.setStageMeetLinkVisibleInput, effect: "write",
    description: "Show or hide the meet link on the published stage.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setStageMeetLinkVisible, { principal, input }),
  }),
  defineAdminTool({
    name: "set_stage_timer_visible", browser: "events.setStageTimerVisible", input: operations.setStageTimerVisibleInput, effect: "write",
    description: "Show or hide the stage timer.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setStageTimerVisible, { principal, input }),
  }),
  defineAdminTool({
    name: "set_stage_results_show_finalists", browser: "events.setStageResultsShowFinalists", input: operations.setStageResultsShowFinalistsInput, effect: "write",
    description: "Choose what the stage shows once the event finishes: the winners and the other finalists (true) or the winners only (false).",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setStageResultsShowFinalists, { principal, input }),
  }),
  defineAdminTool({
    name: "set_stage_timer_duration", browser: "events.setStageTimerDuration", input: operations.setStageTimerDurationInput, effect: "write",
    description: "Set the stage timer duration in milliseconds.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setStageTimerDuration, { principal, input }),
  }),
  defineAdminTool({
    name: "start_stage_timer", browser: "events.startStageTimer", input: operations.startStageTimerInput, effect: "write",
    description: "Start or resume the stage timer with an optional duration.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.startStageTimer, { principal, input }),
  }),
  defineAdminTool({
    name: "set_demo_timer_visible", browser: "events.setDemoTimerVisible", input: operations.setDemoTimerVisibleInput, effect: "write",
    description: "Show or hide the current demo timer.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setDemoTimerVisible, { principal, input }),
  }),
  defineAdminTool({
    name: "set_demo_timer_duration", browser: "events.setDemoTimerDuration", input: operations.setDemoTimerDurationInput, effect: "write",
    description: "Set the demo timer duration in milliseconds.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setDemoTimerDuration, { principal, input }),
  }),
  defineAdminTool({
    name: "start_demo_timer", browser: "events.startDemoTimer", input: operations.startDemoTimerInput, effect: "write",
    description: "Start or resume the current demo timer.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.startDemoTimer, { principal, input }),
  }),
  defineAdminTool({
    name: "pause_demo_timer", browser: "events.pauseDemoTimer", input: operations.pauseDemoTimerInput, effect: "write",
    description: "Pause the current demo timer.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.pauseDemoTimer, { principal, input }),
  }),
  defineAdminTool({
    name: "adjust_demo_timer", browser: "events.adjustDemoTimer", input: operations.adjustDemoTimerInput, effect: "write",
    description: "Adjust remaining demo time by a signed millisecond delta.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.adjustDemoTimer, { principal, input }),
  }),
  defineAdminTool({
    name: "pause_stage_timer", browser: "events.pauseStageTimer", input: operations.pauseStageTimerInput, effect: "write",
    description: "Pause the stage timer.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.pauseStageTimer, { principal, input }),
  }),
  defineAdminTool({
    name: "reset_stage_timer", browser: "events.resetStageTimer", input: operations.resetStageTimerInput, effect: "write",
    description: "Reset and hide the stage timer, optionally setting a duration.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.resetStageTimer, { principal, input }),
  }),
  defineAdminTool({
    name: "adjust_stage_timer", browser: "events.adjustStageTimer", input: operations.adjustStageTimerInput, effect: "write",
    description: "Adjust remaining stage time by a signed millisecond delta.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.adjustStageTimer, { principal, input }),
  }),
  defineAdminTool({
    name: "hide_submission", browser: "events.hideSubmission", input: operations.hideSubmissionInput, effect: "write",
    description: "Hide a submission from the active lineup/pool.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.hideSubmission, { principal, input }),
  }),
  defineAdminTool({
    name: "restore_submission", browser: "events.restoreSubmission", input: operations.restoreSubmissionInput, effect: "write",
    description: "Restore a hidden or inactive submission to the pool.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.restoreSubmission, { principal, input }),
  }),
  defineAdminTool({
    name: "reorder_lineup", browser: "events.reorderLineup", input: operations.reorderLineupInput, effect: "write",
    description: "Order eligible submissions into the lineup. Omitted existing lineup entries are not removed.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.reorderLineup, { principal, input }),
  }),
  defineAdminTool({
    name: "shuffle_lineup", browser: "events.shuffleLineup", input: operations.shuffleLineupInput, effect: "write",
    description: "Randomly select and order presenters up to the lineup target.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.shuffleLineup, { principal, input }),
  }),
  defineAdminTool({
    name: "move_to_pool", browser: "events.moveToPool", input: operations.moveToPoolInput, effect: "write",
    description: "Move a submission out of the lineup into the pool.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.moveToPool, { principal, input }),
  }),
  defineAdminTool({
    name: "set_lineup_target", browser: "events.setLineupTarget", input: operations.setLineupTargetInput, effect: "write",
    description: "Set the lineup target, clamped to the app's supported range.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setLineupTarget, { principal, input }),
  }),
  defineAdminTool({
    name: "mark_no_show", browser: "events.markNoShow", input: operations.markNoShowInput, effect: "write",
    description: "Mark the current presenter as a no-show in a published queue.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.markNoShow, { principal, input }),
  }),
  defineAdminTool({
    name: "advance_presenter", browser: "events.pickNext", input: operations.pickNextInput, effect: "write",
    description: "Finish the current presenter, advance the published queue and reset its demo timer.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.pickNext, { principal, input }),
  }),
  defineAdminTool({
    name: "restore_previous_presenter", browser: "events.restorePreviousPresenter", input: operations.restorePreviousPresenterInput, effect: "write",
    description: "Undo the last advance and restore the previous presenter and timer snapshot.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.restorePreviousPresenter, { principal, input }),
  }),
  defineAdminTool({
    name: "skip_current_presenter", browser: "events.skipCurrent", input: operations.skipCurrentInput, effect: "write",
    description: "Move the current presenter to the back of a published lineup.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.skipCurrent, { principal, input }),
  }),
  defineAdminTool({
    name: "clear_queue", browser: "events.clearQueue", input: operations.clearQueueInput, effect: "destructive",
    description: "Requires matching clear_queue confirmation. Deletes submissions, team members and uploads, resets queue/timers and disconnects the Sheet. Retains the external Sheet. Do not call without explicit approval of this event's data loss.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.clearQueue, { principal, input }),
  }),
  defineAdminTool({
    name: "list_judge_links", browser: "judging.listJudgeAccess", input: operations.listJudgeLinksInput, effect: "sensitive",
    description: "Explicit sensitive read of private judge links and their active states. Paths are relative to the app origin. Never include them in public event metadata.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.listJudgeLinks, { principal, input }),
  }),
  defineAdminTool({
    name: "create_judge_link", browser: "judging.createJudgeAccess", input: operations.createJudgeLinkInput, effect: "write",
    description: "Create or rotate a roster judge's private link. Returns a sensitive path relative to the app origin; rotation replaces that judge's old token.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.createJudgeLink, { principal, input }),
  }),
  defineAdminTool({
    name: "close_submissions", browser: "judging.closeSubmissions", input: operations.closeSubmissionsInput, effect: "write",
    description: "Close hackathon submissions before preparing judging assignments.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.closeSubmissions, { principal, input }),
  }),
  defineAdminTool({
    name: "start_assignment_preparation", browser: "judging.startAssignmentPreparation", input: operations.startAssignmentPreparationInput, effect: "write",
    description: "Begin assignment preparation. Then call prepare_assignment_batch repeatedly until done=true.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.startAssignmentPreparation, { principal, input }),
  }),
  defineAdminTool({
    name: "prepare_assignment_batch", browser: "judging.prepareAssignmentBatch", input: operations.prepareAssignmentBatchInput, effect: "write",
    description: "Prepare one resumable assignment batch of up to 50 submissions. Repeat until done=true.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.prepareAssignmentBatch, { principal, input }),
  }),
  defineAdminTool({
    name: "preview_redistribution", browser: "judging.previewRedistribution", input: operations.previewRedistributionInput, effect: "read",
    description: "Preview reassignment of unfinished reviews for an unavailable judge. Completed reviews are preserved.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.previewRedistribution, { principal, input }),
  }),
  defineAdminTool({
    name: "apply_redistribution", browser: "judging.applyRedistribution", input: operations.applyRedistributionInput, effect: "write",
    description: "Apply the exact current redistribution preview and deactivate the unavailable judge link. Rejects stale or incomplete assignments.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.applyRedistribution, { principal, input }),
  }),
  defineAdminTool({
    name: "get_judging_progress", browser: "judging.getAdminProgress", input: operations.getAdminProgressInput, effect: "read",
    description: "Read assignments, raw scores, reviews and judging progress. Closed-round normalized scores are supplied separately by get_normalization_overview.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.getAdminProgress, { principal, input }),
  }),
  defineAdminTool({
    name: "set_judging_timer", browser: "judging.setJudgingTimer", input: operations.setJudgingTimerInput, effect: "write",
    description: "Set configured judging duration in milliseconds, with the app's clamping behavior.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setJudgingTimer, { principal, input }),
  }),
  defineAdminTool({
    name: "start_judging", browser: "judging.startJudging", input: operations.startJudgingInput, effect: "write",
    description: "Start judging after assignment preparation is ready.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.startJudging, { principal, input }),
  }),
  defineAdminTool({
    name: "add_judging_time", browser: "judging.addJudgingTime", input: operations.addJudgingTimeInput, effect: "write",
    description: "Adjust judging time by a millisecond delta using the app's timer operation.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.addJudgingTime, { principal, input }),
  }),
  defineAdminTool({
    name: "close_judging", browser: "judging.closeJudging", input: operations.closeJudgingInput, effect: "write",
    description: "Close an open judging round and lock judge review writes.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.closeJudging, { principal, input }),
  }),
  defineAdminTool({
    name: "reopen_judging", browser: "judging.reopenJudging", input: operations.reopenJudgingInput, effect: "write",
    description: "Reopen a closed judging round with the retained remaining time.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.reopenJudging, { principal, input }),
  }),
  defineAdminTool({
    name: "get_judging_timer", browser: "judging.getJudgingTimer", input: operations.getJudgingTimerInput, effect: "read",
    description: "Read judging status, timer status, remaining milliseconds and server time.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.getJudgingTimer, { principal, input }),
  }),
  defineAdminTool({
    name: "get_normalization_overview", browser: "judging.getNormalizationOverview", input: operations.getNormalizationOverviewInput, effect: "read",
    description: "Read normalized and raw score previews, low-data warnings, basis readiness/version and per-judge decisions.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.getNormalizationOverview, { principal, input }),
  }),
  defineAdminTool({
    name: "save_normalization_decision", browser: "judging.saveNormalizationDecision", input: operations.saveNormalizationDecisionInput, effect: "write",
    description: "Choose normalized or raw scoring for one contributing judge after judging closes.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.saveNormalizationDecision, { principal, input }),
  }),
  defineAdminTool({
    name: "ai_shuffle", browser: "ai.aiShuffle", input: aiShuffleArgs, effect: "action",
    description: "Curate the lineup with AI using only names, titles and categories. Performs a real provider request; read the lineup after completion.",
    invoke: (ctx, principal, input) => ctx.runAction(internal.ai.aiShuffleMcp, { principal, input }),
  }),
  defineAdminTool({
    name: "create_judging_sheet", browser: "googleSheets.createJudgingSheet", input: createJudgingSheetArgs, effect: "action",
    description: "Create or reuse the event's real Google judging Sheet. Checks folder access, formats the file, resolves concurrent saves and schedules sync.",
    invoke: (ctx, principal, input) => ctx.runAction(internal.googleSheets.createJudgingSheetMcp, { principal, input }),
  }),
  defineAdminTool({
    name: "preview_phase_change", browser: "phases.previewPhaseChange", input: operations.previewPhaseChangeInput, effect: "read",
    description: "Read what moving the event to a phase (submissions, judging, stage, finished) will do, with each effect's text for the confirmation. Changes nothing.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.previewPhaseChange, { principal, input }),
  }),
  defineAdminTool({
    name: "set_phase", browser: "phases.setPhase", input: operations.setPhaseInput, effect: "write",
    description: "Move the event to any phase in either direction. Going back to submissions reopens the submit link and pauses a running judging timer, keeping every score. Call preview_phase_change first and confirm its effects with the person.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setPhase, { principal, input }),
  }),
  defineAdminTool({
    name: "reopen_submissions", browser: "phases.reopenSubmissions", input: operations.reopenSubmissionsInput, effect: "write",
    description: "Reopen a hackathon's submit link. Pauses a running judging timer; scores are kept and judges cannot score until submissions close again.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.reopenSubmissions, { principal, input }),
  }),
  defineAdminTool({
    name: "set_judging_time_left", browser: "judging.setJudgingTimeLeft", input: operations.setJudgingTimeLeftInput, effect: "write",
    description: "Set the judging timer to an exact time left in milliseconds. A running timer keeps running from the new time.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setJudgingTimeLeft, { principal, input }),
  }),
  defineAdminTool({
    name: "pause_judging_timer", browser: "judging.pauseJudgingTimer", input: operations.pauseJudgingTimerInput, effect: "write",
    description: "Pause the running judging timer. Judges can still score.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.pauseJudgingTimer, { principal, input }),
  }),
  defineAdminTool({
    name: "resume_judging_timer", browser: "judging.resumeJudgingTimer", input: operations.resumeJudgingTimerInput, effect: "write",
    description: "Resume a paused judging timer from the time it had left.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.resumeJudgingTimer, { principal, input }),
  }),
  defineAdminTool({
    name: "set_stage_timer_remaining", browser: "events.setStageTimerRemaining", input: operations.setStageTimerRemainingInput, effect: "write",
    description: "Set the stage timer to an exact time left in milliseconds.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setStageTimerRemaining, { principal, input }),
  }),
  defineAdminTool({
    name: "list_recent_changes", browser: "changes.listRecentChanges", input: operations.listRecentChangesInput, effect: "read",
    description: "Read the event's recent organiser changes, newest first, with who made them, whether an assistant did, and whether each can be undone (and why not).",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.listRecentChanges, { principal, input }),
  }),
  defineAdminTool({
    name: "undo_change", browser: "changes.undoChange", input: operations.undoChangeInput, effect: "write",
    description: "Undo one change from list_recent_changes. Refuses, changing nothing, when a later change touched the same data or the event moved on; the error names what to undo first.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.undoChange, { principal, input }),
  }),
  defineAdminTool({
    name: "get_judges_overview", browser: "judging.getJudgesOverview", input: operations.getJudgesOverviewInput, effect: "sensitive",
    description: "Explicit sensitive read of the Judges table: each judge's private link path, when they opened it, scored and helped counts, and totals. Never share link paths publicly.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.getJudgesOverview, { principal, input }),
  }),
  defineAdminTool({
    name: "replace_judge_link", browser: "judging.replaceJudgeLink", input: operations.replaceJudgeLinkInput, effect: "write",
    description: "Give a judge a new private link. The old link stops working at once; their scores stay. Returns the new sensitive path.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.replaceJudgeLink, { principal, input }),
  }),
  defineAdminTool({
    name: "move_judge_scores", browser: "judging.moveJudgeScores", input: operations.moveJudgeScoresInput, effect: "write",
    description: "Move scores from one judge to another, for when someone scored on the wrong link. All of the first judge's scores, or only submissionIds. Refuses a project both judges scored.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.moveJudgeScores, { principal, input }),
  }),
  defineAdminTool({
    name: "set_judge_link_active", browser: "judging.deactivateJudgeAccess", input: operations.setJudgeLinkActiveInput, effect: "write",
    description: "Turn a judge's private link off or back on. Their scores stay.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setJudgeLinkActive, { principal, input }),
  }),
  defineAdminTool({
    name: "get_live_event", browser: "events.getLiveEvent", input: operations.getLiveEventInput, effect: "read",
    description: "Read the organization's live event: the newest real event that is not finished, with its phase. Never a practice event. Null when there is none.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.getLiveEvent, { principal, input }),
  }),
  defineAdminTool({
    name: "create_practice_event", browser: "practice.createPracticeEvent", input: operations.createPracticeEventInput, effect: "action",
    description: "Make a practice event: a copy of a real event (start kind copy with its slug) or a blank hackathon or demo night, with 0 to 50 test submissions and 0 or 2 to 10 test judges. Test people get plus-addresses of your email, so their emails reach you. practiceAiSummaries is \"sample\" (the default: sample summaries, no model cost) or \"model\" (the real AI model, which costs money per project). Never touches the real event.",
    invoke: (ctx, principal, input) => ctx.runAction(internal.practice.createPracticeEventMcp, { principal, input: { ...input, expectedOrganizationId: principal.organizationId } }),
  }),
  defineAdminTool({
    name: "list_practice_events", browser: "practice.listPracticeEvents", input: operations.listPracticeEventsInput, effect: "read",
    description: "Read the organization's practice events, newest first, with who made each and when it will be tidied away. Practice events never appear in list_events.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.listPracticeEvents, { principal, input }),
  }),
  defineAdminTool({
    name: "add_practice_submissions", browser: "practice.addPracticeSubmissions", input: operations.addPracticeSubmissionsInput, effect: "write",
    description: "Add 1 to 50 test submissions to a practice event through the real submit form code, with random tracks. Practice events only.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.addPracticeSubmissions, { principal, input }),
  }),
  defineAdminTool({
    name: "score_as_test_judges", browser: "practice.scoreAsTestJudges", input: operations.scoreAsTestJudgesInput, effect: "write",
    description: "Have the test judges score their own unscored projects with whole numbers, up to limit reviews (all when left out). Practice events only, while judging is open.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.scoreAsTestJudges, { principal, input }),
  }),
  defineAdminTool({
    name: "skip_practice_timer", browser: "practice.skipTimerToLastSeconds", input: operations.skipPracticeTimerInput, effect: "write",
    description: "Jump a running timer (judging, stage or demo; the running one when left out) to its last seconds, 10 by default. Practice events only.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.skipPracticeTimer, { principal, input }),
  }),
  defineAdminTool({
    name: "set_practice_ai_summaries", browser: "practice.setPracticeAiSummaries", input: operations.setPracticeAiSummariesInput, effect: "write",
    description: "Switch a practice event's AI summaries: mode \"sample\" writes sample summaries with no model call, \"model\" uses the real AI model (costs money per project). Replaces the other kind of summary straight away. Undoable. Practice events only.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.setPracticeAiSummaries, { principal, input }),
  }),
  defineAdminTool({
    name: "reset_practice_event", browser: "practice.resetPracticeEvent", input: operations.resetPracticeEventInput, effect: "destructive",
    description: "Requires matching reset_practice_event confirmation. Takes a practice event back to the start: deletes its scores, assignments and lineup, and its test submissions too when keepSubmissions is false. Cannot be undone. Practice events only.",
    invoke: (ctx, principal, input) => ctx.runMutation(internal.mcpAdmin.resetPracticeEvent, { principal, input }),
  }),
];

export function registerAdminTools(server: McpServer, ctx: ToolContext, user: ConnectUser, protect: Protect): void {
  const names = new Set<string>();
  for (const tool of ADMIN_TOOLS) {
    if (names.has(tool.name)) throw new Error("Duplicate admin tool name");
    names.add(tool.name);
    tool.register(server, ctx, user, protect);
  }
}
