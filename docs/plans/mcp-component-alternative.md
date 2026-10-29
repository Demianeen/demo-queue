---
title: Compare component-based MCP authorization
status: COMPLETE
tier: Tier 3
created: 2026-10-29
updated: 2026-10-29
---

## Outcome

Build a development alternative using `@convex-dev/mcp`. Keep WorkOS for human
sign-in, invitations, and current organization memberships. Compare it against
the existing WorkOS MCP authorization service with a working product and
repeatable evidence. Do not migrate Production to the component.

## Workflow

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [x] Phase C: Run the loop.
- [x] Phase D: Keep the audit trail.
- [x] Phase E: Verify and hand back.

The parallel coverage has four phases: Frame, Fan out, Aggregate, and Report.
The architecture has five phases: Ground, Sketch, Agree, Implement, and Scrap.
Agree proceeds without a human checkpoint. Scrap applies if the design fails.

## Scope and acceptance

1. Trace the current 60-tool server and compare two candidate authorization
   designs before selecting the component adapter.
2. Use a connection-owned approval containing a verified user identity, approved
   organizations, and tool permissions. Bind approvals on the server. Never
   accept a caller-supplied user identity as authentication.
3. Build the consent page, organization selection, connection management, and
   supported credential flows. Select all means the organizations shown at
   approval time. Current membership remains necessary on each call.
4. Preserve the app's administrative operations and public participant routes.
   Test read-only denial, multi-organization use, cross-user and cross-event
   denial, revoked membership, connection revocation, invalid and expired
   credentials, refresh rotation, and OAuth request binding.
5. Exercise real development browser approval and MCP clients. Unit tests alone
   do not establish interoperability. Use synthetic development fixtures for
   mutations. Never delete or reset existing user data.
6. Produce a short rendered comparison report, a detailed evidence matrix, and
   a separate reviewable PR. Recommend a direction from observed behavior and
   state unverified boundaries explicitly.

## Independent public domain change

The public endpoint belongs to `codex/mcp-domain` in the existing c23c worktree.
Its owner publishes `https://hack.outpostcrew.co/mcp` through a separate PR,
obtains an independent review, merges through normal CI/CD, and verifies
authenticated Production calls. Production retains WorkOS MCP authorization.
No event data changes are part of that rollout.

## Shared development ownership

Only this experiment syncs the canonical `precious-elk-564` development backend
while it is under test. Other worktrees must not overwrite its functions. The
public domain worker uses local tests and Production CI/CD instead.

## Throughput checkpoint

Complete grounding and an OAuth feasibility spike before expanding all tool
adapters. If the component cannot safely bind organization approvals or work
with a native client, record the failed experiment before adding UI. Reuse
the existing tool catalog and internal domain operations wherever possible.

## Evidence

Decision trail: `docs/reports/mcp-component-decisions.tsv`.
Package baseline: component alpha tag `0.1.0-alpha.7`, Convex minimum `^1.43.0`.
The existing lockfile uses Convex 1.40.0, so the isolated alternative needs a
Convex dependency update. This update does not change Production dependencies.

## Delivered result

Draft evaluation PR #56 contains the working development alternative, rendered
comparison report and rerunnable probe. Public endpoint PR #55 is merged and
authenticated in Production. The component remains development only.

All 140 Node and 126 backend checks passed. Native multi-org consent, fixture
writes, read-only denial, live owner isolation and revocation were exercised.
The hosted Preview passed its build and completed personal Google sign-in.
See the report for the external-provider and lifecycle proof boundaries.
