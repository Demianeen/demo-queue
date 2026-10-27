---
title: Organization admin MCP parity
status: COMPLETE
tier: 3
created: 2026-10-27
updated: 2026-10-27
---

## Completion predicate

A separate PR based on #43 exposes every enabled organization-admin action and
read in the app through the existing single-organization WorkOS OAuth boundary.
The coverage inventory maps every operator callsite to a tool or a documented
client-only action. Tests fail when app functionality lacks that mapping.
App and MCP calls execute the same business operations and authorization rules.
Real native OAuth exercises a development event workflow. Final tests, independent
review and current-head CI pass, with a short product-review artifact.

PR #41 and #43 remain unchanged. This work does not merge, deploy production,
assign production ownership, rename production events, reset data, change provider
trust, grant participant or judge impersonation, or expose maintenance endpoints.

## Workflow

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame
- [x] Phase B: Design the workflow
- [x] Phase C: Run the loop
  - [x] Inventory enabled UI reads and actions, role boundaries and destructive effects.
  - [x] Compare two whole-shape reuse designs and select a typed shared operation boundary.
  - [x] Establish the pre-change tool-discovery and operator-coverage baseline.
  - [x] Add shared authorization and operation reuse without fabricated app identities.
  - [x] Add queue, submission, presentation and timer tools with behavior parity tests.
  - [x] Add judging, normalization, access-link and Sheet tools with behavior parity tests.
  - [x] Verify negative access, stale-state handling, confirmation and sensitive projections.
  - [x] Exercise real native OAuth against canonical development and inspect persistence.
  - [x] Publish a separate dependent PR and concise review artifact; verify final checks.
- [x] Phase D: Keep the audit trail
- [x] Phase E: Verify and hand back

## Throughput checkpoint

The first estimate is about fifty operator action and read contracts, not seven
generic creation tools. Read-only explorers split queue/presentation from judging.
One implementation owner controls the branch and shared authorization changes.
Mechanical event and judging extraction and focused tests use disjoint files.
Independent design and review workers remain read-only.
Verification scaffolding precedes the larger mechanical extraction.

The highest risk is accidentally duplicating business rules or widening authority.
The chosen design must preserve the actual event ownership guard, live MCP
membership check, actor provenance, event-type/state constraints and transactional
writes. Node actions need ownership checks on both their reads and final writes.

## Scope boundaries

Enabled operator UI is the source of truth. Judge review submission and participant
submission/editing remain separate roles. Dormant finalist/placement controls,
maintenance backfills, retention cleanup and unused APIs are recorded separately,
not silently enabled. Existing MCP style creation remains supported.

Contact details and private judge URLs need explicit sensitive tools or options.
Normal event metadata never gains capability tokens. Destructive reset tools must
describe their loss and require explicit confirmation. Live tests preserve existing
records and use only newly created development fixtures for state changes.

## External configuration

Reuse the existing canonical development WorkOS OAuth client, grant and MCP endpoint.
No login repair, environment-file edits, provider reconfiguration, Google project
changes, new Convex deployment or production configuration is needed.
The development selector remains `dev:precious-elk-564`.

## Selected implementation

Two candidates compared named shared operations against a generated descriptor
framework. The review criteria were shared behavior and authority, typed inputs
and dispatch, Node orchestration reuse, maintenance risk and independent coverage.
Named operations won because this repository needs explicit private adapters,
not a new generator. Browser and private entrypoints call the same ordinary
functions. The catalogue returns typed registration closures, so iteration does
not erase the association between an input validator and its private reference.

Transport schemas derive from public Convex validator fields, never framework
internals. IDs remain strings in MCP inputs. Private operations normalize them
against the submissions table before invoking shared logic. The schema adapter
rejects `v.id` so it cannot claim an unchecked string is a database ID.
The database operation still checks event ownership and submission membership.

The coverage gate independently scans all app/components runtime API references.
It checks 57 enabled functions and 16 exact exclusions, including the literal
disabled finalist flag. Normal event reads omit contacts and participant tokens.
Contact reads and judge-link reads are explicit tools. Destructive confirmation
names must match both the operation and event target.

AI and Sheet actions retain one orchestration each. Their initial reads and final
writes recheck ownership. Provider tests exercise filtering, races, formatting,
scheduled synchronization and cleanup with only external responses mocked.

## Verification boundary

Local checks passed with 129 Node tests and 98 backend tests. Independent review
verified the operation bodies against the base and found no material issue.
A native OAuth run made 54 calls against two new Test events on canonical
development. It verified queue, timers, links, assignments, judging and denials.
Destructive cleanup and AI/Google provider flows were tested with isolated local
fixtures and provider mocks, not by deleting existing records or creating live
external files. Final-head deployment and review receipts are tracked separately.

The final ID-adapter check made eight further native OAuth calls after syncing
implementation commit `42cfb97`. Reordering persisted unchanged order, explicit
contact reads worked, a wrong-table ID was denied without changing the lineup,
and judging remained closed. The quick review is
`docs/reports/mcp-admin-parity-review.html`; the safe receipt is
`docs/reports/auth-review-assets/mcp-admin-parity-receipt.json`.

The Vercel Preview check passed for review-artifact commit `86bf1bd` on
27 October 2026. GitHub reported CLEAN and MERGEABLE, with no unresolved review
threads. The branch-scoped Preview uses canonical development and the production
environment fingerprint remained unchanged. The authenticated local app readback
matched the MCP-created lineup and paused demo timer. The final documentation
completion commit is checked again before handoff. No merge is armed.
