---
title: Configure WorkOS for preview and production predeploys
status: BLOCKED
tier: Tier 1
created: 2026-09-06
updated: 2026-09-06
---

PR: https://github.com/Demianeen/demo-queue/pull/41

The user authorized Preview and Production environment configuration and Preview
CI/CD deployment. Production code deployment is excluded. Local development
uses its existing Development WorkOS environment; all Vercel Preview branches
use Staging; Production uses Production. Never substitute environments for
convenience. Do not copy, create, or edit .env.local.

## Implementation

- Hosting Preview has Staging WORKOS_CLIENT_ID, WORKOS_API_KEY, and its own
  WORKOS_COOKIE_PASSWORD, without branch restrictions or a fixed redirect URI.
- Derive Preview callbacks from Vercel's trusted VERCEL_BRANCH_URL and pass them
  through the installed AuthKit SDK's redirectUri option. Canonicalize workspace
  requests to that branch hostname before setting host-only OAuth cookies.
  Preserve path/query and reject malformed or absent preview host configuration.
- Configure callback and CORS registration through authKit.preview.configure.
  Keep the shared Staging homepage unchanged across preview builds.
- Hosting Production has its own three credentials and fixed
  NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://demo-queue-tau.vercel.app/callback.
  authKit.prod.configure uses VERCEL_PROJECT_PRODUCTION_URL for callback,
  homepage, and CORS when the production pipeline eventually runs.
- Installed Convex 1.40 reads the preview WorkOS API key from the backend, so
  matching backend credentials are required in addition to hosting credentials.

## Verified configuration and remaining work

The initial preview build failed because WORKOS_CLIENT_ID was absent from the
preview backend grand-antelope-708. The frontend build itself succeeded.
After the user established the environment mapping and updated deployment
instructions, Staging CLIENT_ID and API_KEY writes to that backend both
succeeded. Automatic approval review blocked a later readback despite successful
writes; do not claim readback or attempt a substitute route around that rejection.
Hosted sign-in must verify the effective integration.

Vercel Preview and Production variables were saved and their scopes verified.
Production backend giant-egret-456 credentials were separately verified against
hosting without printing secrets. No production deployment ran.

Staging now has Google-only authentication, public signup disabled, and verified
active memberships in Outpost and Test for the existing staging user. Its exact
stable PR callback, CORS origin, and logout URI were registered. Production
callback and CORS were registered, and signup/SSO were disabled. Production
Google OAuth, homepage, and logout readiness remain in the premerge report.

Convex 1.40 automatic configuration does not expose logout URIs. The current PR
branch logout was configured separately. Additional preview branches require a
matching Staging logout URI before their sign-out flow can be called verified.

The callback changes pass 54 Node tests, TypeScript, affected lint, installed
Convex schema validation, and independent cleanup/architecture review. Hosted
login and cookie behavior passed after pushing, as recorded below. Exact token
claims and negative revocation checks remain unverified.

## CI and completion

The previous committed head ee5ecc52f28fb73fbd26b2b3a8bd99ceb813239e passed
Vercel deployment B95zYkEJv4JLEA6Bw5mr7gpRZbMg and Preview Comments on
2026-09-06 at 18:09 UTC. That run did not contain this callback delta and does
not prove hosted authentication readiness. The user subsequently authorized
finishing and pushing all remaining independent merge work.

The reviewed candidate is pushed, both Vercel checks passed, and hosted login,
organization access and normal continued operation passed. Actual logout, exact
token claims and revoked-member behavior remain unverified. Track membership freshness A01
in backend-membership-freshness.md and production prerequisites P01 separately.
Style authoring and MCP remain explicitly deferred to a later PR.

References: [Convex automatic AuthKit configuration](https://docs.convex.dev/auth/authkit/auto-provision),
[AuthKit Next.js](https://workos.com/docs/sdks/authkit-nextjs).

## Follow-up validation

The reviewed callback implementation was committed as
5961c1e02436ec60244858720097fd24843d2b5a and pushed to the owned PR branch.
Vercel deployment 42TUyDZTUDXVMVySwtNMRZbsw87N and Preview Comments both
passed. Hosted Google login, the Staging membership selector, Test workspace,
Styles title/navigation, and authenticated event creation after more than
60 seconds were verified. Logout and final operational details are recorded in
../reports/workos-premerge-configuration.md. The negative revocation test and
remaining Production settings are blocked separately, not by Preview CI.

Further hosted checks passed: a full refresh retained the session and event;
switching to Outpost hid the Test event; opening the Test event's private
overview while in Outpost returned Event unavailable. The /styles page title
was Styles · Test | Demo Queue. Rendered evidence was inspected at
/tmp/demo-queue-preview-events.png. The identifiable Test draft created by QA
remains; no supported deletion was assumed.
