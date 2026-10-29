---
title: Offer all current and future organizations for MCP connections
status: COMPLETE
tier: Tier 2
created: 2026-10-29
updated: 2026-10-29
---

## Outcome

Offer All current and future organizations and Choose organizations on MCP
consent and script-key forms. Preserve existing selected-organization grants.
Keep current WorkOS membership, permission and revocation checks.

## Steps

- [x] Add an explicit all-organizations policy and preserve missing-field behavior.
- [x] Add the two choices to the existing UI and connection labels.
- [x] Verify OAuth and keys against membership additions, removals and denied access.
- [x] Sync canonical development and verify the local rendered flow.
- [x] Review the diff, update PR #56 and verify its final checks.

This completed development phase left Production unchanged. The later
Production rollout is tracked separately in [mcp-production-rollout.md](mcp-production-rollout.md).

## Verification

All 140 Node and 134 backend tests passed. The local settings form was rendered
and both policies were exercised without issuing a browser credential. Live
development HTTP verification passed 19 membership and authorization checks.
Temporary credentials were revoked and original memberships restored.

Independent review found no code defects and requested one internal-mutation
regression, which was added. PR #56 includes this extension and the 60-tool list.
