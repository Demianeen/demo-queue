---
title: Neutral organization workspace and event styles
status: COMPLETE
tier: standard
created: 2026-09-05
updated: 2026-09-05
---

Style-editor work below is historical and superseded by [Defer style editor](defer-style-editor.md). The current Styles page supports selecting, previewing, and setting defaults for existing styles; authoring is deferred to the next MCP PR.


## Accepted target

The user's final attachment `codex-clipboard-81867fdd-eed5-4595-bf5d-8ba305937a67.png` is authoritative. White canvas, plain text Demo Queue header, membership switcher, Events / Styles navigation, profile menu. At 1487px: 1243px content width, 483px form, 670px preview, 89px gap. Heading at y164; controls start y325. Small bordered corners and black primary action. Preview shows the initial join screen, not a sample live lineup.

## Boundaries and sequence

1. Replace the redundant landing with the authenticated workspace entry; retain device-saved capability links on a dedicated accessible page.
2. Build the selected responsive workspace using existing shadcn primitives, first-event creation, live preview, membership switcher and working account navigation.
3. Add neutral event styling and organization-owned saved color/font/radius styles with an organization default. Snapshot style values on event creation. Existing persisted events retain Codex/Outpost rendering. No data backfill.
4. Test org isolation, stale-organization writes, snapshot behavior, existing event compatibility, typecheck, lint, and actual desktop/mobile UI.

Only canonical development `precious-elk-564` may be synchronized. No production or WorkOS configuration mutations. Existing invitation-only checks and capability routes remain enforced. Direct Google OAuth and replacement of the hosted WorkOS organization chooser require separate authentication implementation and are not changed by the visual redesign.

## Verification

Compare against the exact reference and record rendered evidence in `design-qa.md`. Authenticated browser verification needs the user to finish Google sign-in in the existing in-app tab; requested while implementation continues. No fabricated auth or mock route substitutes.

## Material behavior

New events use the organization's default style unless explicitly selected. Saved styles are available only within the authenticated organization. Existing events retain a copied style when the organization edits its styles. Styling fields in this implementation: name, background, foreground, accent, font, and corner radius; image uploads and custom page layouts are outside this implementation.

## Implementation and evidence

- Neutral workspace, membership-only header switcher, Events/Styles/profile navigation, first-event creation, responsive two-column layout, shared welcome preview, organization style editor, and preserved device-saved links are implemented.
- Development sync succeeded on `precious-elk-564` at 14:24 September 5. The existing Convex AuthKit dev integration also reapplied its unchanged localhost homepage URL during sync.
- 16 Convex tests pass, including style ownership, stale-org writes, snapshots, single-default behavior, invalid tokens and legacy Codex fallback. All 42 existing Node tests pass. TypeScript, focused ESLint covering all changed source surfaces, and `git diff --check` pass.
- Independent architecture review approves, 9/10. A delayed-save editor-selection race was fixed by disabling library selection while saving; prevention check: asynchronous completion must not switch away from a newer draft.
- Rendered `/events` signed-out desktop inspected at 1910×1075, white background, no overflow or browser errors. `/saved` navigation and existing links load correctly. Narrow viewport DOM measured 389×845 without overflow; mobile screenshot capture is not valid evidence because browser emulation produced a cropped/scaled image.
- Authenticated creation, style editor, event creation/switching, dark custom styles, and reference fidelity remain unverified pending Google login. No auth bypass or fake route was used.
- No production deployment, commits, pushes, image uploads, custom layout editor, direct Google bypass, or hosted organization-picker replacement. Existing Codex/Outpost presets remain selectable for new events and unchanged for old ones. Saved styles currently customize colors, font family, and radius only.


## Final verification update

Google's existing invited account session allowed the real callback to complete. Browser checks now verify Outpost and Test membership switching, authenticated event listing and creation, Demo/Hackathon preview changes, draft preservation across Events/Styles, account-menu navigation, style saving, and cross-org style isolation. The dark style was confirmed on the created event presentation and public submission form, including input contrast. One labeled QA style and event remain in Test (`QA Midnight – Sep 5`, `QA workspace styling Sep 5`); Outpost data/defaults were untouched.

`design-qa.md` passes desktop comparison. Final screenshot is `workspace-final.png` under the task visualization directory. Responsive DOM checks pass at 389×845 with one column, no horizontal overflow, 68px event-type tiles and 56px create action. The browser's mobile screenshot emulation remains unreliable; no mobile image fidelity claim is made. All emulation overrides were cleared. User browser is restored to Outpost first-event creation.

Remaining scope limits: no production build/deploy, commits/pushes, direct-Google bypass, replacement hosted org picker, image uploads or custom layouts. Browser logout, live published countdowns, and participant-status theming were not exercised in this pass. Backend legacy/access/snapshot tests cover their contracts where applicable. Product context uses current authenticated organization from WorkOS; no new remembered-org storage or automatic single-membership selection was added.
