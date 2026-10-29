# MCP authorization comparison

29 October 2026. Development evaluation of `@convex-dev/mcp@0.1.0-alpha.7`.

## Recommendation

Use the component as the target for the next MCP version. It supports the
requested experience: one connection approved for Outpost and Test, an explicit
read-only option, and connection management inside the app. Keep Production on
WorkOS MCP authorization until a separate rollout is reviewed and authorized.

This evaluation PR is a draft and must not be merged as a Production rollout.
Its component HTTP server deliberately accepts only the canonical development
deployment. Production routing, component installation, configuration and
reauthorization need their own rollout change.

## What changes for you

| Behavior | Current WorkOS integration | Component alternative tested here |
| --- | --- | --- |
| Google sign-in and invitation access | WorkOS | WorkOS |
| Approve an assistant | WorkOS-hosted page | Demo Queue page |
| Organization choice | One per connection | Several selected organizations in one connection |
| Read-only access | Not implemented in the current integration | Enforced in discovery and direct calls |
| View and disconnect connections | Not implemented in the app | App settings and immediate revocation |
| Script credentials | Not implemented in the MCP server | Optional owner-scoped API keys |
| Device approval | Not implemented in the MCP server | Typed code from the assistant, no refresh token |
| Current membership checks | WorkOS API on every tool call | WorkOS API on every tool call |
| Credential issuer and storage | WorkOS | Component inside our Convex deployment |

Select all records the organizations available at approval time. It does not
automatically add organizations joined later. Both the approved set and current
membership must allow every operation. Existing browser organization switching
does not change an assistant's approval.

## Observed evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Public Production endpoint | Deployed and authenticated | [PR #55](https://github.com/Demianeen/demo-queue/pull/55), public resource `https://hack.outpostcrew.co/mcp` |
| Two Production organization connections | Passed in one fresh native process | Outpost, Test, Outpost, Test returned 6, 19, 6, 19 events. Opposite-org calls were denied. Ten read-only calls; no Production records changed. |
| One development component connection, both organizations | Passed browser approval and native calls | Approved Outpost and Test together. Eight initial read calls succeeded. |
| Development writes across both organizations | Passed native calls and readback | Created unpublished `mcp-comparison-outpost-20261029` and `mcp-comparison-test-20261029`; both read back in their owning organization. These test fixtures remain in development. |
| Read-only key | Passed live HTTP probe | Test read succeeded, unapproved Outpost denied, writes returned 403, foreign Origin denied and event list remained unchanged. |
| Key revocation | Passed live app and HTTP probe | Disconnect removed the connection; the same key immediately returned 401. Both temporary keys were disconnected. |
| Two live owners | Twelve checks passed against development | A passwordless Test-only WorkOS fixture could read Test, could not access Outpost or another owner's connections, and could not revoke another owner's access. Used privileged CLI identity injection followed by real bearer HTTP, not a second Google browser login. All three temporary credentials were revoked and returned 401. |
| Administrative tool parity | Passed automated HTTP comparison | All 60 names and flat argument fields match. Success workflows cover 59 distinct tools. |
| Component authorization and lifecycle | 25 automated cases passed | `convex/mcpComponent.test.ts` |

The native write test initially requested an invalid list limit of 100. Those
calls failed without changes and succeeded after retry with the supported
limit. The limit remains 50.

## What the automated tests cover

Tests exercise the real component HTTP routes, registration, PKCE approval,
exchange, credential storage and tool dispatch. Only the external WorkOS
membership responses are stubbed in these tests.

- Two owners, full and read-only keys, foreign event and submission IDs, and
  owner-only settings and revocation.
- Selected organization snapshots, later membership additions, removed
  memberships and provider failure.
- Broad requests narrowed to read-only, manage-only requests, and direct calls
  to every hidden write or sensitive tool.
- Two approvals for the same client, reverse-order exchange and independent
  revocation.
- Wrong PKCE verifier, client, redirect and resource; replayed or expired codes;
  expired access and refresh tokens; refresh rotation and old-token reuse.
