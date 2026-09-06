# WorkOS premerge configuration report

Updated: September 6, 2026. PR: https://github.com/Demianeen/demo-queue/pull/41

## Environment mapping

| App environment | WorkOS environment | Convex deployment |
| --- | --- | --- |
| Local development | Existing development environment | `precious-elk-564` |
| Vercel Preview | Existing Staging environment | PR preview managed by CI/CD; this PR uses `grand-antelope-708` |
| Vercel Production | Existing Production environment | `giant-egret-456` |

No custom Vercel staging environment was created. Preview settings apply to the
Preview environment without a branch restriction. Production deployment is left
to the production pipeline after merge.

## Vercel changes

Project: `netlyukh-demians-projects/demo-queue`.

| Variable | Preview | Production |
| --- | --- | --- |
| `WORKOS_CLIENT_ID` | Staging client | Production client |
| `WORKOS_API_KEY` | Existing Staging API key | New `Demo Queue production` API key |
| `WORKOS_COOKIE_PASSWORD` | Newly generated Preview secret | Separate newly generated Production secret |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | Not set globally; code derives the stable branch callback | `https://demo-queue-tau.vercel.app/callback` |

The three credentials/configuration fields in each environment were saved as
Secret variables. The public Production callback URL was saved as Config.
Names and environment scopes were inspected in the Vercel dashboard. Existing
`CONVEX_DEPLOY_KEY`, `OPENAI_API_KEY`, and `DEMO_QUEUE_SITE_URL` entries were not
changed by this configuration work.

