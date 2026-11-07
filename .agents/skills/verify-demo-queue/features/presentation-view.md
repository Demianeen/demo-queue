# Presentation view

What the room sees on the big screen at `/stage/<slug>`: the submit QR code while submissions are open, then the demo currently on stage with its timer and who is up next, and the winners at the end. It follows the event admin live, without a reload.

## Sub-features

- `stage-submit` shows the submit QR code and link while submissions are open.
- `stage-now` shows `Now demoing` with the demo timer and the `Coming up` list.
- `stage-results` shows finalists and winners.
- `stage-live` updates when the organiser changes the lineup, timer or phase in the admin.

## How to get to it (user POV)

- `Room` in the event admin header, or `Open presentation view` in the command menu (opens a new tab).
- Directly: `/stage/<slug>`. No sign-in.

## Driving it with the browser and shot.mjs

Preconditions:

- Doctor passes. An event in the phase you need; a demo night in phase `stage` for `stage-now` (for example `rehearsal-3-demo-6c8c5f` while it exists).

- **Load.** Run `node .agents/skills/verify-demo-queue/scripts/shot.mjs http://localhost:<port>/stage/<slug> "$DIR/stage"`. Expect status 200, title `Presentation - <event name> | Demo Queue`, 0 console errors. In phase `stage`, `stage.aria.txt` has `Now demoing`, the timer (for example `2:00`) and a complementary region `Coming up` with an `Up next` item.
- **Live update (writes, practice only).** Open the presentation view in one browser tab and the event admin's `Stage` view in another. Advance the lineup or start the timer in the admin; the presentation tab changes without a reload. Capture both tabs before and after.
- **Proof.** The `shot.mjs` files; for live updates, the before and after page text of the presentation tab and the admin action taken.

## Gotchas

- The presentation view is styled per event (Base, Outpost, Astra, DevDay and others); compare against the same style, not another event's.
- Timers move: capture the timer text with the time you read it, and do not compare two captures by exact seconds.
- On a non-practice event, only read. Lineup and timer controls in the admin write.
