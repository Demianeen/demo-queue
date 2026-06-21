<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Demo queue inspection

When a user asks who is in the queue, wants the best N demos, asks for the admin
URL, or asks to set/update the live lineup, use the deterministic helper first
so Codex does not spend event time rediscovering routes, schemas, function
specs, Vercel aliases, or browser verification paths:

For event-time queue inspection, ranking, or lineup requests, run the matching
helper command before reading memory, rollout summaries, Convex schema, or route
files. Use old memory only after the helper fails or when the user explicitly
asks for historical context.

```bash
pnpm queue -- snapshot
pnpm queue -- snapshot --deployment "<preview-reference>" --site-url "https://<preview>.vercel.app"
pnpm queue:prod -- snapshot --admin-url "https://.../admin/<slug>/<token>"
pnpm queue:prod -- rank --count 5 --admin-url "https://.../admin/<slug>/<token>"
pnpm queue:prod -- set-lineup --ids id1,id2,id3,id4,id5 --admin-url "https://.../admin/<slug>/<token>" --yes
pnpm queue:prod -- set-best --count 5 --admin-url "https://.../admin/<slug>/<token>" --yes
pnpm queue:prod -- snapshot --show-admin-url
```

If no admin URL is available, the helper falls back to Convex table reads and
chooses the latest real user-facing event. Normal output intentionally omits
phone numbers, emails, participant tokens, and admin tokens. Pass
`--show-admin-url` only when the user explicitly asks for the admin URL. The
helper prints a full URL using `--site-url`, `DEMO_QUEUE_SITE_URL`, Vercel URL
env vars, localhost for non-production, or the stable production default
`https://demo-queue-tau.vercel.app`.

A full `https://.../admin/<slug>/<token>` admin URL is the authoritative
production path. For `snapshot`, `rank`, `set-lineup`, and `set-best`, the
helper infers the public Convex deployment URL only from the deployed app named
by that URL and queries Convex directly, so do not copy `.env.local` first when a
full admin URL is already available. In this mode, local env cannot override the
pasted production admin URL.
When reporting helper results with IDs, paste the helper rows exactly or omit
IDs if they are not needed. Do not manually retype submission IDs from memory.

When using Codex for production Convex commands, request escalated network
permission on the first command. Waiting for a sandboxed prod command to fail can
add 30 seconds before any useful data is returned.

Use raw Convex CLI table commands only when the helper does not fit, the user
explicitly asks for table output, or you need to debug the helper itself. If the
user says "prod queue" or "production queue", use `--prod`; otherwise use the
default dev deployment unless they name a deployment. For preview deployments,
pass the Convex preview deployment reference to the helper with
`--deployment <reference>`.

1. Read events first:

   ```bash
   pnpm exec convex data events --format json
   ```

   For production:

   ```bash
   pnpm exec convex data events --prod --format json
   ```

2. Read submissions as JSON, not pretty table output, so the result can be filtered without terminal truncation:

   ```bash
   pnpm exec convex data submissions --limit 1000 --format json
   ```

   For production:

   ```bash
   pnpm exec convex data submissions --prod --limit 1000 --format json
   ```

3. Group submissions by `eventId`, match them to `events`, and state which event was used. Prefer the latest real user-facing event over QA, layout, smoke, local-test, e2e, or other test events unless the user names one explicitly.

4. Treat `status: "queued"` plus `queueOrder` as the live lineup. Treat `status: "candidate"` as the pool, not the active queue, unless the user asks for all submissions.

5. If the user asks for the "best N demos", rank queued demos first unless they ask to include candidates. Favor demos with clear live-demo hooks, broad audience appeal, concrete workflows, and distinct categories. Penalize placeholder/test titles, empty descriptions, and vague descriptions.

6. Do not expose phone numbers, emails, participant tokens, or admin tokens unless the user explicitly asks for contact details. Names, demo titles, categories, queue order, and status are enough for ranking.

7. Do not ask clarifying questions when the user's wording is specific enough to infer the deployment and ranking count, for example "check prod queue and give me the best 5 demos". State the assumptions used in the answer instead.

8. If the sandbox blocks Convex network access with DNS or fetch errors, rerun the same read-only Convex data command with escalated network permission instead of falling back to stale local assumptions.
