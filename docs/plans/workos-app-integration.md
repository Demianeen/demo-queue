---
title: WorkOS organization access in Demo Queue
status: COMPLETE
tier: 3
created: 2026-09-05
updated: 2026-09-05
---

Implement the agreed development integration in this worktree. Demian approved
implementation on September 5 after development WorkOS configuration.

## Decisions

- D01: WorkOS AuthKit for Next.js manages login, PKCE callback, cookie sessions,
  token refresh, and logout. Middleware matches only `/events` and `/callback`.
  Existing account-free routes keep the plain Convex provider. `/events` has an
  isolated authenticated provider; no session tokens or user records in localStorage.
- D02: The `/events` server page lists active memberships for the session user
  through WorkOS, including names. The picker refreshes the session into the
  selected organization using the SDK. Verify membership on the server before
  switching. Hide event content while switching and use a full document
  navigation after the SDK updates the session. This resets both the SDK's
  module token cache and the Convex client cache. Require the list response's
  organization to match the selected session organization before rendering.
- D03: Convex validates WorkOS issuer/signature/client configuration and derives
  organization ownership from `identity.org_id`, never a client organization ID.
  Organization listing and event creation require that claim. Membership changes
  take effect on token expiry/refresh; there is no new membership mirror or webhook.
  Existing event admin capability links intentionally retain their current power.
- D04: Add optional `workosOrganizationId` and an index to events. New events
  receive it at creation and a server-generated 32-byte admin capability token.
  Creation also carries the displayed organization as an expected-value
  precondition, compared with authenticated ownership before any write. This
  prevents queued requests from moving organizations after a cross-tab switch.
  Unassigned existing events stay available via their old links and are excluded
  from the organization list until a separately approved classification.
- D05: Move the existing creation form with preview into `/events`. The home
  page links there and retains the device-saved recovery links. Remove anonymous
  creation from the public API in the same change. Keep all event types/styles.
- D06: Use existing page styles and shadcn select/input/alert primitives. Surface
  login/callback failures, no memberships, membership-service failure, missing
  organization, Convex authentication failure, and creation errors with retry,
  switch, or sign-out actions. No auth misconfiguration may enable event creation.
  Token refresh errors make the provider unauthenticated; the SDK retry clears
  its error and reattaches Convex authentication. Healthy refreshes retain the
  existing provider state. Callback errors remain visible with an older session.

## Delivery and checks

One cohesive local candidate: auth and backend access, then UI, then validation.
Estimated implementation and checks: 2–4 hours plus the user's Google login.
No commits, pushes, or production writes are requested. Synchronization points:
plan reviews before auth implementation; local checks before canonical dev sync;
user Google login before claiming end-to-end success.

- Backend: meaningful Convex tests for signed-out/missing-organization rejection,
  forged organization arguments, ownership assignment, isolated paginated listing,
  and compatibility of legacy account-free access. Update judging fixtures to
  seed legacy events directly so they still exercise capability-based access.
- Frontend: typecheck/lint, existing test suites; real browser home, sign-in,
  callback failure, authenticated list/create/switch, empty state, and mobile
  screenshots. Cross-organization data must not flash during switching.
- Runtime: verify `.env.local` presence and canonical development identity before
  each Convex command. Run development sync only against precious-elk-564.
- Review: two isolated plan reviews, then two conformance and two blind
  architecture reviews of the frozen implementation. Reports are read-only.

## Blockers and exclusions

Plan review: independent security and integration reviews approved the development
plan. The integration review required full document navigation after switching
organizations to clear AuthKit's module token cache; D02 incorporates it. SDK
redirect errors must propagate; callback failures need a retry page.

- P01 (open production merge requirement, carried from setup plan): separate
  production WorkOS credentials, provider configuration, and URLs must be ready
  before merging the auth integration. No production actions in this task.
- User Google authentication is required to finish browser validation.
- No organization administration UI, new roles, production event backfill,
  participant accounts, judging/scoring/timer changes, or admin-token replacement.
- The simpler token-based membership model is the accepted design. A synchronous
  membership check for every Convex request would require an action gateway or
  synchronized membership data and is outside this change.

## Implementation evidence, September 5

Implementation is present locally and synchronized to development. Status is
BLOCKED only on the user's Google login and subsequent authenticated browser
verification; it does not mean production is ready.

- `pnpm test:convex`: 13 tests pass, including organization isolation, creation
  preconditions, anonymous rejection, and the seven existing judging tests.
- `pnpm test`: all 42 existing Node tests pass. TypeScript and focused ESLint
  checks pass; `git diff --check` is clean.
- Both independent conformance reviews and both blind architecture reviews
  approve the revised candidate. Reviews caught the queued-write organization
  boundary, refresh recovery, saved-link removal regression, and authenticated
  callback error visibility; all four were corrected and re-reviewed.
- Prevention checks for future auth work: bind delayed writes to the displayed
  organization, test failure-to-retry transitions against the installed SDK,
  compare extracted UI actions with the original, and exercise callback errors
  with both absent and existing sessions.
- Browser PARTIAL: home entry, signed-out `/events`, Google-only hosted AuthKit,
  and invalid callback retry screen were inspected. No console errors on the
  app's signed-out recovery page. Desktop screenshot at 1910×1075; narrow-screen
  check at the actual 582×1260 viewport showed no horizontal overflow and a
  42-pixel sign-in button after correcting stretched grid rows. The browser
  viewport override did not produce the requested 390 CSS pixels.
- Development logout return URL `http://localhost:3000/` was added through the
  WorkOS plugin and read back. Production was untouched.
- Still unverified: real Google callback/JWT acceptance, authenticated event
  creation/listing, organization switching, logout, and authenticated mobile UI.
  No production build was run while the login callback development server was
  active. No commits or pushes were requested or performed.
- Known limits: membership revocation takes effect at token expiry/refresh;
  existing capability links retain access. A refresh failure discards an
  unsaved creation draft when the workspace hides; healthy refreshes do not.
- Existing unassigned events were not classified into organizations. No
  production credentials, provider changes, or deployment were performed. P01
  remains required before merge.


## Verification update after workspace implementation

Real Google callback and Convex JWT acceptance, organization switching, style isolation, event creation, and organization event listing were exercised successfully in the in-app browser on September 5. The old Google-login blocker above is resolved. See `neutral-workspace.md` and root `design-qa.md` for current UI evidence and remaining test limits. Production prerequisite P01 remains required before merge; no production work was performed. Logout was not exercised because the current signed-in user session was preserved.

## Open merge blocker from delivery review

- A01: Backend organization authorization currently accepts a verified, unexpired organization JWT. The 60-second WorkOS membership cache protects workspace rendering, but does not bound access through direct Convex calls after membership removal. A removed member can read event details and obtain newly created admin links until their token expires. Before merge, enforce bounded membership freshness in the shared backend guard with direct-call revocation tests, or explicitly accept and document token-expiry-based revocation. Recommendation: enforce bounded freshness. This blocker remains open; no policy decision has been made.
- P01 remains open as recorded in `workos-development-setup.md`: production WorkOS and hosting configuration must be verified before merge.
