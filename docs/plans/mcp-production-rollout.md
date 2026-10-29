---
title: Roll out multi-organization MCP in Production
status: COMPLETE
tier: Tier 3
created: 2026-10-29
updated: 2026-10-29
---

## Outcome

Merge PR #56 after independent review and verify the component at
https://hack.outpostcrew.co/mcp. Keep WorkOS for human Google sign-in and
memberships. Existing MCP clients reconnect once to the new token issuer.

## Steps

- [x] Support exact canonical environments and the public OAuth routes.
- [x] Paginate connection settings so older active connections remain reachable.
- [x] Validate Production credentials and existing deployment configuration.
- [x] Verify the final candidate independently and land through CI/CD.
- [x] Verify Production OAuth, both organizations, one unpublished Test event,
      read-only denial and revocation.
- [x] Deliver setup steps for the two supported command-line clients.

Production verification leaves existing events unchanged. An unpublished Test
fixture may remain for readback. No destructive operations or real provider
side effects are part of the smoke test.

## Preflight evidence

The canonical Production client and active Outpost/Test memberships were read
back successfully. Vercel's existing callback is the public app callback. Its
sensitive credentials are intentionally unreadable, so sign-in after deployment
remains the runtime check. No external Production configuration was changed
during preflight. The existing deploy command is retained.

## Failure handling

If CI fails, inspect and repair the failing release before declaring deployment
complete. Do not reset records or remove the new component tables. A repair
that restores the previous MCP router must retain the additive schema and
connection state. Browser sign-in and participant/judge links stay separate
from the MCP token issuer.

## Release evidence

PR #56 merged at `3a1aab5ff5851a92e2840c1517ac17f03b48a9cc`.
Production deployment `dpl_ChrhqhaVfQgdDc94t1xoysnwSXuy` reached `READY`.
The [Production verification report](../reports/mcp-production-verification.md)
records public protocol checks, native client write/read and revocation,
cleanup, and the checks that remain outside this release's evidence.
Setup steps for both supported command-line clients accompany the release handoff.
