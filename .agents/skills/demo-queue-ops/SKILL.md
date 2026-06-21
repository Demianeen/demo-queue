---
name: demo-queue-ops
description: Fast demo-queue production operations for Codex and event operators. Use when the user asks to inspect the demo queue, rank the best demos, set or update the live lineup, find the admin/stage state, speed up queue querying during an event, or diagnose slow Codex production queue workflows in this repo.
---

# Demo Queue Ops

## Fast Path

Use `pnpm queue` or `pnpm queue:prod` before manual schema or route exploration.
For event-time queue inspection, ranking, or lineup requests, run the matching
helper command immediately after reading this skill. Do not read memory,
rollout summaries, Convex schema, or route files before the first helper attempt
unless the user explicitly asks for historical context or implementation
debugging.

```bash
pnpm queue -- snapshot
pnpm queue -- snapshot --deployment "<preview-reference>" --site-url "https://<preview>.vercel.app"
pnpm queue:prod -- snapshot --admin-url "https://.../admin/<slug>/<token>"
pnpm queue:prod -- rank --count 5 --admin-url "https://.../admin/<slug>/<token>"
pnpm queue:prod -- set-lineup --ids id1,id2,id3,id4,id5 --admin-url "https://.../admin/<slug>/<token>" --yes
pnpm queue:prod -- set-best --count 5 --admin-url "https://.../admin/<slug>/<token>" --yes
pnpm queue:prod -- snapshot --show-admin-url
```

If the user asks for production data and the command needs network access, request escalated network permission on the first command. Do not first wait for a sandboxed production Convex command to fail.

## Defaults

- Prefer a full admin URL when available. It gives the script `slug`, `adminToken`, and site origin directly, avoids table discovery, and lets the helper infer the public Convex URL from the deployed app without copying `.env.local`.
- If no admin URL is available, let the script choose the latest real user-facing production event.
- Use `rank` for read-only shortlist requests.
- Use `set-lineup --ids ... --yes` when the user already selected demos.
- Use `set-best --count N --yes` only when the user explicitly asks to apply the script-ranked top N.
- Use `snapshot --show-admin-url` when the user asks for the admin UI link. It prints a full URL using `--site-url`, `DEMO_QUEUE_SITE_URL`, Vercel URL env vars, localhost for non-production, or the stable production default.
- For local/dev data, use `pnpm queue`. For production, use `pnpm queue:prod`. For preview, pass the Convex preview deployment reference with `--deployment <reference>` and pass `--site-url` when printing a preview admin URL.
- Verify live data with the script output or `events:getStage`; do browser verification only when the user asks about rendered UI or after code/UI changes.
- Do not expose phone numbers, emails, participant tokens, or admin tokens unless the user explicitly asks for contact details or an admin URL.

## Manual Fallback

When the helper does not fit, use the same Convex functions directly:

```bash
pnpm exec convex run events:getAdmin '{"slug":"<slug>","adminToken":"<token>"}' --prod
pnpm exec convex run events:setLineupOrder '{"slug":"<slug>","adminToken":"<token>","orderedIds":["<id>"]}' --prod
pnpm exec convex run events:getStage '{"slug":"<slug>"}' --prod
```

Only use raw table reads when the event must be discovered:

```bash
pnpm exec convex data events --prod --format json
pnpm exec convex data submissions --prod --limit 1000 --format json
```
