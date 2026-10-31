---
title: New behaviour (PR 3) backend
status: IMPLEMENTING
tier: Tier 3
created: 2026-10-29
updated: 2026-10-30
---

# New behaviour (PR 3) backend

## Outcome

The Convex functions, schema and MCP tools behind the new behaviour decided on
29 October 2026: any phase in either direction, exact timers, undo, the judges
table, the new judge page, AI summaries on submit, practice events and tracks
everywhere. The UI on top of the redesign comes in a later step and uses the
queries listed here as its contract.

Branch `codex/dq-new-behaviour`, from `290283b` (the tip of
`feat/getting-started`, equal to `codex/dq-features`). The PR is stacked on
`codex/dq-redesign`.

## Decisions (Demian's exact words, 29 October 2026 unless dated)

| Decision | Words |
| --- | --- |
| Flexibility | "The whole idea of the app is to be flexible since fuckups happen all the timee" |
| One live event | "you can expect there be only 1 event live at a time per org for now, so we can structure the design around this. Usually people will be able to sign up for multiple tracks or no tracks and go only with the main event" |
| Judge links | "I don't think judges will use qr, since they will go from their laptops, not phones. We will likely just have a table of links per judge so you can share them as a table in a shared whatsapp group or notion page" |
| Score picker | "instead of slider, we already had a nice score picker with numbers, since having decimal is just too big" |
| Editing after submit | "no, at least not for now" |
| Practice lists | "they should be separate. Normal events shouldn't appear in practice events list and vice verca" |
| Onboarding | "No need for linear style onboarding like an org create since we wouldn't org creation for now. Everyone is invite only. Let's leave what we have" |
| Judging header letters (30 October 2026) | "Do we need to say that those are judges? It should be obvoius, no? We can also make that on hover it would do something that would make it obvoious what i e d mean?" |
| B6 boards (30 October 2026) | "okay, looks nice, go ahead" |
| Practice AI summaries (30 October 2026) | "I think during the practice event creation you should be able to select whether the ai generation will go through "real" path or not, by default not, since it can be quite expensive" |

## Work

### 1. Any phase, either direction

- New `events.phase` field (`submissions`, `judging`, `stage`, `finished`).
  Events without it derive it from the existing state, so old events keep
  working: hackathon open submissions are `submissions`, closed judging is
  `stage`, anything between is `judging`; a demo event is `stage` once the
  queue is published.
- `phases.setPhase` moves to any phase. Each step reuses the existing
  behaviour: forward into judging closes submissions (and queues AI
  summaries); back to submissions reopens the submit link and pauses a
  running judging timer, keeping every score and assignment; forward out of
  judging closes judging when it was open; back from the stage into judging
  reopens judging when it was closed. A demo night has no judging phase.
- `phases.previewPhaseChange` lists what a move will do, as codes with plain
  text, for the confirm.
- `phases.reopenSubmissions` on its own.
- While submissions are reopened, judges cannot save scores ("Judging is
  paused"). Closing submissions again keeps the judging state and assigns two
  judges to each new submission when assignments were already made.

### 2. Exact timers

- `judging.setJudgingTimeLeft` sets the exact time left, running or paused.
- `judging.pauseJudgingTimer` and `judging.resumeJudgingTimer`.
- `events.setStageTimerRemaining` sets the stage timer's exact time left.

### 3. Undo

- New `eventChanges` table: one row per organiser change with who, what (a
  kind and a short summary), when, and the before and after values of every
  field it changed, per document.
- `changes.listRecentChanges` for the Recent changes list and the toast.
- `changes.undoChange` restores the before values only when every field still
  holds the after value. Otherwise it refuses and names the later change to
  undo first. Undoing a phase change runs the phase move back. An undo is a
  change too, so it can be undone.
- Changes that delete data (clearing the queue, resetting a practice event)
  are listed but cannot be undone.

### 4 and 5. Stage preview and Share

Client only, on top of the existing `events.getStage` and stage mutations.
Nothing new in Convex.

### 6. Judges page

- `judgeAccess.openedAt`: set when the judge confirms their name.
- `judging.getJudgesOverview`: one row per roster judge with link path,
  active, opened at, assigned and scored counts, helped count, and the
  event's judging totals. Copy all links (WhatsApp or Slack text, Notion
  table, active judges only) is built in the browser from it.
- `judging.replaceJudgeLink`: new token, the old link stops working, opened
  is cleared.
- `judging.moveJudgeScores`: moves one judge's reviews to another judge.
  Refuses a project both have scored.
