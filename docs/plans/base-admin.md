---
title: Align the shared event admin with Base design
status: COMPLETE
tier: Tier 1
created: 2026-09-06
updated: 2026-09-06
---

Style-editor work below is historical and superseded by [Defer style editor](defer-style-editor.md). The current Styles page supports selecting, previewing, and setting defaults for existing styles; authoring is deferred to the next MCP PR.


User requests Base styling for event admin regardless of custom event style, and asks whether the style editor can recreate Codex/Outpost. Current admin is already style-independent but uses beige paper surfaces; browser confirmed #e9e8e3 background and #f8f6ef panels. Presentation iframe remains independently branded. Custom editor supports colors, sans/serif/mono category and radius only; cannot recreate assets, exact display fonts, layout or background treatments of presets.

Implement scoped neutral white/gray surfaces, borders, spacing and typography using existing admin layout and shadcn controls. Remove Codex backdrop from admin route and apply same neutral treatment to initial skeleton. Preserve all control behavior, event data, authorization, preview branding and public surfaces. Scope CSS changes to admin, including portal theme variables. No new primitives or editor capabilities. No external config/deployment/data mutations. No blocking questions.

Verify actual admin before/after, preview stays branded, open/close existing menus and switch local All people/Lineup tabs without submitting mutations. Inspect full desktop screenshot and lower controls. Typecheck/lint and diff whitespace. Do not change live queue, timers, meeting settings, event type or test people. UI-only change, no new tests needed. Record exact rendered evidence and unverified states.

Verification: before #e9e8e3 background/#f8f6ef panels and Codex backdrop; after white background/panels, backdrop absent, preview retains custom dark event style. Desktop 1910x1075 screenshot inspected at /Users/demian/.codex/visualizations/2026/09/05/01a0715b-ed44-70a0-aec3-d83d37dd7e17/admin-base-desktop.png. No horizontal overflow. Switched Demoers/All people tabs; opened/cancelled test-people dialog without submission; form-link popover opens with QR. TSC, focused ESLint, git diff --check pass. No backend/schema changes or deployment. Other preset-specific admin events, populated tables and mobile not exercised; admin styling has no event-style branch. Existing operational actions intentionally not run. Custom editor expansion remains a recommendation, not implemented for a question-only request.
