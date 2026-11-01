---
title: Seeded Convex preview deployment for every Vercel preview
status: IMPLEMENTING
tier: Tier 2
created: 2026-11-01
updated: 2026-11-01
---

Every Vercel preview build gets its own Convex preview deployment, seeded with
test data, instead of sharing development `precious-elk-564`. This is Convex's
documented default ([Vercel hosting, Preview
Deployments](https://docs.convex.dev/production/hosting/vercel)), with a
Preview Deploy Key rather than the Vercel Marketplace integration, which would
put the project in a separate Convex team.

## Decisions

| ID | Decision | Source |
| --- | --- | --- |
| D01 | Previews get their own seeded Convex deployment. | Demian, 1 November 2026: "this is literally the default behaviour until someone overrode it. We should add a seed for the preview deployment, not copy personal preview as a vercel preview" |
| D02 | Change the existing preview setup rather than add another. | Demian, 1 November 2026: "okay, then update the preview one" |
| D03 | Production's build command stays byte-for-byte the same. | Brief, 1 November 2026 |
| D04 | Seeded events go to one development WorkOS organisation named by `PREVIEW_SEED_ORGANIZATION_ID`, proposed as Test. | Proposed |
| D05 | Seeded events are practice events, listed under Events > Practice. | Proposed |
| D06 | Previews serve no MCP. | Proposed |

## How a preview build runs

`vercel.json` runs `node scripts/vercel-build.mjs` everywhere. On Preview it:

1. Requires `CONVEX_DEPLOY_KEY` to be a preview deploy key
   (`preview:<team>:<project>|...`). A missing key fails with
   `preview_deploy_key_missing`; any other key, such as Production's inherited
   by Preview, fails with `preview_deploy_key_not_preview` before anything
   deploys.
2. Keeps the existing WorkOS checks: the development client
   `client_01M1RPKQD8S6KM3Q61N0N2FE4D`, an API key, a cookie password of 32 or
   more characters, and the callback derived from `VERCEL_BRANCH_URL`.
3. Drops every other inherited `CONVEX_*` and `NEXT_PUBLIC_CONVEX_*` variable
   and runs `pnpm exec convex deploy --cmd-url-env-var-name
   NEXT_PUBLIC_CONVEX_URL --cmd "pnpm run build" --preview-run previewSeed:seed`.

`convex deploy` then claims the preview deployment named after the Git branch
(reusing it on later pushes), registers the branch callback and CORS origin
with the development WorkOS environment from `convex.json` `authKit.preview`,
builds Next.js against the preview's URL, pushes the functions and, only when
it has just created the deployment, runs the seed.

## Seed

`convex/previewSeed.ts` `seed` is an internal mutation that reuses
`createPracticeEventWithOwner` (the body of Practice > New practice event,
moved out of `createPracticeEventForOwner` unchanged) and the real judging
steps. It makes:

- "Preview hackathon, submissions open": 8 test submissions, 3 test judges.
- "Preview hackathon, judging": 12 test submissions, 4 test judges, judging
  open with two judges per project, 10 of 24 reviews scored, timer paused.

Both have the practice sample tracks (AI agents, Developer tools, Open),
sponsors (OpenAI, Vercel), the practice test projects and videos, and sample
AI summaries, so no model is called. The seed is one transaction and skips
any event whose name is already there, so running it again changes nothing.

Organisation: events belong to a WorkOS organisation. Previews sign in through
the development WorkOS client, so the people and organisations are the same as
on development. The seed reads the organisation id from
`PREVIEW_SEED_ORGANIZATION_ID`, a Convex project default for preview
deployments. Proposed value: the development Test organisation, which is the
one used when signing in on development. Anyone signed in to that organisation
on a preview sees the events under Events > Practice. Without the variable the
seed stops with a message naming it, and the first build of that branch fails.

Practice rather than real events (Proposed): practice events are made by the
code above, have the practice tools (add submissions, score as test judges,
skip the timer, reset) for driving a preview through each phase, and never
count as the live event. The Events list itself starts empty, which also shows
the first-run state.

Email: test people are plus-addresses of `delivered@resend.dev`, Resend's test
inbox, which accepts mail without delivering it. Seeded submissions send no
email, as in practice. Development has no `RESEND_API_KEY`; leaving it unset on
previews too means a preview sends no submission email at all.

## MCP on previews

MCP is tied to the two canonical deployments: `componentSiteUrl` accepts only
`precious-elk-564` and `giant-egret-456`, and `convex/mcp.ts` built the server
at module load, so a push to any other deployment failed. `mcp` is now null on
other deployments and `convex/http.ts` registers its routes only when it
exists; `next.config.ts` adds no MCP rewrites when `VERCEL_ENV` is `preview`.
Production and development are unchanged, and a bad `MCP_CONSENT_URL` on a
canonical deployment still fails. MCP is tested locally against development.

## What has to be set

Not done by this change; nothing is set on Vercel or Convex from code.

Vercel, project `demo-queue`:

- `CONVEX_DEPLOY_KEY` scoped to Preview only, holding a key from Convex
  dashboard > demo-queue > Settings > Generate Preview Deploy Key. If the
  production key is currently shared with Preview, restrict it to Production
  first.
- Keep Preview `WORKOS_CLIENT_ID`, `WORKOS_API_KEY` and `WORKOS_COOKIE_PASSWORD`.
  Preview `NEXT_PUBLIC_CONVEX_URL` is now ignored and can be removed.

Convex dashboard > demo-queue > Settings > default environment variables for
preview deployments (names from `npx convex env list --names-only` on
development):

| Name | On previews |
| --- | --- |
| `WORKOS_API_KEY` | Required, the development WorkOS key. `convex deploy` reads it only from the deployment, never from Vercel. Without it, the CLI provisions a new AuthKit environment for the preview instead of failing, and sign-in no longer matches the frontend's client. |
| `WORKOS_CLIENT_ID` | Required, `client_01M1RPKQD8S6KM3Q61N0N2FE4D`, the development client the build pins. |
| `PREVIEW_SEED_ORGANIZATION_ID` | Required, the development Test organisation id. New; not on development. |
| `WORKOS_ENVIRONMENT_ID` | Optional. |
| `OPENAI_API_KEY` | Optional. Seeded events use sample summaries; needed only to try the real model. |
| `GITHUB_TOKEN` | Optional. Raises the README read limit for AI summaries. |
| `DEMO_QUEUE_SITE_URL`, `RESEND_FROM_EMAIL` | Optional. Used only for email, which stays off without `RESEND_API_KEY`. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID` | Leave unset: they would let previews create judging sheets in the real Drive folder. |
| `WORKOS_MCP_ISSUER` | Not needed: previews serve no MCP. |
| `GOOGLE_PRIVATE_KEY`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Not needed: no current code reads them. |
| `RESEND_API_KEY` | Do not set. Not on development either. |

Until the deploy key and the three required variables are set, preview builds
fail or sign in against the wrong WorkOS environment.

Default variables apply only when a preview deployment is created, and the
seed runs only then. A preview deployment created before the defaults were set
keeps what it got: delete it in the Convex dashboard (its name is the branch)
and redeploy the branch in Vercel, which creates it again with the defaults and
runs the seed. If its first build provisioned an AuthKit environment, remove
that under Convex dashboard > Settings > Integrations > WorkOS.

To run only the seed on an existing preview deployment, for example after its
first build stopped at the organisation id: Convex dashboard > that preview
deployment > Functions > `previewSeed:seed` > Run, with `{}`.

## First hosted run, 1 November 2026

The first build of this branch, Vercel deployment
`dpl_GAEUxwxMcm7QHfqPhZSaF9jNuPAk`, used the preview deploy key: it created
preview deployment `giant-bloodhound-107`, built Next.js against it and pushed
the functions. The deployment had no `WORKOS_API_KEY`, so the CLI provisioned a
new AuthKit environment and registered the branch callback there. The seed
then stopped because `PREVIEW_SEED_ORGANIZATION_ID` was not set, which failed
the build.

## Verification

- `convex/previewSeed.test.ts`: both events, phases, tracks, sponsors, judges,
  scored reviews, organisation visibility, test inboxes, no scheduled email,
  idempotency and the missing-variable message.
- `test/vercel-build.test.mjs`: the preview command, deploy key checks,
  dropped Convex variables, unchanged Production command.
- `convex/mcpConfiguration.test.ts`: a preview site loads `http.ts` with no
  MCP routes.
- Hosted: the deploy key path, Next.js build against the preview and function
  push work (first hosted run above). The seed, sign-in and the WorkOS client
  on a preview are not verified until the settings above exist.
