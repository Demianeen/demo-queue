---
name: verify-demo-queue
description: Launch demo-queue (Next.js + Convex + WorkOS) locally against the shared dev Convex deployment and drive it the way organisers, participants, judges and the room do, with screenshots and data checks as proof. Use to prove a change works in the real app (organiser workspace, event admin, submit form, status link, judge link, presentation view), before calling UI or behaviour work done, or to reproduce a bug. For errors on production, read "Investigating production errors" in AGENTS.md first.
---

# Verify demo-queue

demo-queue is a web app. Every user surface is a browser page:

| Who | Page | Sign-in |
| --- | --- | --- |
| Organiser | `/events`, `/events/<slug>/admin`, `/events/practice`, `/members`, `/styles`, `/ai-usage` | WorkOS (Google) |
| Participant | `/e/<slug>` submit form, `/s/<slug>/<token>` status link | none, the token is the key |
| Judge | `/judge/<slug>/<token>` | none, the token is the key |
| The room | `/stage/<slug>` presentation view | none |

Secondary surfaces, not covered here: the MCP server (`/mcp`, see `docs/reports/mcp-*`) and the read-only queue helper (`pnpm queue`, see the `demo-queue-ops` skill).

The feature map in [features/README.md](features/README.md) is the recipe list. Read it before driving.

