# Event admin

The per-event control room at `/events/<slug>/admin`: the organiser watches submissions arrive, runs the submission clock, moves the event through its phases, runs judging, builds the presentation lineup, shows results and edits settings. Hackathons have judging; demo nights have a queue instead.

## Sub-features

- `admin-submissions` lists submissions with search, status and track filters, and the submission clock.
- `admin-phase` moves the event between phases from the phase control.
- `admin-judging` shows judging progress, ranking and finalists, the judging clock and judge links (hackathons).
- `admin-stage` builds and runs the presentation lineup.
- `admin-results` shows the results.
- `admin-settings` edits the event, tracks, sponsors and style.
- `admin-share` gives the submit link, presentation link and QR codes.

## How to get to it (user POV)

- From `/events`, choose an event (opens `/events/<slug>/overview`), then its admin.
- From the command menu: choose an event, or `Submissions`, `Judging`, `Stage`, `Results`, `Settings` under `Live now` (shortcuts `G U`, `G J`, `G A`, `G R`, `G T`).
- Directly: `/events/<slug>/admin?view=submissions|judging|stage|results|settings`; judging sub-tabs `&judging=ranking|finalists`.

## Driving it with the browser and shot.mjs

Preconditions:

- Doctor passes; signed in; a practice event in the phase you need (from `/events/practice`). Event id read with `pnpm exec convex data events --limit 100 --format jsonl | jq -c 'select(.slug=="<slug>") | {_id, phase}'`.

- **Open.** Go to `/events/<slug>/admin` and wait for the skeletons to go. A practice event shows the `Practice` banner; the header has the breadcrumb, `Phase: <Phase>. Change phase`, `Share` and `Room`.
- **Views.** The view links are `Submissions <n>`, `Judging <a> of <b>`, `Stage <n>`, `Results`, `Settings`; each sets `?view=`. Reload with the same URL: the same view and filters come back.
- **Submissions.** Searchbox `Find a project, person or email`, filters `Status` and `Track`. Rows are grouped (`Waiting <n>`), each with project, team, tracks and contact.
- **Judging.** Tabs `Progress`, `Ranking`, `Finalists`; searchbox `Find a project`; clock button `<m:ss>. Click to type an exact time.`, `+5 min`, `Pause`, `Close judging`; `Copy all links` for judge links.
- **Phase change (writes).** Only on a practice event: click `Phase: <Phase>. Change phase`, choose the next phase, and read the event row before and after (`jq '{phase}'`). Restore with `Reset to the start` on the practice banner if the run needs the original state.
- **Proof.** Page text or accessibility snapshot per view, the URL with its query, and for any write the before and after Convex read.

## Gotchas

- `Regenerate AI summaries` (the button described "Rewrites every project's AI summary…") and `Create judging sheet` call OpenAI and Google: do not press them unless that is the feature under test, and never on a non-practice event.
- `Copy all links` puts private judge tokens on the clipboard. Do not paste them into reports.
- The admin page compiles slowly on first load in `next dev` (10 s or more); wait for the view links, not a fixed sleep.
- `Room` opens the presentation view in a new tab; drive it as [presentation-view](./presentation-view.md).
