---
title: Existing style selection and workspace page titles
status: COMPLETE
tier: standard
created: 2026-09-06
updated: 2026-09-06
---

Style-editor work below is historical and superseded by [Defer style editor](defer-style-editor.md). The current Styles page supports selecting, previewing, and setting defaults for existing styles; authoring is deferred to the next MCP PR.


## Scope

Reproduce missing built-in styles in Styles and stale browser title. Show Demo Queue, Codex and Outpost alongside saved organization styles; allow selecting an existing preset as the organization's default. Keep custom style editing intact. Synchronize page title with Styles, Events, and Create event views.

Persist built-in choices as optional preset references in organization-owned style records. Existing custom records need no transformation. Snapshot the selected preset on new events; existing event appearance remains unchanged. All mutations check authenticated org and expected org. Default flags remain mutually exclusive across custom and built-in styles.

Sequence: reproduce browser state, implement backend/default resolution and UI, run focused negative/default/legacy tests, sync only canonical development precious-elk-564, verify selections, default persistence and titles through the actual browser. Test default changes in Test and restore its previous default afterward. No production changes. Caching/loading improvements discussed earlier are separate from this fix.

Pre-fix evidence: actual Styles screen showed only New style and document.title remained Your organizations’ events | Demo Queue. Browser and local server bind to c23c.

Prevention: instructions for choosing an existing item must verify that the exact item class (built-in versus saved custom) is actually exposed by that UI. Backend support for one class does not establish availability of the other.

## Verification, September 6

- 42 Node tests and 18 Convex tests pass. TypeScript and focused ESLint pass. Canonical development sync completed at 15:44:58; production untouched.
- In the authenticated Test workspace, selected Outpost, saved it as default, reloaded, and verified event creation displayed Outpost / Organization default. Restored Demo Queue as default and verified after reload. Two preset records remain in Test; no new events or custom styles were created.
- Existing QA Midnight custom style loads in the editor; New style starts blank. Outpost's style library excludes Test's custom style and its default remains Demo Queue.
- Browser titles verified for Events in Test, Create event in Outpost, and Styles in both organizations. A full-refresh check exposed a conflict between imperative document.title and streamed metadata; replaced both competing title writers with a single React title owner for the workspace.
- Rendered screenshot inspected: /Users/demian/.codex/visualizations/2026/09/05/01a0715b-ed44-70a0-aec3-d83d37dd7e17/style-selection-fixed.png. Shows all built-in choices, selected Outpost preview, and default action at 813×872 capture size.
- Loading optimization remains a separate DRAFT. No production build, deployment, or new mobile verification in this fix.
