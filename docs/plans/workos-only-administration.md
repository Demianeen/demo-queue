---
title: WorkOS-only event administration
status: CODE VERIFIED; HOSTED PREVIEW GATE OPEN
tier: 3
created: 2026-10-27
updated: 2026-10-27
---

## Completion predicate

PR #41 provides WorkOS-only organization administration, the selected sign-in
design, direct Google login, working workspace loading, and a reviewed historical
event classification with safe migration tooling. PR #43 provides working
single-organization MCP on that base. Both final heads pass tests, independent
review, rendered checks, and hosting checks. A short review artifact explains
what to test and what remains a post-merge operation. No automatic merge or
unauthorized production change is part of completion.

## Shape

Use `/events/<slug>/admin` inside the authenticated workspace. One shared backend
guard derives organization identity and checks exact event ownership. Remove
admin token arguments, creation, returned capabilities, and browser storage.
Retain historical database fields only as optional inert data to avoid a schema
migration. Old admin paths redirect without granting authority. Preserve the
account-free participant, judge, submission, and presentation contracts.

The alternative standalone `/admin/<slug>` authenticated layout repeats session
and organization loading. Nesting in the existing workspace keeps one provider
and one organization-switch boundary. The judging event-type guard remains a
separate domain precondition after authorization.

Generate the AuthKit sign-in URL with the existing SDK to preserve PKCE and
sealed state, then select Google's documented OAuth provider. Validate the same
sealed PKCE state at callback and use official WorkOS code exchange and SDK
session storage. Complete multi-organization challenges on the app-owned screen
with separate encrypted, short-lived HttpOnly continuations for concurrent flows.
Confirm membership before querying organization data.
Record only allowlisted failure phases and status codes.

## Throughput checkpoint

- Blocking first steps. Verify repository ownership, live PR heads, current
  browser failure, canonical development configuration, and complete inventory.
- Independent workstreams. Separate admin/backend implementation, sign-in UI,
  and bounded migration tooling. The coordinator owns integration and browser QA.
- Shared mutable state. One coordinator owns branch changes, commits, restacks,
  external configuration, and deployment commands. Workers own disjoint files.
- Smallest safe decomposition. Keep the two existing PRs in their current order.
  Put shared browser/admin changes in #41 and MCP changes in #43.

## Verification and remaining gates

- Test anonymous, foreign-organization, organization-less, unowned-event, and
  leaked-token denial across queries, mutations, and action delegates.
- Preserve hackathon-only judging and anonymous participant/judge/presentation
  behavior. Verify organization switching clears the old admin view.
- Inspect the selected login design at desktop and mobile sizes. Complete direct
  Google callback and authenticated administration against canonical development.
- Verify real MCP OAuth, tool discovery, safe creation/readback, and foreign-org
  denial on the final backend. Do not substitute a protocol harness for a native
  client connection claim.
- Classify all 25 production events before any ownership mutation. The complete
  six-Outpost, nineteen-Test manifest is approved. Apply only that manifest
  after merge and deployment. Until then historical administration remains a rollout
  gate, not completed migration evidence.
- Personal Vercel access is restored. Current hosted logs show
  `convex-provider-mismatch` after successful session and membership checks.
  A Preview-only canonical-development build/configuration fix awaits approval.

## Verified on 27 October 2026

113 Node tests, 52 integrated Convex tests, TypeScript, lint, frozen installation,
and the optimized build pass. Independent callback, alias, and integrated code
reviews pass after fixes. Real Google login reaches Outpost and Test in canonical
development. Native OAuth creates and reads back an unpublished Test event and
nondefault style, and denies an Outpost request with the same grant.

The hosted gate remains open. No production deployment or ownership mutation
has run. The Daytona alias-backed rename is prepared separately and not applied.

The earlier plan's capability-link fallback is superseded. Judging, scoring,
normalization, timers, spreadsheet fallback, and finalist behavior are unchanged
except that their operator entry points now require organization authentication.
