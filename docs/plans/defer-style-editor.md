---
title: Defer style authoring to the MCP PR
status: COMPLETE
tier: Tier 1
created: 2026-09-06
updated: 2026-09-06
---

User: "Okay, maybe the styles bit would be done separately in the next pr that would add mcp. No need for the style editor for now"

Remove New style and StyleEditor from the human UI. Keep built-in and already saved styles selectable with previews and organization-default action. Update event-creation copy so it no longer promises customization. Preserve persisted styles/event snapshots and existing save API compatibility. Add a narrow saved-style default mutation that updates default flags only, enforcing the existing organization guard. No schema/data transformation. Sync only canonical dev if existing setup is ready; production untouched.

Validation: organization-default mutation tests for auth/stale org/foreign style and preserving current style values; tsc/focused lint; live /styles built-in/custom previews, no editor controls and event creation helper copy. No actual organization default change needed for browser QA. Follow-up Linear ticket requires approval per defer-to-ticket; draft below preserves user's wording.

## Follow-up ticket draft

Title: Add MCP for our app and agent-created styles

"I want to add the mcp for our app and it is mostly important that agent can create styles, I don't think humans would actually create it"

"I want to bring the ability to create styles like this for anyone"

"the styles bit would be done separately in the next pr that would add mcp. No need for the style editor for now"

Verification: StyleEditor/New style removed; browser Base/Codex/Outpost and existing QA Midnight previews work, custom preview remains dark, no authoring fields. Event creation helper now describes style/default selection only. Six organizationStyles tests, TypeScript, focused ESLint and whitespace checks pass. Dev sync precious-elk-564 completed 17:33:09. No records/defaults mutated during browser QA. Existing save API and persisted theme snapshots retained for compatibility. MCP/style authoring deferred; Linear ticket draft not created pending approval. Screenshot styles-selection-only.png in task evidence directory.
