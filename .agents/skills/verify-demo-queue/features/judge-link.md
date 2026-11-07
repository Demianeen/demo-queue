# Judge link

A judge opens their private link on a phone, confirms they are the named judge, then works through their assigned projects: reads the AI summary and README, watches the video, and scores each project.

## Sub-features

- `judge-confirm` asks `Are you <name>?` before anything is recorded, with a way out (`I'm someone else`).
- `judge-list` lists the judge's assigned projects, grouped by what still needs scoring.
- `judge-score` scores one project (`Score this project`) and saves it.
- `judge-stale` shows a clear message for a replaced or deactivated link.

## How to get to it (user POV)

- The private link `/judge/<slug>/<token>`, handed out by the organiser (`Copy all links` in the event admin's judging view).

## Driving it with the browser and shot.mjs

Preconditions:

- Doctor passes. A practice hackathon in phase `judging` with test judges. Event `_id` from `convex data events`.
- `TOKEN=$(pnpm exec convex data judgeAccess --limit 1000 --format jsonl | jq -r --arg e "$EVENT_ID" 'select(.eventId==$e and .active) | .token' | head -1)`.

- **Confirm screen (no write).** Run `node .agents/skills/verify-demo-queue/scripts/shot.mjs "http://localhost:<port>/judge/<slug>/$TOKEN" "$DIR/judge" --mobile`. Expect title `Judge | Demo Queue`, region `Are you <judge name>?` with `Private judge link · <event name>`, buttons `Yes, I'm <judge name>` and `I'm someone else`.
- **Confirm (writes `openedAt`).** In the browser at phone size, click `Yes, I'm <judge name>`. The page shows the event name as the heading and the judge's projects. Read `judgeAccess` again: `openedAt` is now set for that token's row.
- **Score (writes).** Open a project (its title becomes the heading), fill `Score this project`, save. Read `reviews` for the event before and after (`jq 'select(.eventId==$e) | {judgeKey, submissionId}'`): one more row or an updated one.
- **Proof.** The `shot.mjs` files before and after confirming, the Convex reads, `notes.md`.

## Gotchas

- Confirming and scoring are real writes on dev. Use practice events only; `Reset to the start` on the practice banner restores the event.
- A judge link replaced in the admin stops working at once; fetch the token right before the drive.
- The judge page is phone-first. Always capture `--mobile`.
- Never print the token or put it in a file name.
