# Organization admin MCP coverage

The coverage gate reads runtime Convex API references from every JavaScript and
TypeScript file under `app/` and `components/`. The UI sources determine the
inventory. It does not use the MCP catalog to decide which functions need tools.

Run `node scripts/mcp-admin-coverage.mjs` for a summary and failures, or add
`--json` for every source path, line, browser function, exclusion and tool mapping.
`node --test test/mcp-admin-coverage.test.mjs` checks the repository and scanner
fixtures. The normal `pnpm test` command includes this test file.

## Enabled browser contracts

The October 27, 2026 source inventory contains 57 distinct enabled organization
admin functions across 65 runtime references. Optimistic cache reads and writes
account for four repeated `events.getAdmin` references. Server loaders and live
components also share event and style reads.

| Workflow | Browser functions |
| --- | --- |
| Event workspace and creation | `events.listOrganizationEvents`, `events.createEvent`, `events.getOrganizationEventDetails` |
| Organization styles | `organizationStyles.list`, `organizationStyles.setPresetDefault`, `organizationStyles.setSavedDefault` |
| Full admin read | `events.getAdmin` |
| Queue and submissions | `events.publishQueue`, `events.hideSubmission`, `events.restoreSubmission`, `events.pickNext`, `events.skipCurrent`, `events.markNoShow`, `events.clearQueue`, `events.changeEventType`, `events.adminAddSubmission`, `events.adminAddTestSubmissions`, `events.updateSubmission`, `events.setLineupTarget`, `events.reorderLineup`, `events.moveToPool`, `events.restorePreviousPresenter`, `events.shuffleLineup`, `ai.aiShuffle` |
| Presentation controls | `events.setStageScreenMode`, `events.setSubmissionCountVisible`, `events.setStageMeetLinkVisible` |
| Stage timer | `events.setStageTimerVisible`, `events.setStageTimerDuration`, `events.startStageTimer`, `events.pauseStageTimer`, `events.resetStageTimer`, `events.adjustStageTimer` |
| Demo timer | `events.setDemoTimerVisible`, `events.setDemoTimerDuration`, `events.startDemoTimer`, `events.pauseDemoTimer`, `events.adjustDemoTimer` |
| Judging Sheet | `googleSheets.createJudgingSheet`, `events.requestJudgingSheetSync`, `events.saveRoundOneJudges` |
| Judging reads and access | `judging.getAdminProgress`, `judging.listJudgeAccess`, `judging.getJudgingTimer`, `judging.createJudgeAccess` |
| Judging preparation | `judging.closeSubmissions`, `judging.startAssignmentPreparation`, `judging.prepareAssignmentBatch` |
| Judging timer and state | `judging.setJudgingTimer`, `judging.startJudging`, `judging.addJudgingTime`, `judging.closeJudging`, `judging.reopenJudging` |
| Redistribution and normalization | `judging.previewRedistribution`, `judging.applyRedistribution`, `judging.getNormalizationOverview`, `judging.saveNormalizationDecision` |

New registrations use `defineAdminTool` with literal `name` and `browser`
properties in `convex/mcpTools.ts`. The browser value is `module.function`.
`LEGACY_ADMIN_TOOL_MAPPINGS` in that file owns the browser associations for the
existing `list_events`, `create_event`, `list_styles` and `set_default_style`
tools. Both default-style browser functions map to `set_default_style`.
The gate checks these legacy names against actual `registerTool` calls in
`convex/mcp.ts`. Existing `list_organizations`, `get_event` and `create_style`
remain available without a direct UI function association.

Multiple tools may associate with one enabled browser function when they expose
different authorized projections. Tool names must remain unique. A new tool
cannot associate with an unused backend function or a dormant control.

## Exact exclusions

Each exclusion matches both the source path and function. Removing the reference
fails the gate until its stale exclusion is removed. Adding the same function to
another source file requires a mapping or a separate, reasoned exclusion.

| Source path | Excluded browser functions | Reason |
| --- | --- | --- |
| `app/e/[slug]/ClientPage.tsx` | `events.getStage`, `events.submitDemo`, `events.submitHackathon` | Participant page. Admin tools do not submit as participants. |
| `app/stage/[slug]/ClientPage.tsx` | `events.getStage` | Public stage rendering. Presentation controls have separate admin contracts. |
| `app/s/[slug]/[token]/ClientPage.tsx` | `events.getParticipant`, `events.editParticipantContact`, `events.withdrawSubmission` | Participant capability operations. |
| `app/judge/[slug]/[token]/ClientPage.tsx` | `judging.getMyAssignments`, `judging.saveReview` | Judge capability operations. Admin tools do not submit judge reviews. |
| `app/metadata.ts` | `events.getEventMeta` | Public event title metadata, including admin navigation. Admin event reads already provide this information. |
| `app/metadata.ts` | `events.getParticipantMeta` | Participant title metadata. |
| `components/JudgingAdminPanel.tsx` | `judging.getFinalistDecision`, `judging.saveFinalistDraft`, `judging.submitFinalists`, `judging.savePlacementDraft`, `judging.submitPlacements` | Dormant finalist and placement controls. The gate requires exactly one literal `const SHOW_FINALIST_TOOLS = false` declaration. |

These are 16 exact source-path and function pairs, rather than broad role or
directory exemptions. Dormant functions must not receive tool mappings.

## Client-only behavior

Workspace navigation, event-detail and event-control links, opening the stage or
participant page, copying an existing URL, and opening an already linked Sheet
do not call a separate Convex operation. The same applies to opening video,
GitHub, contact and social links. Creating a Sheet and creating judge access do
call backend operations and are included above. Sensitive contact and private
judge-link projections require the corresponding explicit admin tool.

Organization selection and sign-in remain part of WorkOS authentication. The MCP
connection uses its OAuth-selected organization. Changing that selection requires
reauthorization rather than a tool that changes browser session state.

## What the check proves

The scanner uses the TypeScript parser and symbol table. It follows imported API
aliases, module aliases, function aliases, static element access and object
destructuring. It finds references inside hooks, server fetch calls and optimistic
update callbacks without depending on a list of hook names. Type-only references
and locally shadowed identifiers do not enter the runtime inventory. Dynamic API
lookup and unsupported API escapes fail the check instead of silently dropping
functions.

Fixture tests add an unmapped admin hook, wrap a mutation in
`withOptimisticUpdate`, use renamed and namespace imports, use nested and dynamic
destructuring, change the finalist flag, remove an excluded callsite, invent a
legacy registration association, and add a tool for an unused backend function.

This is function-reference coverage. It does not establish response-field parity,
shared business behavior, authorization, live persistence, native OAuth success,
or deployment. Those require the operation tests and separate live verification.
