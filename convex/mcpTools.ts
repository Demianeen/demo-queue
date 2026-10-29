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
];

export const ADMIN_TOOLS: RegisteredAdminTool[] = [
  defineAdminTool({
    name: "get_event_overview", browser: "events.getOrganizationEventDetails", input: operations.getEventOverviewInput, effect: "read",
    description: "Read the event summary, submission count, judging and confirmed results status.",
    invoke: (ctx, principal, input) => ctx.runQuery(internal.mcpAdmin.getEventOverview, { principal, input }),
  }),
  defineAdminTool({
    name: "get_event_admin", browser: "events.getAdmin", input: operations.getAdminInput, effect: "read",
    description: "Read event controls, all six submission groups, team and video links, stage/demo timers and Sheet sync state. Contacts and capability tokens are excluded.",
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
    description: "Change event type. Requires matching confirmation and confirmReset when submissions exist. Deletes submissions, team members and uploads, resets queue/timers and disconnects the Sheet. Does not delete the external Sheet.",
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
];

export function registerAdminTools(server: McpServer, ctx: ToolContext, user: ConnectUser, protect: Protect): void {
  const names = new Set<string>();
  for (const tool of ADMIN_TOOLS) {
    if (names.has(tool.name)) throw new Error("Duplicate admin tool name");
    names.add(tool.name);
    tool.register(server, ctx, user, protect);
  }
}
