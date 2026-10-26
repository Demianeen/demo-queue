---
title: Authenticated event and style MCP
status: BLOCKED
tier: Tier 2
created: 2026-10-26
updated: 2026-10-26
---

## Result

A remote MCP endpoint uses WorkOS Connect and the existing operator identities.
An invited organization member can list events, inspect safe event details,
create a structured style, and create an event with that style. A real local
client must complete OAuth and verify persistence before this is called ready.
This PR depends on organization workspaces in PR #41.

## Grounding

Browser AuthKit sessions and Connect OAuth access tokens use different issuers
and audiences. Existing browser creation and overview functions return private
admin capabilities. Connect tokens must not gain access to those functions.
The existing style API validates colors, font, and radius and snapshots the
selected style when an event is created. Reuse that domain behavior.

## Design decision

Use a stateless MCP HTTP action on the canonical Convex deployment. Verify
WorkOS issuer, signature, exact resource audience, expiration, user subject,
consent, and organization at this boundary. Resolve active membership for each
tool call. Invoke only internal data functions with explicit safe projections.
Leave browser JWT providers and capability routes unchanged.

Two independent design candidates and an independent comparison considered
this direct gateway and a Next gateway with additional Convex token trust.
The direct gateway has the smaller authorization boundary. It is conditional
on the exact maintained SDK running in Convex without compatibility shims.
The Next design is the fallback if that runtime check fails. An app-owned OAuth
server, copied browser cookies, and deployment-key impersonation are rejected.

## Tool contracts

| Tool | Behavior |
| --- | --- |
| `list_organizations` | Active memberships and the OAuth-selected organization. |
| `list_events` | Bounded, paginated summaries in the selected organization. |
| `get_event` | Safe metadata without capabilities or participant data. |
| `create_event` | Explicit organization precondition and existing validation. |
| `list_styles` | Built-in and saved styles in the selected organization. |
| `create_style` | New nondefault style using the existing structured theme. |
| `set_default_style` | Explicit organization-owned default change. |

Every organization argument must equal the token's organization. Another
organization requires OAuth reauthorization and selection at WorkOS. Listing
other memberships does not grant authority to act in them. No shared mutable
server-side organization selection is introduced.

Dynamic clients use WorkOS-supported OpenID scopes. No unsupported custom
permission scope is invented. The fixed tool set follows the existing active
member policy. No arbitrary CSS, HTML, JavaScript, external fonts, or URLs are
accepted as style content.

## Throughput checkpoint

- Blocking first steps. Freeze the base PR, compare authorization designs,
  verify SDK imports in the edge runtime, and retain the CLI access gate.
- Independent workstreams. One implementation owner owns MCP code and tests.
  The coordinator owns external Development setup and review artifacts.
- Shared mutable state. One branch writer owns backend domain extraction.
  No concurrent configuration writes or shared client organization state.
- Smallest safe decomposition. One coupled MCP implementation avoids parallel
  edits to the existing creation and style logic. Independent review is read-only.

## Verification and external configuration

Run protocol initialize, tool discovery, and calls through the maintained SDK.
Test signature, issuer, audience, expiry, M2M, membership, and tenant denial.
Test safe outputs, style limits, snapshot persistence, and original browser
API rejection of Connect tokens. Use the existing domain tests too.

Development WorkOS needs CIMD or DCR and the exact canonical `/mcp` resource.
Convex needs matching issuer/resource configuration and its existing WorkOS
credential. Production settings and records remain untouched. Do not repair
Convex CLI authorization or choose a different deployment when access is denied.

The final gate is a real local client OAuth connection and successful event
and style creation/readback in the Development Test organization. SDK-only
tests and stored client configuration do not satisfy that gate.

## October 26 verification

Implementation and local verification are complete. There are 84 passing Node
tests and 39 passing Convex tests, including 10 MCP tests. TypeScript, lint,
frozen dependency installation, the Next build, and the browser-platform HTTP
bundle pass. Both older JSON-RPC clients and current protocol discovery use
official SDK transports. Signed JWT denials, fresh membership revocation,
cursor-based organization listing, safe projections, style limits, and
event/style snapshot persistence are covered locally.

Independent review found and corrected organization pagination beyond the
first 100 memberships. The selected organization is checked separately, so it
does not need to appear in the current listing page. The direct browser-token
trust boundary remains unchanged. A ConvexTest identity bypasses real JWT
verification, so it does not prove hosted token rejection.

Development WorkOS now has CIMD and DCR enabled and the exact canonical MCP
resource registered. A live REST check verified the membership query and
response shape without printing credentials. The backend synced successfully
to `precious-elk-564`, with its matching MCP issuer configured. Metadata returns
HTTP 200; unauthenticated tool calls return HTTP 401 with the expected challenge.
The earlier project-access blocker is superseded by fresh successful login and
project checks. No CLI authentication repair or alternate deployment was needed.

Native OAuth first failed because an explicit client resource setting duplicated
the resource discovered from server metadata. Removing that redundant setting
reached the real WorkOS consent screen with Test selected. Consent approval and
live tool creation/readback remain pending. The client profile stays disabled
until those checks pass. New preflight commands from PR #41 distinguish fresh
authentication failures from configuration, network, and schema errors.

Production remains unchanged. The matching Production Connect configuration,
MCP issuer/resource, and real Production client proof are not supplied by this
Development setup. Existing Google-login and short-lived-token merge gates
also remain open in PR #41. No event backfill or real/test classification was
performed. Classification must precede any separately authorized migration.

## Sources

- [WorkOS MCP setup](https://workos.com/docs/authkit/mcp).
- [WorkOS Connect claims](https://workos.com/docs/authkit/connect/token-claims).
- [MCP HTTP serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md).
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
