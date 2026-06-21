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

   - For a new local deployment, run `pnpm dev` and follow the Convex CLI prompts.
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

Convex provides `NEXT_PUBLIC_CONVEX_URL` when `pnpm dev` runs both Next.js and
`convex dev`. For deployed environments, set the Convex deployment URL in the
hosting provider.

Local development expects `.env.local` with:

```bash
CONVEX_DEPLOYMENT=<dev-or-prod-deployment>
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site
DEMO_QUEUE_SITE_URL=https://demo-queue-tau.vercel.app
```

In a fresh worktree on this machine, copy `.env.local` from the main
`demo-queue` checkout before running production queue commands. Do not commit
that file.

AI shuffle runs in Convex from `convex/ai.ts`. Configure these Convex
environment variables before using it:

```bash
pnpm exec convex env set OPENAI_API_KEY <key>
pnpm exec convex env set OPENAI_MODEL <fast-model-name>
```

`OPENAI_MODEL` is optional, but setting it lets event operators pick a faster
model without changing code.

## Production queue ops

For live events, use the fast queue helper instead of asking an agent to
rediscover the data model:

```bash
pnpm queue:prod -- snapshot --admin-url "https://.../admin/<slug>/<token>"
pnpm queue:prod -- rank --count 5 --admin-url "https://.../admin/<slug>/<token>"
pnpm queue:prod -- set-lineup --ids id1,id2,id3,id4,id5 --admin-url "https://.../admin/<slug>/<token>" --yes
```

Production queue commands need `.env.local` to point at production:

```bash
CONVEX_DEPLOYMENT=prod:<deployment-name>
DEMO_QUEUE_SITE_URL=https://demo-queue-tau.vercel.app
```

`DEMO_QUEUE_SITE_URL` is used only by the helper when printing full admin URLs.
Override it with `--site-url` if the production alias changes.

If you do not have the admin URL, omit it and the helper will use production
Convex table reads to pick the latest real published event:

```bash
pnpm queue:prod -- rank --count 5
```

The helper prints names, titles, categories, statuses, queue order, and IDs. It
does not print phone numbers, emails, participant tokens, or admin tokens unless
you explicitly pass `--show-admin-url`.

## Manual test cases

1. Create an event from `/`, paste a fake Meet link, and open the generated admin and stage links.
2. Submit two demos from the QR/form link and confirm they appear in the admin queue without showing contact info on the stage screen.
3. Hide one queued demo from admin and confirm another eligible demo fills the queue gap when available.
4. Publish the queue, click `Pick next`, and confirm the stage screen updates while the participant page reveals the Meet link only for `up_next` or `current`.
5. Try opening the admin route with a changed token and confirm it does not return admin data.