- Turn off stays `judging.previewRedistribution` and
  `judging.applyRedistribution`, now undoable.

### 7. Judge page

- `judging.confirmJudge` records the name confirmation as Opened.
- `judging.getJudgeWorkspace`: everything the page needs in one query: the
  judge, timer, paused state, tracks with counts, every project in judging
  with its tracks, whether it is yours, your review, how many complete
  reviews it has and whether it needs help, and the counts for Yours, Help
  out, Scored and All.
- `judging.saveReview` accepts any project in judging from any active judge.
  A review on another judge's project counts as that judge's own review in
  scoring and normalization.
- Scores stay whole numbers from 0 to 10.

### 8. AI summary

- Queued when a hackathon team submits, as well as when submissions close.
- The close pass also refreshes a summary whose README changed: the action
  fetches the README, compares its hash with the stored `readmeHash` and
  writes a new summary only when it differs.
- Summary sections are a list of `{key, label, instruction}` with today's
  three as defaults (`lib/ai-summary.ts`), optional per event
  (`events.aiSummarySections`). Summaries are stored as sections; the three
  old fields stay for older rows and the current UI. No editor tonight.
- The evaluative-language check runs on every section.

### 9. Practice events

- `events.practice` flag, plus who made it, their email for test people,
  and what it was copied from. Same code paths as a real event.
- `events.listOrganizationEvents` and the MCP `list_events` leave practice
  events out; `practice.listPracticeEvents` lists only them.
- `events.getLiveEvent`: the organization's newest real event that is not
  finished. Never a practice event.
- `practice.createPracticeEvent` (an action, to read the creator's email
  from WorkOS): copy the live event (type, tracks, sponsors, style, judging
  timer, stage and demo timers, meet link) or start a blank hackathon or demo
  night; then add N test judges and N test submissions.
- Proposed: a blank practice hackathon starts with 3 sample tracks, each
  with a description (AI agents, Developer tools, Open), and 2 sample
  sponsors (OpenAI, Vercel), so track picks, the AI read and judging by
  track can be tried. They can be edited after.
- Test submissions go through the real submit path (`submitDemo` and
  `submitHackathon` share their code with it), with random tracks (a third
  with none) and team members. Test people use plus-addresses of the
  creator's email, so the confirmation emails reach them.
- Test judges are real judge links. `practice.scoreAsTestJudges` scores
  through the real review path.
- `practice.addPracticeSubmissions` (+5, +20, +50),
  `practice.skipTimerToLastSeconds`, `practice.resetPracticeEvent`.
- A daily cron tidies away practice events 14 days after their last change.
- `events.practiceAiSummaries`: `"sample"` (the default) or `"model"`, set
  by `createPracticeEvent` ("Write AI summaries with the real model", off by
  default). With `"sample"`, every submission in the practice event (test
  submissions, +N, phone submissions) gets a sample summary from its name
  and description at once, in the stored sections format, with no OpenAI or
  GitHub call. Judges see "Sample summary (practice)" instead of "Written by
  AI". Proposed: a sample summary also shows a sample AI read, a level and a
  sample reason for each picked track and each sponsor, worked out on each
  load and never stored. With `"model"`, summaries take the real path with
  the normal limits.
  Real events ignore the field.
- `practice.setPracticeAiSummaries` switches it later (the AI summaries
  practice tool). It is in Recent changes with Undo, and replaces the other
  kind of summary straight away, as does undoing it.

### 10. Tracks

Every organiser and judge query returns track names and ids per project,
with none meaning the main event.

Judging progress (`judging.getAdminProgress`) rows now carry the team name,
track names and track ids, with the event's tracks, for the track filter.

### 11. Withdraw and submit again

- The status page asks before withdrawing, inline: it names the project and
  says it leaves the lineup and judging, and judges stop seeing it. A team
  can withdraw only an entry that is waiting or in the lineup, never one the
  event team hid or moved on (done, no-show, current). The withdraw stores
  `withdrawnFromStatus` and `withdrawnBy`.
- `events.resubmitWithdrawnSubmission` (Proposed), checked by the participant
  token: while submissions are open, brings the same entry back with all its
  details and the same status link, to the status it was withdrawn from. Only
  for an entry the team withdrew themselves. The submit limits apply. It
  does nothing for an entry that is not withdrawn. It shows in Recent
  changes as the team's, without Undo.
- Once submissions are closed, the page says "Submissions have closed" and
  has no button.
