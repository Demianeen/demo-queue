# Submit form and status link

A participant opens the event's public submit link, fills in their demo (demo night) or team project (hackathon), and gets a private status link that shows where their submission is: submitted, judging, finalists, results.

## Sub-features

- `submit-load` shows the right form for the event type and style, or a closed state when submissions are closed.
- `submit-validation` blocks an incomplete submit and moves focus to the first invalid field, without writing.
- `submit-success` creates the submission and shows `Your team is in` (hackathon) or `Your demo is in` (demo night) with the status link.
- `status-link` shows a submission's progress and details at `/s/<slug>/<token>`.

## How to get to it (user POV)

- The submit link `/e/<slug>`, shared by QR code or `Share` in the event admin, or `Copy the submit link` in the command menu.
- The status link `/s/<slug>/<token>`, shown after submitting and sent by email in production.

## Driving it with the browser and shot.mjs

Preconditions:

- Doctor passes. An event accepting submissions: a practice event in phase `submissions` (for example `practice-parity-check-31-oct-vifm8` while it exists). Its `_id` from `convex data events`.
- Count before: `pnpm exec convex data submissions --limit 1000 --format jsonl | jq -s --arg e "$EVENT_ID" '[.[] | select(.eventId==$e)] | length'`.

- **Load.** Run `node .agents/skills/verify-demo-queue/scripts/shot.mjs http://localhost:<port>/e/<slug> "$DIR/submit-form" --mobile`. Expect status 200, title `Submit - <event name> | Demo Queue`, 0 console errors, and in `submit-form.aria.txt` the heading `Submit your hackathon project.` (or the demo night heading), the fields `Team name *`, `Project name *`, `Project description *`, group `Tracks`, `Public GitHub repository *`, `Demo video link *`, group `Team members *` and button `Submit project`.
- **Validation (no write).** In the browser, open the same URL and click `Submit project` on the empty form. Focus moves to `#teamName` and the empty required fields match `:invalid`. Count again: unchanged.
- **Success (writes).** Only on a practice event: fill every required field with obvious test values (presenter email a `+verify` plus-address of demyan310505@gmail.com), tick the rules checkbox, add one social link, submit. Expect the heading `Your team is in` and a status link. Count again: one more. Hide the test row afterwards from its row menu in the event admin, or leave it: practice events tidy themselves away.
- **Status link.** Take a token into a variable (`TOKEN=$(... jq -r '.participantToken' | head -1)`) and run `shot.mjs "http://localhost:<port>/s/<slug>/$TOKEN" "$DIR/status" --mobile`. Expect title `Status - <event name> | Demo Queue`, the heading for the current state (for example `Submitted, waiting for judging`) and the list `Progress` with `Submitted (done)`, `Judging`, `Finalists`, `Results`.
- **Proof.** The `shot.mjs` files, the before and after counts, and `notes.md` with the steps.

## Gotchas

- The form uses native `required` validation first; the app's own checks (phone format, at least one social link for the presenter, rules accepted) run only after the native ones pass.
- A submit per browser is rate-limited by its client id; a burst of test submits can hit the limit.
- Submitting a demo-night form on a non-practice event puts a row in someone else's queue. Do not.
- Tokens are the only key to a status page. Keep them out of reports and file names.
