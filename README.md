# Demo Queue

Realtime demo-night picker for events.

## Stack

- Next.js
- Convex
- Secret-link access for admins and participants
- Manual Google Meet link for v1

## Local setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Configure Convex:

   - For a new local deployment, run `pnpm dev:convex` once and follow the
     Convex CLI prompts. This writes `CONVEX_DEPLOYMENT`,
     `NEXT_PUBLIC_CONVEX_URL`, and usually `NEXT_PUBLIC_CONVEX_SITE_URL` to
     `.env.local`.
   - For an existing deployment, create `.env.local` from `.env.example` and fill
     in that deployment's values.

   In a fresh worktree on this machine, use the existing `.env.local` from the
   main `demo-queue` checkout.

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

The official Convex Vercel deployment flow is to run:

```bash
pnpm exec convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'pnpm run build'
```

That is the command in `vercel.json`. Convex documents that `convex deploy`
reads `CONVEX_DEPLOY_KEY`, sets the frontend Convex URL env var for the build
command, then deploys Convex functions:
https://docs.convex.dev/production/hosting/vercel

Production Vercel should manually set only:

```bash
CONVEX_DEPLOY_KEY=<production deploy key>
```

Preview Vercel should manually set only:

```bash
CONVEX_DEPLOY_KEY=<preview deploy key>
```

Do not manually maintain `NEXT_PUBLIC_CONVEX_URL` in Vercel production or
preview when using the `convex deploy --cmd` flow above. Convex injects it for
the build. Local development still needs it in `.env.local`.

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

### URL expectations

Production app build:

- Required in Vercel: `CONVEX_DEPLOY_KEY`.
- Not manually required in Vercel: `NEXT_PUBLIC_CONVEX_URL`, because
  `convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd ...`
  sets it for `pnpm run build`.
- Not required by this app: `NEXT_PUBLIC_CONVEX_SITE_URL`.
- Optional for operator helper output: `DEMO_QUEUE_SITE_URL`. If unset,
  `pnpm queue:prod -- snapshot --show-admin-url` uses the stable production
  alias.

Preview app build:

- Required in Vercel Preview: preview `CONVEX_DEPLOY_KEY`.
- Not manually required in Vercel Preview: `NEXT_PUBLIC_CONVEX_URL`, because
  Convex creates a preview deployment and injects its URL for the build.
- If you need a full admin link for a preview from the local CLI, pass the
  Convex preview deployment reference with `--deployment` and the Vercel preview
  URL with `--site-url`.

Local development:

- Required in `.env.local`: `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL`.
- Optional: `DEMO_QUEUE_SITE_URL`. The helper defaults to
  `http://localhost:3000` for non-production commands.
- To create these values for a new checkout, run `pnpm dev:convex` once or copy
  `.env.local` from the main checkout.

Vercel can expose generated app URL variables such as `VERCEL_URL`,
`VERCEL_BRANCH_URL`, and `VERCEL_PROJECT_PRODUCTION_URL` when system env vars
are enabled:
https://vercel.com/docs/environment-variables/system-environment-variables

## Queue ops

For live events, use the fast queue helper to get queue data into the model
instead of asking an agent to rediscover the data model:

```bash
pnpm queue -- model-context
pnpm queue -- model-context --deployment "<preview-reference>" --site-url "https://<preview>.vercel.app"
pnpm queue -- snapshot
pnpm queue:prod -- model-context --admin-url "https://.../admin/<slug>/<token>"
pnpm queue:prod -- snapshot --admin-url "https://.../admin/<slug>/<token>"
```

Full admin URLs are the authoritative production path. For `model-context` and
`snapshot`, the helper infers the public Convex deployment URL only from the
deployed app named by the full `https://.../admin/...` URL and queries Convex
directly. It does not read `.env.local` for target selection in that mode, so a
local dev `NEXT_PUBLIC_CONVEX_URL` cannot override the pasted production admin
URL.

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

1. Create an event from `/`, paste a fake Meet link, and open the generated admin and presentation view links.
2. Submit two demos from the QR/form link and confirm they appear in the admin queue without showing contact info in the presentation view.
3. Hide one queued demo from admin and confirm another eligible demo fills the queue gap when available.
4. Publish the queue, click `Advance`, and confirm the presentation view updates, the participant page reveals the Meet link for everyone in the published lineup, and the presentation view shows the Meet link only after `Show in presentation view` is enabled.
5. Try opening the admin route with a changed token and confirm it does not return admin data.
