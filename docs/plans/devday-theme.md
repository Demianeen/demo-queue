---
title: DevDay Exchange Community Hackathon event theme
status: COMPLETE
tier: Tier 2
created: 2026-10-27
updated: 2026-10-27
---

Add DevDay as a fourth visual style, using the established character-dot geometry and fluid movement from Motion Studio. Keep existing event workflows and privacy boundaries intact.

1. Extend the shared theme registry; retain existing theme defaults and stored event behavior.
2. Theme the creator, public submission and participant pages, live stage, QR screen and embedded preview.
3. Use native vector characters, circular bodies, original optical eye placement, bounded gaze and quick straight-dash winks. Respect reduced motion. Use black/white, OpenAI Sans and the flat DevDay palette.
4. Provide a development-only, fixture-backed preview of the real components without configuring Convex or writing event data.
5. Verify types, lint, unit/in-memory backend tests, build, desktop/mobile layouts, form interactions and stage states.
6. Show locally for review, then submit the reviewed theme as a pull request. Deployment and live-event changes remain separate release work.

## Visual direction

Editorial split layout: OpenAI / DevDay Exchange Community Hackathon lockup, large black type and a cropped purple circle in the white hero. A smaller green character provides contrast with no body overlap. Form controls remain calm and readable. Stage queue uses a black side panel and green next-presenter highlight. Existing controls are retained. The generated concept is a layout reference only; final characters are exact native vector paths.

Tokens: paper #FFFFFF, ink #000000, charcoal #262626, purple #924FF7, blue #006AFF, orange #F26D00, green #00AB44, grey #DFDFDF. Square panel geometry, 6px field corners, no decorative gradients or shadows.

## Local review

Run `DEMO_QUEUE_THEME_PREVIEW=1 pnpm dev:next --hostname 127.0.0.1 --port 3000`, then open `http://127.0.0.1:3000/theme-preview/devday`.

The route and provider bypass both require development mode plus the explicit flag. Normal production configuration still validates the backend URL. No environment file or deployment setup was created. The preview uses real page components and synthetic in-memory callbacks; no live submissions are sent.

## Validation

- 48 Node unit tests and 15 in-memory Convex tests passed, including DevDay persistence, query propagation and preservation on event edits.
- Full TypeScript, ESLint and optimized production build passed. Build used the existing canonical development URL as a process-only value; no Convex CLI/deployment was run.
- In-app browser verified 1280x720 and 390x844 layouts, real form phone validation, valid local submission to status, contact save, theme picker/embedded preview, stage advancement, empty lineup, QR and closed submissions.
- Stage fits exactly within the available 1280x720 viewport; mobile form/status/creator have no horizontal overflow.
- Source vector glyph paths, pair spacing and optical origins match Motion Studio. Motion is bounded, finite and static under reduced-motion preferences.
- No deployment or live-event mutation was performed. Live backend event creation remains a release check after review.

## Visual QA

The layout keeps the concept's split editorial composition, type hierarchy, flat palette and large circular characters. Production content and validation are retained rather than replaced with mock controls. Native SVG geometry replaces the concept's approximate artwork. Desktop/mobile spacing and short-screen stage/QR fit were reviewed visually; no text/character overlap in the checked states. The smaller desktop height uses a compact type scale to keep the face visible.

## Playful attention refinement — 27 October

Add a finite, staggered left/right glance followed by audience eye contact and the shared fluid wink. Keep source glyph paths, resting pairs, clipping and optical origins untouched. Pointer/focus attention interrupts automatic gaze smoothly; hidden/offscreen and reduced-motion characters rest. Keep DevDay as an optional registry-backed visual style. Verify sampled motion bounds/closure, types, lint and local selector interaction before review.

Validation of the refinement: 48 Node tests pass, including four new tests for full left/right travel, the 0.12D gaze bound, asymmetric wink closure/recovery and reduced-motion rest. TypeScript and scoped ESLint pass. Visual-style persistence tests still pass (8 in-memory cases). In-app browser verified changing Codex → DevDay Exchange Community Hackathon through the native style cards and observed the automatic face/head performance. Glyph data and circle construction are unchanged.

## Naming

The public name is **DevDay Exchange Community Hackathon** everywhere: brand lockups, selector labels, accessibility names, sample event titles and future theme copy. `DEVDAY_THEME_NAME` is the canonical string. Preserve the stable internal `devday` identifier for saved-event compatibility. Source artwork attribution retains its original names.
