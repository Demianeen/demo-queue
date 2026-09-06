---
title: Event list and organization event overview
status: COMPLETE
tier: Tier 3
created: 2026-09-06
updated: 2026-09-06
---

## Outcome and scope

User asked for a nicer Events UI and suggested event details with winners/useful information. Replace raw link cards with a compact neutral list: event name, type, creation date and chevron leading to /events/[slug]/overview. Detail has breadcrumb, name, metadata, Manage event button, links for presentation/submission with open/copy controls, and results for hackathons. All content remains private to current organization. Keep existing live admin tools at existing capability URL. No settings/editor features, invented dates/statuses or fabricated results.

D01: Add getOrganizationEventDetails(slug), guarded by requireOrganization and matching event.workosOrganizationId; missing, foreign and legacy events all return null. Never accept org/admin capability from client. Return only safe explicit fields plus the event's admin capability for authorized manager action. No contacts, participant tokens, draft scores or raw submissions. Submitted placements only (and submitted finalists, closed judging) count as confirmed winners. Draft/needs_review returns explanatory empty status, never ranked from scores. Validate each referenced placement belongs to same event before projecting name/team/demo title.

D02: Details overview uses createdAt (labeled Created), actual submissionsClosedAt, queuePublished, visualStyle label, and hackathon judgingStatus. One bounded indexed scan of up to 1001 submission records gives count capped at 1000, displayed as 1000+ when capped. No other counts inferred from truncated data. No schema migration or backfill.

D03: Detail server page authenticates and verifies active membership using existing per-user cache, then fetches request-only initial detail data. Shared layout places page children inside its main content, protected by same auth/unavailable gating. Existing form owners remain mounted hidden during details navigation. Detail client retains server data until authenticated live query is ready and checks org ID on each update. Missing/foreign returns useful unavailable/back-to-events state. Detail cannot show another event/org during route or org switches. Switch from a detail route goes to /events for new org; /styles and /events/new retain path. Sign-in returnTo must allow only safe local event-detail paths.

D04: Reuse shadcn buttons, separators, alerts, skeleton and menus. Share event-link action rows with clear icon, title and copy feedback; no raw capability text on list. Details set own title; parent suppresses its title while detail active. Public event and admin pages unchanged. Preserve reference's simple white style, modest radii, generous whitespace and fine dividers.

One slice in existing c23c checkout, approximately 25–40 minutes including validation. No commits, pushes, production or external configuration. Dev sync only after .env.local/canonical selector check. No blocking product questions. Account-menu task already verified separately.

## Alternatives

Minimal: restyle the raw link cards. Selected: compact list and dedicated overview so links and eventual results have a stable home. Rich event analytics/editing is excluded because not requested and relevant event scheduling fields do not exist.

## Verification and review

B01 read authorization and data projection; B02 confirmed-winner semantics; B03 shared-route auth/hydration/draft lifetime. Independent plan/conformance and blind architecture reviews; resolve concrete findings. Backend negative tests: anon/no-org, missing/foreign/legacy slug, contacts/token omission, draft/needs_review hiding, submitted ordered placements and foreign references. Browser current Test event list→detail→back, direct reload, wrong slug, empty demo/hackathon results, copy/open semantics without exposing admin tokens in output; no signout, real placements or production writes. Existing suites/typecheck/lint. Screenshot full surface before completion. No winners fixture will be persisted without necessity; backend tests cover confirmed winner state if current dev has none.

D05: Independent reviews found static-route collisions for valid API-created slugs new/sign-in. Use unambiguous /events/[slug]/overview for every event, preserving all stored slugs and public URLs. No data change. Return-path allowlist follows the explicit overview route.

## Completion evidence

B01/B02: cache_plan_review conformance APPROVE. B03: route_plan_review initially found retained-layout identity mismatch; fixed with WorkspaceOrganizationContext gate before server initial/live data display, then APPROVE. Blind reviews event_details_architecture and event_overview_lifecycle independently found route collisions; D05 explicit overview path fixes all existing slugs. Both final APPROVE 9/10, route conformance reapproved.

Validation: 20 Convex tests pass, 50 distinct Node tests pass (49 aggregate plus new reserved-route case; all 3 affected route tests rerun). TSC and focused ESLint pass. Removed only stale generated .next type for renamed route before clean TSC. Diff whitespace check passes. Browser verified real Test event list/detail/reload/admin/back, missing-event fallback/back, copy feedback and retained creation draft. Full 1910x1075 overview and 813x873 list/account screenshots inspected; see design-qa.md. Dev sync precious-elk-564 completed 16:46:37. No production, persisted event/result changes, or signout. Populated winner UI and mobile viewport unverified; winner authorization/order/lifecycle proven by backend tests. Read count bounded at 1001 full submission records, future aggregate optimization not included.