The existing Vercel GitHub integration was restarted. Its deployment
[B95zYkEJv4JLEA6Bw5mr7gpRZbMg](https://vercel.com/netlyukh-demians-projects/demo-queue/B95zYkEJv4JLEA6Bw5mr7gpRZbMg)
and both GitHub PR checks passed for the original committed PR head. This run
does not prove the later fixes passed. The subsequent implementation commit
`5961c1e02436ec60244858720097fd24843d2b5a` also passed both Vercel checks:
[42TUyDZTUDXVMVySwtNMRZbsw87N](https://vercel.com/netlyukh-demians-projects/demo-queue/42TUyDZTUDXVMVySwtNMRZbsw87N).
Hosted authentication checks for that candidate are recorded below.
No new GitHub Actions workflow was added.

## Convex changes

- Production `giant-egret-456`: set `WORKOS_CLIENT_ID` and `WORKOS_API_KEY` from
  WorkOS Production. A read-back check verified both matched the supplied values
  without printing secrets.
- Preview `grand-antelope-708`: development credentials had mistakenly been
  copied earlier. Both variables were subsequently replaced with WorkOS Staging
  credentials; both CLI writes returned success. Automatic approval review
  rejected the subsequent read-back verification using the obsolete deployment
  allowlist, despite the user-requested instruction update. The write results
  remain valid; hosted Google sign-in and an authenticated Preview event mutation subsequently passed.
- `.env.local` was not changed during this premerge configuration work. Temporary
  credential-transfer files were removed.
- No local `convex deploy` or Production code deployment was run during this
  premerge preparation. Preview deployment ran through Vercel CI/CD.

## WorkOS changes

### Staging

- Google sign-in enabled. Public signup, password sign-in, SSO, and the other
  previously enabled social providers disabled. Current auth settings were
  queried to verify Google-only sign-in and no public signup.
- Created the user's application account, then created `Outpost` and `Test` and
  added that account to both. Both memberships were verified Active. The seeded
  `Test Organization` was left unchanged. No invitation email was sent.
- Added the stable PR origin as an allowed CORS origin:
  `https://demo-queue-git-codex-organizat-d0ac4e-netlyukh-demians-projects.vercel.app`.
- Added that origin's `/callback` as the default redirect URI and `/` as an
  allowed default logout URI. WorkOS mutation responses confirmed the saved
  values.
- Reused the existing Staging API key; no new Staging API key was created.

### Production

- The user added billing details and unlocked Production.
- Created an API key named `Demo Queue production`, then saved it in Vercel
  Production and Convex Production. Key values are intentionally excluded here.
- Disabled public signup, SSO, and IdP-initiated SSO; queried settings confirmed
  the changes. Google sign-in remains disabled because no Google OAuth client is
  configured yet.
- Added `https://demo-queue-tau.vercel.app/callback` as the default redirect URI
  and `https://demo-queue-tau.vercel.app` as the allowed CORS origin. Read-only
  application inspection confirmed these values.
- Attempts to set the application homepage and logout return URL were rejected
  by automatic approval review as insufficiently authorized Production changes.
  The homepage remains unset and the Production logout list remains empty.
- No enterprise SSO connection, Radar subscription, custom domain, or other paid
  feature was enabled.

## Access-token lifetime and membership revocation

Development and Staging access-token lifetime changed from 300 to 60 seconds.
WorkOS returned the new settings successfully at 18:24 UTC on September 6.
Maximum session lifetime (365 days) and inactivity timeout (2 days) were left
unchanged. Tokens issued before the change can retain their old five-minute
lifetime until 18:29:55 UTC.

The same Production token-lifetime update was rejected by automatic approval
review, so Production remains at 300 seconds. Applying the 60-second policy in
Production remains a merge prerequisite. The intended mechanism uses native
WorkOS token refresh and Convex token-expiry enforcement, not a custom
membership cache or scheduled expiry job. Final validation is recorded below.

## Code changes and verification

Published implementation commit: `5961c1e02436ec60244858720097fd24843d2b5a`.

- Added a shared callback resolver. Preview uses the trusted stable Vercel branch
  hostname; Production and local development use their explicit configured URI.
  Invalid Preview hostnames fail validation.
- Forwarded the resolved URI through AuthKit middleware and sign-in. Preview
  workspace navigation uses the stable branch origin before setting OAuth
  cookies, preserving the requested path and query.
- Derived sign-out return URLs from the same app origin.
- Updated Convex build configuration to register Preview callback/CORS and
  Production callback/homepage/CORS using the appropriate Vercel build values.
  Builds do not continually replace the shared Staging homepage.
- Updated repository deployment instructions: local development may use its
  configured development deployment; Preview/Production deployments use the
  owning CI/CD service. Inspect actual PR checks before identifying the service
  or retrying a run. No new workflow was invented for this PR.
- Used the existing AuthKit/Convex refresh lifecycle with a shorter token
  lifetime. No custom membership lease table, scheduled authorization task, or
  additional authorization cache was introduced.

Validation: 54 Node tests, 21 Convex tests, TypeScript, affected ESLint, installed
Convex configuration schema checks, and independent cleanup/architecture
reviews passed. The revised membership-expiry design received two independent
plan approvals. These results do not replace the blocked revocation checks.

Hosted Preview checks performed on September 6:

- Google authorization returned to the stable Preview `/callback` and loaded
  the authenticated workspace.
- The organization selector offered the user's active `Outpost` and `Test`
  memberships.
- Styles navigation worked with the title `Styles · Test | Demo Queue` and the
  Base, Codex, and Outpost choices.
- More than 60 seconds after sign-in, event creation succeeded without another
  login. A full page load retained the session and displayed the created event.
  This verifies continued operation across the refresh boundary, not the exact
  JWT claims or a revoked-session denial.
- Switching to Outpost hid the Test event. Opening its private overview while
  Outpost was selected returned `Event unavailable`.
- The rendered event list was inspected in the browser and a screenshot saved.
- One unpublished QA event remains in the Preview Test organization:
  `QA Preview authentication Sep 6`, slug
  `qa-preview-authentication-sep-6-6e7909`. No participants or live queue were
  created. Production event data was untouched.

Automatic approval review rejected an isolated SDK test that would create and
remove a temporary WorkOS user, organization, and membership. It rejected the
request before execution, so no such test identities were created. Fresh-token
`exp`/`iat` inspection, refresh denial after revocation, and direct expired-token
HTTP/WebSocket rejection remain unverified. Real user memberships were not
revoked. The temporary Staging QA credential file was removed after the test
was blocked.

Logout return configuration was inspected, but the actual logout flow was not
exercised because the user had not requested signing out. Future Preview branch
logout URLs need registration separately; installed Convex automatic AuthKit
configuration does not support logout URI registration.

## Remaining user-dependent setup

Choose the Google Cloud project and provide access through its normal UI for
Production Google OAuth. Production homepage/logout and 60-second access-token configuration also remain
pending the approval restriction described above. The isolated revocation test also needs
explicit approval to create and remove temporary test identities. Production sign-in cannot be
verified until that provider setup is complete. No Production merge/deployment
or production-data backfill is included in this work.

Style authoring and MCP support remain deferred to the next PR.
