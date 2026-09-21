---
title: Astra event theme
status: COMPLETE
tier: Tier 2
created: 2026-09-21
updated: 2026-09-21
---

Add Astra alongside the existing visual styles. Use the supplied galaxy artwork,
original wordmarks, OpenAI Sans and launch animation, with asset provenance.

1. Extend the shared visual-style registry and verify stored event/public-query compatibility.
2. Theme the creator, its embedded preview, public submission/status pages and live stage.
3. Load the native animation only for the live stage; retain static artwork for
   small screens, reduced motion, embedded previews and renderer failures.
4. Check unit/in-memory integration tests, types, lint, build, and desktop/mobile
   browser flows with local fixtures. Keep existing styles and privacy behavior intact.
5. Submit a pull request from a fork. No backend deployment or live event changes.

## Validation

- 43 Node unit tests and 13 in-memory Convex tests passed, including all three
  themes, stored-event compatibility, stage data and private participant data.
- Production build, TypeScript and full ESLint checks passed. The local pnpm
  layout needed `NODE_PATH` pointing to the installed `eslint-config-next`
  dependencies so ESLint could resolve its existing React Hooks plugin; no
  dependency or lockfile changes were required.
- In-app browser checks passed at 1280 × 720 and 390 × 844: selecting each theme,
  switching event type, stage lineup/timers/QR, demo and hackathon forms, adding a
  team member, and private status presentation. The desktop renderer reached
  `webgl`; small-screen and embedded views retained the poster. Fresh browser
  console contained no warnings or errors, and layouts had no horizontal overflow.
- Public page checks used temporary local fixtures, removed before the build.
  No Convex setup, live data writes or deployments were performed. Live event
  creation against a deployed Astra validator remains a release smoke check.
