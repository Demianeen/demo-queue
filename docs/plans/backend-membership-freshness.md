---
title: Bound backend organization access after membership removal
status: BLOCKED
tier: Tier 3
created: 2026-09-06
updated: 2026-09-06
---

The user authorized completing A01 with organization membership revocation
bounded to 60 seconds. WorkOS remains authoritative; Convex remains the verifier
of signed organization access tokens. This policy changes authentication token
duration and refresh frequency, not event data or public capability access.

## Decisions

- D01: Configure access-token duration to 60 seconds in each environment's
  default WorkOS application: Development for local development, Staging for
  Preview, and Production for production. Do not interchange credentials.
- D02: Keep the maintained AuthKit and Convex refresh/validation lifecycle.
  AuthKit 4.3.1 passes the existing token's organization ID on both middleware
  refresh and explicit refresh. WorkOS rejects refresh into an organization the
  user can no longer access. A refresh failure cannot extend the signed token.
- D03: Convex enforces token expiration before private query updates (including
  cache reuse), mutations, and actions. Expired credentials cannot authorize new
  operations or query-update execution. An operation admitted before expiration
  may finish and deliver its response afterward. Data already delivered to a browser cannot be
  recalled; existing public admin capability links keep their separate contract.
- D04: Treat the 60-second provider setting as a deployment prerequisite. Convex
  strips registered JWT expiration/issuance claims from custom-JWT user identity,
  so application query code cannot independently enforce a maximum token lifetime.
  Do not pretend a browser check enforces backend authorization.
- D05: Previously issued five-minute tokens retain their signed expiry. Wait at
  least five minutes after changing each environment's setting before claiming
  the new bound applies there. Verify a fresh token has exp - iat <= 60 seconds.

## Evidence and alternatives

The installed AuthKit SDK uses organizationIdFromAccessToken in
src/session.ts for both refresh paths. [WorkOS sessions documentation](https://workos.com/docs/authkit/sessions)
documents configurable token duration and failure when refreshing into an
unauthorized organization. [Convex custom JWT documentation](https://docs.convex.dev/auth/advanced/custom-jwt)
requires expiration and describes token refresh.

Official Convex backend implementation checks identity expiry in
crates/sync/src/state.rs (SyncState::identity) before worker query updates,
mutations, and actions; see [worker](https://github.com/get-convex/convex-backend/blob/main/crates/sync/src/worker.rs)
and [identity validation](https://github.com/get-convex/convex-backend/blob/main/crates/sync/src/state.rs).
The [JWT identity parser](https://github.com/get-convex/convex-backend/blob/main/crates/keybroker/src/broker.rs)
keeps registered expiration outside application identity attributes.

The earlier lease proposal is replaced, not implemented. Its plan review found
B01: Date.now does not invalidate cached Convex queries and scheduled jobs have
no maximum execution delay; B02: throwing on lease expiry would strand the
existing workspace error boundary. Native token expiry avoids both added lease
failure modes and avoids introducing a second authorization cache/controller.

## Verification and completion gates

1. Independent security and lifecycle review of this revised policy and its
   actual provider/SDK/platform contracts.
2. Read back the effective 60-second setting in each environment, then inspect
   only exp/iat and organization presence from a fresh token without logging it.
3. After the old-token drain, revoke a test membership, verify refresh denial and
   rejection of direct private queries/mutations after expiry, and verify an
   existing subscription starts no new private query updates after expiry
   (operations admitted earlier may still finish). Restore test membership.
   Keep this destructive test separate from the real user's access.
4. Verify normal refresh preserves the workspace without full-page loading and
   organization switches obtain the correct organization context.
5. Run existing auth-isolation tests and the complete candidate's test/type/lint
   checks. Record unexecuted hosted checks explicitly; do not clear A01 based on
   passing unrelated local tests or the earlier Vercel build.

No production deployment is included. Production Google OAuth readiness remains
a separate gate. This plan does not revoke existing capability URLs, replace the
provider, add a membership table, or introduce scheduled authorization jobs.

## Configuration progress

Both independent security and lifecycle plan reviews approved the revised
architecture. Their shared wording correction distinguishes admission-time
expiry enforcement from cancellation of operations already in flight.

On 2026-09-06, Staging accessTokenExpiry=60 was applied and verified at 18:24:25
UTC; Development followed at 18:24:54 UTC. Their prior default durations were
verified as 300 seconds, so the old-token drain ends by 18:29:55 UTC. Fresh-token
and hosted revocation checks remain required. Production's change was rejected
by automatic approval review; its duration remains 300 seconds. A01 remains
open in all environments pending fresh-token and revocation verification;
Production additionally requires its 60-second setting.

Installed Convex 1.40.0 defaults to a ten-second refresh margin, giving a
60-second token a forced refresh approximately every 50 seconds. AuthKit's own
timer can check a one-minute token immediately without scheduling another
check; Convex's maintained forced-refresh lifecycle is required here. Preserve
ConvexProviderWithAuth and the adapter's forceRefreshToken path.

## Hosted evidence and blocked verification

The corrected Preview deployment passed Vercel at commit
5961c1e02436ec60244858720097fd24843d2b5a. Hosted Google login completed in
Staging with the stable branch callback, only the user's Outpost/Test
memberships were offered, and the Test workspace loaded. Styles navigation
showed the correct title, and authenticated event creation succeeded more than
60 seconds after login.

Automatic approval review rejected the isolated revocation QA before execution
because temporary WorkOS user/organization/membership creation, deactivation,
and deletion needed more explicit authorization. No test identity or data was
created and no SDK token/revocation checks ran. The temporary credential file
was removed. Fresh exp/iat verification, revoked-member refresh denial, direct
HTTP/WebSocket expiry checks, and cached-subscription invalidation remain
unverified. Do not substitute successful normal login for these negative tests.

Further hosted checks passed: a full refresh retained the session and event;
switching to Outpost hid the Test event; opening the Test event's private
overview while in Outpost returned Event unavailable. The /styles page title
was Styles · Test | Demo Queue. Rendered evidence was inspected at
/tmp/demo-queue-preview-events.png. The identifiable Test draft created by QA
remains; no supported deletion was assumed.
