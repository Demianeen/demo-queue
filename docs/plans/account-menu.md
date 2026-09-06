---
title: Account menu aligned with FleetOS reference
status: COMPLETE
tier: Tier 1
created: 2026-09-06
updated: 2026-09-06
---

Use the supplied second screenshot and read-only FleetOS user-dropdown.tsx as the design reference: profile avatar beside name/email, grouped organization section, consistent icon/action rows, separators and red sign-out row. Implement with existing shadcn dropdown plus official Base UI avatar. Keep actual Demo Queue actions; no placeholder settings/legal links. Add organization submenu using existing memberships and switch handler. Use the already available WorkOS profile photo with initials fallback. No backend, auth-policy, data or FleetOS edits.

Sequence: inspect current/reference UI and existing primitives, implement one account-menu component and scoped styles, typecheck/lint, inspect real browser menu and organization submenu, verify saved-link navigation and return. Do not sign out. Preserve header org picker. Screenshot complete app context; desktop plus narrow menu bounds if available. No production deploy or external configuration. No blocking questions.

Verification: TypeScript/focused ESLint and diff whitespace checks pass. Browser menu displays profile photo, name/email, separated organization and action sections. Submenu lists only existing memberships; selecting Test switches organization and retains /styles. Saved event links opens /saved and browser Back returns. Screenshot inspected at 813×873: /Users/demian/.codex/visualizations/2026/09/05/01a0715b-ed44-70a0-aec3-d83d37dd7e17/account-menu-fleetos.png. Sign out was not executed, per standing instruction. No production/FleetOS/data edits.

Follow-up requested September 6: header organization selector should fit its selected name and arrow. Remove fixed minimum width and use intrinsic trigger/container width with max-width for long names. Scoped CSS only, no data/auth changes. Verify Test versus Outpost width and actual menu operation; capture updated header.

Follow-up verified: Test trigger ~90px versus Outpost ~126px in same browser viewport, actual switching works and restored Test. Updated screenshot includes final compact header.
