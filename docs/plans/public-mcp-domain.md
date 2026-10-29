---
title: Public MCP domain and organization connections
status: IMPLEMENTING
tier: Tier 2
created: 2026-10-29
updated: 2026-10-29
---

## Outcome

Publish the existing application MCP server at `https://hack.outpostcrew.co/mcp`.
Keep WorkOS OAuth and organization authorization. Verify two independent
Production client connections, one for Outpost and one for Test.

The component package is not part of this change. The current architecture
already supports the requested tools and WorkOS consent.

## Implementation

1. Use Next.js configuration rewrites for `/mcp` and both protected-resource
   metadata paths. Forward only to the canonical backend selected by the build.
2. Separate the MCP public OAuth resource from the trusted Convex HTTP ingress
   origin. Keep exact bearer audience, issuer, expiry, Host, Origin, query, and
   organization checks. Do not trust forwarded headers as an authority.
3. Verify the boundary locally and on the shared canonical development backend.
   Preview and development retain their current resource identity.
4. Merge and deploy through the existing Production pipeline. Register the
   public WorkOS resource and set only Production's `WORKOS_MCP_RESOURCE` to
   the public endpoint after the rewritten routes exist.
5. Authorize two separate native-client connections and alternate read calls
   through both. Verify each selected organization and cross-org denial after
   the second authorization, rather than merely observing two consent screens.

## Rollout and verification

Existing Production MCP clients must change URL and reauthorize for the new
resource audience. Keep the old WorkOS resource registration during rollout.
No event records, browser-auth providers, or signup policy need to change.

Tests must cover proxied and direct requests, public discovery/challenges,
wrong bearer audiences, malicious Host/Origin/forwarded headers, credentials in
query strings, fixed upstream selection, and discovery from both URL forms.
The native-client test is read-only. If client credential storage prevents two
same-URL connections from coexisting, report that evidence and use distinct
supported client identities rather than broadening either token's organization.

## External configuration

Production is `giant-egret-456`, its WorkOS environment is
`environment_01M1RPKP2QKH63AM5WGGSNNXTW`, and its public resource will be
`https://hack.outpostcrew.co/mcp`. Development remains `precious-elk-564` with
its existing WorkOS environment and resource.