- When another entry holds one of its emails, it says "An entry with this
  email already exists. We've emailed its status link to that address." and
  emails that entry's status link to the address on file, through the
  status-link email limits. It never returns another entry's link or token.
- An organiser's Restore still works on a withdrawn entry and clears the
  withdraw record; its Undo puts it back.

### MCP

Every new organiser action has a tool with the same checks:
`preview_phase_change`, `set_phase`, `reopen_submissions`,
`set_judging_time_left`, `pause_judging_timer`, `resume_judging_timer`,
`set_stage_timer_remaining`, `list_recent_changes`, `undo_change`,
`get_judges_overview` (a sensitive read), `replace_judge_link` (makes its own
token), `move_judge_scores`, `set_judge_link_active`, `get_live_event`,
`create_practice_event`, `list_practice_events`, `add_practice_submissions`,
`score_as_test_judges`, `skip_practice_timer`, `set_practice_ai_summaries`
and `reset_practice_event`
(needs a matching confirmation). Changes an assistant makes show as an
assistant's in Recent changes.

The judge page functions (`judging.getJudgeWorkspace`,
`judging.confirmJudge`) are judge capability calls and get no tool, like
`judging.saveReview`. The UI step adds them to the coverage exclusions.

## B6: event tabs and one Judging page (30 October 2026)

Built from the B6 boards (Overview, Judging, Ranking, Finalists).

- Event tabs under the page header: Overview, Presentations, Judging,
  Submissions, Settings, with counts (presenters, scores in of scores
  needed, submissions). The sidebar shows each event as one item with its
  phase. G then O, Q, J, U or T opens a tab; G then D opens Judging.
  `?view=judges` links redirect to Judging.
- Overview follows the phase. During judging its main block is the judging
  clock (+5 min, Pause, Close judging, click to type a time), the three
  review counts, each opening Judging filtered to those projects, and the
  judges, least scored first. Other phases are unchanged.
- Judging has three views, kept in the address (`judging=`, `project=`,
  `track=`, `group=`, `judge=`, `sort=`, `tracks=0`, `q=`, `raw=1`):
  - Progress: projects grouped by reviews still needed.
  - Ranking: per-judge chips (initials and I E D scores, a dashed chip for
    a missing review), a header with only the I E D letters, tooltips on
    letters and chips, the "Even out strict and generous judges" toggle and
    a detail panel with each judge's scores.
  - Finalists: tick finalists from all projects, submit them, then drag
    (or Alt and an arrow key) to order them; the top three are the winners.
    Submit winners uses the versioned `submitPlacements`.
- Everything the Judges page and the old judging panel did stays: judging
  sheet, judge links (open, copy, Replace link, Move scores, Turn off with
  a replacement per project), track filter, evened-out scores, hide from
  results and edit submission.
- Clock fix: every clock (Overview, Judging, judge page, stage) reads the
  time left through `lib/timer-clock.ts`. The cause was a cached
  `serverNow` read as if it were the time the client received it.
- React error 310 fix: the getting started guide reads its status through
  `useQueries`, so a failed query is a value, not a throw during render.

### B6 Proposed

