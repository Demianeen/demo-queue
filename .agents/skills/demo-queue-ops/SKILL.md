---
name: demo-queue-ops
description: Fast demo-queue data retrieval for Codex and event operators. Use when the user asks to inspect the demo queue, rank the best demos from live queue data, find the admin/stage state, speed up queue querying during an event, or diagnose slow Codex production queue workflows in this repo.
---

# Demo Queue Ops

## Fast Path

Use `pnpm queue` or `pnpm queue:prod` before manual schema or route exploration.
For event-time queue inspection or ranking requests, run `model-context`
immediately after reading this skill. The helper is data-only: it fetches queue
context for the model, and the model must do the ranking judgment itself. Do not
read memory, rollout summaries, Convex schema, or route files before the first
helper attempt unless the user explicitly asks for historical context or
implementation debugging.

```bash
pnpm queue -- model-context
pnpm queue -- model-context --deployment "<preview-reference>" --site-url "https://<preview>.vercel.app"
pnpm queue -- snapshot
pnpm queue:prod -- snapshot --admin-url "https://.../admin/<slug>/<token>"
pnpm queue:prod -- model-context --admin-url "https://.../admin/<slug>/<token>"
pnpm queue:prod -- snapshot --show-admin-url
```

If the user asks for production data and the command needs network access, request escalated network permission on the first command. Do not first wait for a sandboxed production Convex command to fail.

## Defaults

- Prefer a full admin URL when available. It gives the script `slug`, `adminToken`, and site origin directly, avoids table discovery, and makes the deployed app named by that URL authoritative. In this mode the helper infers the public Convex URL from the deployed app and does not read `.env.local` for target selection.
- If no admin URL is available, let the script choose the latest real user-facing production event.
- Use `model-context` for best-demo or shortlist requests, then rank the demos yourself from the returned descriptions, categories, statuses, and queue order. Do not preserve the helper's source order as a ranking.
- Do not use this helper to apply lineups. If the user asks to mutate the event, first produce the model-ranked list and get explicit confirmation for the IDs to apply.
- Use `snapshot --show-admin-url` when the user asks for the admin UI link. It prints a full URL using `--site-url`, `DEMO_QUEUE_SITE_URL`, Vercel URL env vars, localhost for non-production, or the stable production default.
- For local/dev data, use `pnpm queue`. For production, use `pnpm queue:prod`. For preview, pass the Convex preview deployment reference with `--deployment <reference>` and pass `--site-url` when printing a preview admin URL.
- Verify live data with the script output or `events:getStage`; do browser verification only when the user asks about rendered UI or after code/UI changes.
- Do not expose phone numbers, emails, participant tokens, or admin tokens unless the user explicitly asks for contact details or an admin URL.
- When the answer includes submission IDs, paste the helper rows exactly or omit IDs if they are not needed. Do not manually retype IDs from memory.

## Manual Fallback

When the helper does not fit, use the same Convex read functions directly:

```bash
pnpm exec convex run events:getAdmin '{"slug":"<slug>","adminToken":"<token>"}' --prod
pnpm exec convex run events:getStage '{"slug":"<slug>"}' --prod
```

Only use raw table reads when the event must be discovered:

```bash
pnpm exec convex data events --prod --format json
pnpm exec convex data submissions --prod --limit 1000 --format json
```