**Production errors are a different job.** To find out what failed on hack.outpostcrew.co, follow [Investigating production errors](../../../AGENTS.md#investigating-production-errors) in `AGENTS.md` (PostHog, then `vercel logs`, then read-only Convex CLI). Never reproduce against production.

## Ground rules

- There is no local backend. `next dev` talks to the shared dev Convex deployment `precious-elk-564`, which other worktrees use at the same time. Production is `giant-egret-456`: never point a verification run at it, never write to it.
- The frontend is this checkout; the Convex functions are whatever was last pushed to dev, possibly from another branch. If this branch changes anything under `convex/`, push it with `npm run -s convex:sync` (dev only, approved) before driving, and say so in the report, because it changes dev for every worktree. Never run `convex deploy`.
- Write only to practice events (`/events/practice`, slugs start with `practice-`) or events this run created. Other dev events belong to other people's checks.
- Dev has no Resend key, so nothing sends email; still, never send invitations or messages to real people.
- Never sign out of the browser session. Never type a password.

## Launch

Prerequisites, once per worktree:

```bash
cmp .env.local /Users/demian/projects/demo-nights/demo-queue/.env.local  # copy main's if missing; never print or edit it
CI=true pnpm install --frozen-lockfile
```

Start Next.js on a free port (3001 by default; port 3000 is usually the main checkout's):

```bash
.agents/skills/verify-demo-queue/scripts/dq-verify.sh up 3001
```

It refuses a busy port, starts `next dev -p <port>` in its own process group with `NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:<port>/callback` (so the WorkOS callback returns to this server, not to whoever owns port 3000), and prints `ready http://localhost:<port> pid=<pid> log=<file>` once Next.js logged `Ready in` and `GET /events` answers 200. The first page of each route then compiles on demand, so it can take 5 to 15 s.

## Doctor

Read-only. Run it first, and whenever anything looks off:

```bash
.agents/skills/verify-demo-queue/scripts/dq-verify.sh doctor 3001
```

Healthy output (exit 0):

```
env.local: ok dev:precious-elk-564
process:   up, pid <pid> (started by dq-verify)
port:      3001 owned by our instance
http:      GET /events -> 200
auth:      sign-in redirects to WorkOS with callback on port 3001
convex:    ready dev:precious-elk-564 project_access_verified
```

`port ... owned by someone else` means do not drive it. `convex: login_required` is the only result that justifies asking Demian to log in to Convex (see AGENTS.md "Convex deployment safety").

## Drive

### Organiser pages (signed in)

Use the agent's own browser: in Claude Code the Browser pane (`mcp__Claude_Browser__*`), in Codex its in-app browser. Open `http://localhost:<port>/events`.

- Cookies on `localhost` are shared across ports, so a WorkOS session from an earlier local run usually still works: the sidebar shows `Account: demyan310505@gmail.com`.
- Signed out, the page shows `Continue with Google`. Click it and pick demyan310505@gmail.com on Google's chooser (approved for dev). Never type a password; if Google asks for one, stop and hand it to Demian.
- Find elements by accessible name (`find` / `read_page`), not coordinates. Stable handles are listed per feature in the map.
- Wait for skeletons to go: pages render `.skeleton` blocks and `aria-busy="true"` until Convex answers.

### Public pages (no sign-in)

`scripts/shot.mjs` loads a page in headless Chromium at 2x, waits for the skeletons to go, and writes a PNG, an ARIA snapshot and the console errors:

```bash
node .agents/skills/verify-demo-queue/scripts/shot.mjs http://localhost:3001/stage/<slug> "$DIR/stage"            # 1440x900
node .agents/skills/verify-demo-queue/scripts/shot.mjs http://localhost:3001/e/<slug> "$DIR/submit-form" --mobile  # 390x844
```

It prints `{"status":200,"title":...,"png":...,"consoleErrors":0}`. For clicking and typing on these pages, use the browser as for organiser pages.

### Finding a slug or a token on dev

Read dev with the Convex CLI, as JSON, filtered to the fields you need. Keep tokens in shell variables, never in reports or file names:

```bash
pnpm exec convex data events --limit 100 --format jsonl | jq -c '{_id, slug, eventType, phase, practice}'
TOKEN=$(pnpm exec convex data submissions --limit 1000 --format jsonl | jq -r --arg e "$EVENT_ID" 'select(.eventId==$e) | .participantToken' | head -1)
TOKEN=$(pnpm exec convex data judgeAccess --limit 1000 --format jsonl | jq -r --arg e "$EVENT_ID" 'select(.eventId==$e and .active) | .token' | head -1)
```

Prefer a `practice-` event in the phase you need. To get a fresh one, create it on `/events/practice` (`New practice event`); its test people use plus-addresses of the owner's email.

## Evidence

Make one folder per run; it lives in the checkout, is git-ignored and survives cleanup:

```bash
DIR=$(.agents/skills/verify-demo-queue/scripts/dq-verify.sh evidence <feature-id>)   # .verify-evidence/<timestamp>-<feature-id>/
```

Put in it: `shot.mjs` output for public pages, the browser's accessibility snapshot or page text for organiser pages (save the tool's output to `<step>.aria.txt`), and the before/after data reads. A screenshot meant for a person must be crisp (2x): `shot.mjs` gives that; for an organiser page, use the browser's full-resolution screenshot or zoom, not a scaled one.

What counts as proof:

- Drive the real user path: the page, the button, the link. Not a Convex function called by hand, not a test-only route.
- Capture the action and the result: the state before, what you did, the state after.
- Check side effects next to what is visible: re-read the Convex row (`pnpm exec convex data <table> ... | jq`) after a mutation, and re-read it to confirm nothing changed after something that must not write.
- Run the feature on the phone size too when participants or judges use it (`--mobile`).
- Report any entry point in the map you did not drive as not verified, with the reason.

## Cleanup

```bash
.agents/skills/verify-demo-queue/scripts/dq-verify.sh down 3001
```

It stops only the process group it started (recorded pid), never by name, and leaves `.verify-evidence/` and the Next.js log in place. If you created a practice event, leave it: practice events tidy themselves away. Rows you created in a non-practice dev event, remove through the app's own controls and say so in the report.

## Helpers

| Script | Use |
| --- | --- |
| `scripts/dq-verify.sh up\|doctor\|down [port]` | start, check, stop a verification server |
| `scripts/dq-verify.sh evidence <name>` | create and print a fresh evidence folder |
| `scripts/shot.mjs <url> <out-prefix> [--mobile] [--wait-text "<text>"]` | 2x screenshot, ARIA snapshot and console errors of a public page |

## Gotchas

- Do not run `next build` in this checkout while `next dev` is up: both use `.next`.
- A page that fails only on this branch may be a function that is not on dev yet (see Ground rules), not a frontend bug. Check `pnpm exec convex logs --history 50` on dev.
- Dev errors show the full Convex message; production redacts it. A check that reads `error.message` passes on dev and fails on prod: use `convexErrorText` from `lib/convex-error.ts`.
- `next dev` draws its round `N` indicator in the bottom-left corner of every page and screenshot. It is not part of the app.
- PostHog is off locally (no `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` in `.env.local`), so analytics and error events are not sent from a verification run.