- Device pending, denial, expiry, client binding, incorrect code and rollback.
- Queue, submission, timer, style and judging workflows, including destructive
  confirmation checks and unchanged data after denied operations.
- All 59 organization-bound tools reject both unapproved organizations and
  removed membership before domain effects.

## Costs and limitations

The package does not directly attach our custom organization selection to an
OAuth connection. We built an immutable approval principal, an organization
child table, and owner-checked consent/settings wrappers. The component handles
the token protocol without a fork. The app narrows the component's effective
permissions before discovery and execution and rechecks approvals in data
transactions.

Independent review found an echoed device code and a manage-only read mismatch.
Both were reproduced by failing tests and fixed. A third regression verifies that settings show the effective read-only permission when the client requests only reads, even if management was selected. Device codes now come from
typed input, and manage consistently includes read access. Two package lint
warnings are explicitly tested because contacts and judge links are read
operations that intentionally require management access.

This adds application-owned authorization code and component credential state.
It still depends on WorkOS for login and membership checks. The alpha package
required upgrading the experiment's Convex dependency from 1.40.0 to 1.48.0.
There is no demonstrated performance or price advantage. Incremental Convex
usage was not measured.

Connections settings currently read at most 100 approval records. Before broad
adoption, add pagination rather than silently relying on this limit. Current
tool schemas retain the input fields but are not byte-identical to the old
Zod-generated JSON Schema. Runtime input and domain validation remain in place.
Most existing tool return objects still use the existing safe DTO code rather
than new component return validators.

## Explicit proof boundaries

- No component-based Production deployment or event migration occurred.
- A successful external `create_judging_sheet` call was not tested. The AI
  shuffle success path uses an empty queue. Sheet sync proves enqueueing only.
  Existing provider implementations were retained.
- Cross-user authorization was also verified against the live development
  backend with privileged identity injection. Expiry and refresh replay were
  verified in the component test harness. A second person's Google login and a forced native
  refresh cycle were not performed live.
- Production coexistence uses two distinct registered native clients. It does
  not establish same-client multi-org support in WorkOS.
- A revoke cannot cancel an external provider request already in flight. The
  app rechecks local approval before its final write. WorkOS membership can
  change between the last external check and a subsequent operation.
- Temporary key Copy did not produce observable clipboard text in the in-app
  browser harness. The Show key and Done controls were tested as an alternative.
- The public endpoint worker accidentally created a project-wide Vercel bypass
  token. It was revoked, and readback verified its absence. No bypass was used
  as verification evidence.

## Design choice and development footprint

The published package creates its grant after the app approves a request. Its
approval API returns no grant ID and accepts no custom organization metadata.
Storing one mutable organization selection per person would let later approvals
change older credentials. Forking the component would add an upstream protocol
maintenance burden. Instead, each consent transaction stores an immutable
approval and passes that approval ID as the component principal. Token exchange
preserves that ID. Tool authentication resolves it to its original owner,
selected organizations and effective permissions.

The experiment currently serves the canonical development MCP endpoint.
Development clients previously authorized through WorkOS need to authorize the
component again. Production connections retain WorkOS authorization.

Two unpublished event fixtures, one passwordless synthetic WorkOS user with
Test membership, and one native multi-org OAuth connection remain for review.
Five temporary API-key connections were revoked. Existing user data was not
removed. Connection settings scan the latest 100 approval rows, including
revoked and pending rows, before filtering active grants. Pagination is required
before broad adoption so older active connections remain visible.

## Review and rerun

Open `docs/reports/mcp-comparison.html` for the short review artifact. The local
development settings page is `http://localhost:3002/events/connections` while
the review server is running.

Run `pnpm test`, `pnpm test:convex`, `pnpm exec tsc --noEmit` and `pnpm lint`.
Run `scripts/mcp-component-probe.mjs` with a newly created read-only key file,
the exact development MCP URL, and approved and unapproved development org IDs.
Its `after-revoke` mode checks that the same credential stops authenticating.
The script refuses Production endpoints and prints no credentials.

Package sources: [component documentation](https://github.com/convex/mcp),
[WorkOS MCP authorization](https://workos.com/docs/authkit/mcp).
