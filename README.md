# Demo Queue

Realtime demo-night picker for events.

## Stack

- Next.js
- Convex
- WorkOS AuthKit sign-in and organization membership for event creation
- Secret-link access for admins and participants
- Manual Google Meet link for v1
- Hosted video links for hackathon submissions
- Native Google Sheet export for hackathon judging

## Local setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Use the existing development configuration:

   Development is `precious-elk-564`. Use the main checkout's existing
   `.env.local` in a fresh worktree, with explicit permission for that copy.
   Convex login is shared across worktrees through `~/.convex/config.json`.
   Do not create or select a new deployment.

   Run `pnpm convex:check` for a read-only, timestamped configuration and
   project-access check. A failed lookup retries once. Only missing credentials
   or a definitive HTTP 401 reports `login_required`; a generic access error
   does not establish that login is needed.

   Run `pnpm convex:sync` for a guarded one-time development sync. It repeats
   the preflight after a generic failure and reports schema errors separately,
   without printing database records or credentials. Run it again before
   reporting an old error as a current blocker. Development scripts also run
   the preflight before starting the canonical watcher. Watcher output reports
   readiness and schema failures without printing database records. Target and
   configuration flags are rejected rather than forwarded to Convex.

3. Start Next.js and Convex together:

   ```bash
   pnpm dev
   ```

   Or run them in split terminals:

   ```bash
   pnpm dev:convex
   pnpm dev:next
   ```

4. Open `http://localhost:3000`.

## Environment

The app validates its Next.js environment with T3 Env during `next build`.
`NEXT_PUBLIC_CONVEX_URL` is required and must be the Convex client deployment
URL ending in `.convex.cloud` for hosted deployments, or a local Convex URL for
local deployments. Do not use the HTTP actions URL ending in `.convex.site`.

Production keeps the official Convex Vercel deployment command:

```bash
pnpm exec convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'pnpm run build'
```

`vercel.json` uses `scripts/vercel-build.mjs`, which runs this exact command only
when `VERCEL_ENV=production`. Convex documents that `convex deploy`
reads `CONVEX_DEPLOY_KEY`, sets the frontend Convex URL env var for the build
command, then deploys Convex functions:
https://docs.convex.dev/production/hosting/vercel

Production Vercel requires its deploy key plus the WorkOS variables listed below:

```bash
CONVEX_DEPLOY_KEY=<production deploy key>
```

Preview builds use the existing canonical development backend. Set these
branch-scoped Vercel Preview variables for each review branch:

```bash
NEXT_PUBLIC_CONVEX_URL=https://precious-elk-564.convex.cloud
WORKOS_CLIENT_ID=client_01M1RPKQD8S6KM3Q61N0N2FE4D
WORKOS_API_KEY=<matching development API key>
WORKOS_COOKIE_PASSWORD=<independent secret of at least 32 characters>
NEXT_PUBLIC_WORKOS_REDIRECT_URI=https://<stable branch host>/callback
```

Preview runs only `pnpm run build`. It does not invoke the Convex CLI or provision
a deployment. The build rejects a different Convex URL, WorkOS client, missing
credentials, or a callback that differs from this project's stable branch host.
It removes inherited Convex credentials from the Next.js build environment.

Do not manually maintain `NEXT_PUBLIC_CONVEX_URL` in Vercel Production. Convex
injects it for the production build. Local development still needs it in
`.env.local`.

Convex function environment variables are separate from Vercel build variables.
They are set per Convex deployment, not in `.env.local`, and can be declared in
`convex/convex.config.ts` for typed access and deploy-time validation. Convex documents this at:
https://docs.convex.dev/production/environment-variables

Local development expects `.env.local` with:

```bash
CONVEX_DEPLOYMENT=<dev-or-prod-deployment>
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
```

`NEXT_PUBLIC_CONVEX_SITE_URL` may also be written by the Convex CLI for HTTP
actions, but this app does not read it.

In a fresh worktree on this machine, copy `.env.local` from the main
`demo-queue` checkout before running local/dev queue commands, or production
queue commands that do not have a full admin URL. Do not commit that file.

