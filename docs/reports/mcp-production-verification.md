# Production MCP verification

Verified on 29 October 2026 after [PR #56](https://github.com/Demianeen/demo-queue/pull/56)
merged at `3a1aab5ff5851a92e2840c1517ac17f03b48a9cc`.
Vercel deployment `dpl_ChrhqhaVfQgdDc94t1xoysnwSXuy` reached `READY`.
The public endpoint is `https://hack.outpostcrew.co/mcp` and the canonical
backend is `giant-egret-456`.

## Evidence

- Independent release review returned `PASS+NOTES`. The release candidate passed
  140 Node tests, 140 backend tests, and TypeScript checks.
- Public metadata reports the fixed public issuer and resource. An unauthenticated
  MCP POST returns HTTP 401.
- Sixteen real Production HTTP checks passed. They covered registration, PKCE,
  issuer and resource binding, read-only discovery of 10 tools, Test and Outpost
  reads, unknown-organization denial, hostile-Origin denial, and write denial
  with HTTP 403.
- The HTTP checks also covered refresh rotation, refresh replay denial, public
  revocation, application revocation, and rejection of revoked credentials with
  HTTP 401. Their consent setup used privileged command-line identity injection
  for the verified Production account. This setup is separate from browser sign-in.
- Fresh personal Google sign-in completed on the public domain, through the Test
  organization picker to connection settings.
- A native command-line client used its real OAuth cache for six tool calls.
  It listed the selected Test organization, styles, and events, created and read
  one unpublished Test event, and received the expected denial for Outpost.
- After browser Disconnect, the same native client cache failed initialization
  with `Auth required`. Connection settings then showed no connected clients.

## Data and credential cleanup

The unpublished Test fixture remains for readback. Its ID is
`j976wbgq3kpyas4j9n9dgpf4bh8h7tvv` and its slug is
`mcp-release-check-20261029-3a1aab5`. Existing events were unchanged.

Temporary OAuth grants, the selected-organization key, and the first probe's
unexchanged approval were revoked and checked. Revoked credentials return
HTTP 401. Component registration metadata remains under its normal expiration
because the component has no registration-deletion endpoint.

## Evidence boundaries

Production evidence covers native OAuth with Test write/read and revocation,
and programmatic all-organization read-only OAuth with refresh and revocation.
No Production organization memberships were changed. Fresh external spreadsheet
operations and a nonempty AI-provider response were not tested.
The alpha package's scope-reporting limitation remains enforced by server-side
authorization.

Raw HTTP receipts, native client logs, browser captures, and credentials stay
local and are excluded from this report. This follow-up changes documentation
only. It does not change application source, deployment configuration, or dependencies.