- While judges score, the stage shows the judging clock ("Judging closes
  in") instead of the submissions clock.
- Tab counts come from the event details query, which now returns
  `lineupCount` and `scores`; a helper's extra review never counts past a
  project's two.
- Search and Display (sort, show tracks) are on every Judging view.
- Before judging closes, evening out is a view preference (`raw=1` turns
  it off). After, it is the saved per-judge decision.
- Clicking a row opens the detail panel in Progress and Ranking.
- Turn off asks for a replacement judge per project in the same dialog.
- J and K move between judges in the judges card; M opens Manage.
- Each judge on Overview has a menu: copy link, open in Judging.
- A judge who saved a score reads "opened" even when the open was not
  recorded.
- Finalists shows "Finalists open once judging is closed" before then.
- Edit submission opens Submissions with `edit=` set.
- Overview during judging leaves out the projects by track list; it is one
  tab away in Judging.
- MCP: finalist and winner picking stays in the admin page for now
  (exclusions in `scripts/mcp-admin-coverage.mjs`). `list_judge_links`
  and `get_judging_timer` stay for assistants although the page now reads
  wider queries (`TOOL_ONLY`).

## Progress

- Done (backend, 29 October 2026): items 1, 2, 3, 6, 7, 8, 9, 10 and MCP.
  Items 4 and 5 need nothing new in Convex.
- Done (change log privacy, 29 October 2026): a change that can't be
  undone keeps no documents; inserts keep only the id; secret fields
  (participant and judge link tokens) are kept only as sha256 markers, so
  Replace link can't be undone; a daily job removes rows older than 30
  days, and the practice tidy removes an event's rows with it.
- Done (UI, 29 October 2026): the live event home, Share, the Judges page,
  the judge page, track chips in Judging, the Practice list, the practice
  bar and practice tools, and command menu entries for each. `UI_PENDING`
  is empty.
- Verified on a local anonymous Convex deployment with a WorkOS mock:
  screenshots in `docs/reports/new-behaviour/`. No deploy.
- Done (review findings, 29 October 2026): AI summary limits and public
  READMEs only, undo safety (versions, dependent scores and members,
  moved-score clashes, timer phases), turned-off judges, practice tidy,
  the queue helper, Move scores clashes, the judge summary sections, timer
  shortcuts, the phase confirm and the Live now group. Each has a test.

## After merge

- Proposed: set `GITHUB_TOKEN` on the production Convex deployment for
  README reads (5,000 requests an hour instead of 60). It must be a
  fine-grained token with "Public repositories (read-only)" access and no
  other repository access. Without it, reads stay unauthenticated.

## Proposed

- Submit again on the status page, for an entry the team withdrew while
  submissions are open. A queued entry comes back at the end of the lineup,
  not its old place.

- The phase is stored on the event; old events derive it.
- A demo night has three phases: Submissions, Stage, Finished. Its submit
  link stays open on the stage, as today.
- Moving forward past judging that never started leaves judging as it was
  (skipped), instead of closing it.
- Judges cannot save scores while submissions are reopened.
- Closing submissions again after judging started assigns judges to new
  projects straight away.
- Undo refuses when a later change touched the same fields, and names it.
- The live event is the newest real event that is not finished.
- Practice events tidy away 14 days after the last change.
- Reset to the start keeps test submissions and judges, and clears scores,
  assignments, the lineup and timers.
- Moving scores refuses a project both judges have scored.
- Recent changes return the person's WorkOS user id; the page shows names
  from the members list.
- Practice events need 0 test judges, or 2 to 10 (each project needs two).
- Test people's phone numbers come from the reserved drama range
  (+44 20 7946 0xxx), so they never reach a real phone.
- The MCP coverage check lets these tools land before their admin UI
  (`UI_PENDING`); each entry goes stale once the UI calls the function.
- The Undo toast reads the newest change marked as yours from
  `changes.listRecentChanges` after a mutation.
- Change log rows are kept for 30 days.
- A replaced judge link can't be undone ("A replaced link can't be brought
  back"), since its old token is not kept.
- Moving forward applies at once; only a move back asks first, inline.
- The timer key sequences: E to type a time, T then 5, 1 0, 1 5 or 3 0 for
  the presets, P to pause or resume, Shift T to skip to the last 10 seconds
  in a practice event, F for the full screen QR.
- The submissions phase shows the stage timer, labelled "Submissions close
  in".
- Recent changes note: "Most changes can be undone from here, and from the
  toast right after you make it."
- Names in Recent changes come from a server action over the members list.
- A practice event's home keeps the live home's right column (stage,
  properties, Recent changes) instead of the getting started cards.
- Track chips share one colour; no colour per track. The sidebar shows no
  counts.
- A judge who confirmed once is not asked "Are you X?" again on that link.
- On the judge page, pressing 1 then 0 within 700 ms scores 10.
- A paused clock reads "Clock paused at mm:ss" on the judge page; judging
  paused by reopened submissions reads "Judging paused".
- Adding test submissions is off once submissions close, with the note
  "Submissions are closed. Move back to Submissions to add more."
- AI summaries: at most one run per submission per 10 minutes, and a
  daily budget per event of 3 runs per submission, at least 20.
  Participants queue none once submissions are closed.
- A rate-limited README read does not wait: a new summary is written at once
  without the README, and an existing one is kept. The next close of
  submissions reads the README again.
- README text is read only from repositories GitHub reports as public.
- Going back from Stage to Submissions on a demo night leaves the lineup
  published; the confirm says "The lineup stays published."
- Recent changes checks up to 1,000 stored documents per list, newest
  change first; a change past that shows "This change is too large to
  check here. Undo newer changes first."
- A timer change can be undone only in the phase it was made in.
- "What the numbers mean" on the judge page is collapsed by default.
- When the language check rejects an AI summary, the run tries once more with a
  stricter instruction. If that is rejected too, or a run fails or runs out of
  README retries, judges see "No summary" until the description or repository
  changes.