AI shuffle runs in Convex from `convex/ai.ts`. Configure these Convex
environment variables before using it:

```bash
pnpm exec convex env set OPENAI_API_KEY <key>
pnpm exec convex env set OPENAI_MODEL <fast-model-name>
```

`OPENAI_API_KEY` is optional for deploys so previews and non-AI changes do not
fail to ship, but AI shuffle throws a clear runtime error if it is missing.
`OPENAI_MODEL` is optional, but setting it lets event operators pick a faster
model without changing code.

Hackathon judging export also runs from Convex. It uses one personal Google
account with the narrow `drive.file` OAuth scope. Sheets are owned by that
account and stored in a normal My Drive folder. A Shared Drive and service
account are not required.

One-time Google setup:

1. In [Google Cloud Console](https://console.cloud.google.com/), select the
   project used for Demo Queue.
2. Enable both the Google Drive API and Google Sheets API.
3. Configure the OAuth consent screen as External. Add yourself as a test user
   while setting it up, then publish the app to Production before generating
   the final refresh token. Google expires refresh tokens after seven days when
   an External app remains in Testing and requests Drive access.
4. Create an OAuth client ID with application type **Desktop app**, then
   download its JSON file.
5. Run the local helper yourself. Do not run it through an assistant or paste
   its output into chat because it prints the refresh token:

   ```bash
   pnpm google:oauth-setup -- /absolute/path/to/oauth-client.json
   ```

6. Open the printed Google authorization URL, approve access, and return to the
   terminal. The helper creates or reuses `Demo Queue judging sheets` in My
   Drive and prints four `convex env set` commands.
7. Run those commands yourself against both canonical deployments, development
   `precious-elk-564` and production `giant-egret-456`. Convex deployment
   selection and CLI authorization remain user-owned setup.

The required Convex environment variables are:

```bash
pnpm exec convex env set GOOGLE_OAUTH_CLIENT_ID '<oauth-client-id>'
pnpm exec convex env set GOOGLE_OAUTH_CLIENT_SECRET '<oauth-client-secret>'
pnpm exec convex env set GOOGLE_OAUTH_REFRESH_TOKEN '<oauth-refresh-token>'
pnpm exec convex env set GOOGLE_DRIVE_FOLDER_ID <folder-id>
```

Any event admin can create the event's native judging sheet from the admin page.
The app keeps that same workbook synchronized as submissions and event details
change. Automatic syncs update only app-owned submission columns, formulas, and
formatting, so judge names and scores remain intact. Admins can also request an
immediate sync from the event page. The file is private to the connected Google
account until that account shares it with judges. The app stores only the
resulting sheet ID and URL.

Hackathon submissions store an HTTPS video link from YouTube, Loom, Google
Drive, or another host instead of uploading video bytes to Convex Storage.
Legacy Convex-hosted videos remain readable and retain their six-month cleanup
schedule. Uploaded files that never become part of a submission are deleted
after a 24-hour grace period by a separate daily cleanup.

After the OAuth export works in both deployments, remove the obsolete
`GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` Convex environment
variables, revoke the old service-account key in Google Cloud, and delete the
downloaded service-account JSON.

### URL expectations

Production app build:

- Required in Vercel: `CONVEX_DEPLOY_KEY` and the WorkOS variables above.
- Not manually required in Vercel: `NEXT_PUBLIC_CONVEX_URL`, because
  `convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd ...`
  sets it for `pnpm run build`.
- Not required by this app: `NEXT_PUBLIC_CONVEX_SITE_URL`.
- Optional for operator helper output: `DEMO_QUEUE_SITE_URL`. If unset,
  `pnpm queue:prod -- snapshot --show-admin-url` uses the stable production
  alias.

Preview app build:

- `scripts/vercel-build.mjs` builds Next.js against `precious-elk-564` and the
  matching development WorkOS client. Preview does not deploy Convex functions.
- The required branch-scoped variables appear in the Environment section above.
  The callback must match `https://${VERCEL_BRANCH_URL}/callback`.
- Preview shares development data. Use the Test organization for review events.
  Sync reviewed backend changes to canonical development separately.
- Production retains its existing Convex deployment command and credentials.

Local development:

- Required in `.env.local`: `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL`.
- Optional: `DEMO_QUEUE_SITE_URL`. The helper defaults to
  `http://localhost:3000` for non-production commands.
- An absent `.env.local` is an unconfigured checkout. The project owner must
  configure it, or explicitly authorize copying it from a named checkout.
  `pnpm dev:convex` requires existing canonical configuration and CLI access.

Vercel can expose generated app URL variables such as `VERCEL_URL`,
`VERCEL_BRANCH_URL`, and `VERCEL_PROJECT_PRODUCTION_URL` when system env vars
are enabled:
https://vercel.com/docs/environment-variables/system-environment-variables

## Organization access and styles

`/events` and `/styles` require a WorkOS session and active organization membership.
New events belong to the organization in the verified access token. Event lists,
overviews, and organization defaults are scoped to that organization. Membership
lists are cached per user and environment for at most 60 seconds; organization
switches check membership directly. Convex independently verifies access tokens.

Event administration requires WorkOS sign-in and matching organization ownership
at `/events/<slug>/admin`. Old admin links redirect there but no longer grant
access. New events have no admin capability token. `/saved` redirects to the
authenticated event list. Participant, judge, submission, and presentation links
remain account-free.

Historical events need an explicit ownership assignment before organization
members can administer them. Review the complete approved classification in
`docs/reports/event-organization-classification.md`. The migration helper defaults
to a read-only plan and requires an approved manifest hash for execution.

Styles provides existing-style previews, event selection, and organization
defaults. Existing events keep their saved appearance. Style authoring is deferred
to a separate MCP change. The admin interface always uses Base; public pages use
the event's selected style.

### WorkOS configuration before merging or deploying

Local development is configured for `precious-elk-564`. Production uses
`giant-egret-456` and must have a separate production WorkOS environment.
Development WorkOS credentials must not be reused in production.

Set these variables in the matching frontend hosting environment:

- `WORKOS_CLIENT_ID`
- `WORKOS_API_KEY`
- `WORKOS_COOKIE_PASSWORD` (an independent random secret of at least 32 characters)
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI` for local development and Production
  (the app's origin plus `/callback`)

Set Preview variables per branch using the WorkOS environment attached to
`precious-elk-564`. Preview callbacks derive from Vercel's trusted
`VERCEL_BRANCH_URL`; the explicit redirect variable must match that branch.
Do not set one branch's redirect URL for all previews. Workspace routes opened
on a unique deployment URL redirect to the stable branch host before sign-in so
the authentication cookie and callback share a host. Production uses its separate
Production WorkOS environment and explicit callback URL.

Set matching `WORKOS_CLIENT_ID` and `WORKOS_API_KEY` on the corresponding Convex
deployment before its functions deploy. Missing the client ID causes auth
configuration validation to fail; the installed Convex CLI also reads the API key
from the backend when applying AuthKit settings. `convex.json` provisions local
development and registers preview/production callbacks and CORS origins using
existing credentials. It does not supply hosting credentials.

In the matching WorkOS environment, configure the callback URI, homepage and CORS
origin for the actual frontend URL, enable the intended Google sign-in method,
and provision invitation-only organizations and memberships. Configure production
Google OAuth credentials rather than relying on development demo credentials.
Preview deployments also need matching frontend/Convex WorkOS configuration and
an allowed callback URL; production credentials do not supply this automatically.

Before merging, verify that configuration and complete a hosted invited-user
login, organization-scoped event creation, and access-denied smoke test.
Production setup remains an explicit merge gate
in `docs/plans/workos-development-setup.md` (P01).

## Authenticated MCP

Production MCP is available at `https://hack.outpostcrew.co/mcp`. The fixed
public OAuth and discovery routes proxy to the canonical Production backend.
Development uses `https://precious-elk-564.convex.site/mcp`. The server rejects
noncanonical deployments and never derives its issuer from forwarded headers.

WorkOS handles Google sign-in, invitations and active organization memberships.
The MCP component issues and stores opaque connection credentials. OAuth clients
use discovery, dynamic registration and PKCE, then approve access on the app's
`/events/connect` page. Existing WorkOS MCP connections must reconnect once when
the component rollout changes the issuer. WorkOS Connect registration and the
old `WORKOS_MCP_ISSUER` / `WORKOS_MCP_RESOURCE` variables are not needed by the
registered component endpoint.

Consent offers All current and future organizations or Choose organizations,
plus Read only or Manage events. A selected grant never gains another
organization automatically. Both policies still check active WorkOS membership
on every tool call and enforce the approved permissions. Read-only connections
exclude writes, participant contacts and private judge links.

The [60-tool catalog](docs/reports/mcp-tools.md) covers event administration,
styles, submissions, queues, stage controls, timers, judging and external actions.
New events remain unpublished. Destructive tools require explicit confirmations.
The server exposes these fixed tools, not arbitrary database queries or mutations.

View and revoke connections, or create optional script keys, at
`/events/connections`. Connection settings are paginated so older active grants
remain reachable. Disconnecting one connection leaves other grants unchanged.

Production issuer, consent and allowed Origin are fixed to
`https://hack.outpostcrew.co`. Keep existing `WORKOS_CLIENT_ID` and
`WORKOS_API_KEY` configured on the matching backend. Development consent defaults
to `http://localhost:3002/events/connect`; an explicit secure frontend consent
URL can be configured with `MCP_CONSENT_URL` on development only. Frontend env
files do not configure Convex HTTP actions.

See the [comparison report](docs/reports/mcp-component-comparison.md) and
[Production rollout plan](docs/plans/mcp-production-rollout.md). Verify real
native OAuth, reads, an unpublished Test event, permission denial and revocation
after the normal Production CI deployment. Local tests alone do not prove that
release works in Production.

## Queue ops

For live events, use the fast queue helper to get queue data into the model
instead of asking an agent to rediscover the data model:

```bash
pnpm queue -- model-context
pnpm queue -- snapshot
pnpm queue:prod -- model-context --admin-url "https://demo-queue-tau.vercel.app/events/<slug>/admin"
pnpm queue:prod -- snapshot --event-slug "<slug>"
```

Admin URLs identify an event, not an authorization credential or deployment.
The helper uses the existing authenticated Convex CLI with an explicit canonical
deployment selector. Use `pnpm queue:prod` for production. Legacy capability URLs
and `--admin-token` are rejected before network access.

The helper only fetches queue data for the model. It does not rank, score,
choose, or update demos. For "best N demos" requests, run `model-context`, then
have the model rank from the returned descriptions, categories, statuses, and
queue order.

Local queue commands use the deployment selected by `.env.local`. Production
queue commands can use `--prod` via `pnpm queue:prod`, or `.env.local` can point
at production:

```bash
CONVEX_DEPLOYMENT=prod:<deployment-name>
```

`DEMO_QUEUE_SITE_URL` is used only by the helper when printing full admin URLs.
Override it with `--site-url` if the production alias changes or when printing a
preview admin URL.

If you do not have the admin URL, omit it and the helper will use production
Convex table reads to pick the latest real published event:

```bash
pnpm queue:prod -- model-context
```

`model-context` prints names, titles, descriptions, categories, statuses, queue
order, and IDs as JSON for the model. It redacts contact-looking text and does
not print participant tokens or admin tokens. `snapshot --show-admin-url` prints
an admin URL only when explicitly requested.

## Manual test cases

1. Sign in with an invited account at `/events`, select your organization, create an event with a test Meet link, and open its overview, admin, and presentation links.
2. Submit two demos from the QR/form link and confirm they appear in the admin queue without showing contact info in the presentation view.
3. Hide one queued demo from admin and confirm another eligible demo fills the queue gap when available.
4. Publish the queue, click `Advance`, and confirm the presentation view updates, the participant page reveals the Meet link for everyone in the published lineup, and the presentation view shows the Meet link only after `Show in presentation view` is enabled.
5. Try opening the admin route with a changed token and confirm it does not return admin data.
