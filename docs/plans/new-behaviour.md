---
title: New behaviour (PR 3) backend
status: IMPLEMENTING
tier: Tier 3
created: 2026-10-29
updated: 2026-10-29
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

## Decisions (29 October 2026, Demian's exact words)

| Decision | Words |
| --- | --- |
| Flexibility | "The whole idea of the app is to be flexible since fuckups happen all the timee" |
| One live event | "you can expect there be only 1 event live at a time per org for now, so we can structure the design around this. Usually people will be able to sign up for multiple tracks or no tracks and go only with the main event" |
| Judge links | "I don't think judges will use qr, since they will go from their laptops, not phones. We will likely just have a table of links per judge so you can share them as a table in a shared whatsapp group or notion page" |
| Score picker | "instead of slider, we already had a nice score picker with numbers, since having decimal is just too big" |
| Editing after submit | "no, at least not for now" |
| Practice lists | "they should be separate. Normal events shouldn't appear in practice events list and vice verca" |
| Onboarding | "No need for linear style onboarding like an org create since we wouldn't org creation for now. Everyone is invite only. Let's leave what we have" |

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
  from WorkOS): copy the live event (type, tracks, style, judging timer,
  stage and demo timers, meet link) or start a blank hackathon or demo
  night; then add N test judges and N test submissions.
- Test submissions go through the real submit path (`submitDemo` and
  `submitHackathon` share their code with it), with random tracks (a third
  with none) and team members. Test people use plus-addresses of the
  creator's email, so the confirmation emails reach them.
- Test judges are real judge links. `practice.scoreAsTestJudges` scores
  through the real review path.
- `practice.addPracticeSubmissions` (+5, +20, +50),
  `practice.skipTimerToLastSeconds`, `practice.resetPracticeEvent`.
- A daily cron tidies away practice events 14 days after their last change.

### 10. Tracks

Every organiser and judge query returns track names and ids per project,
with none meaning the main event.

Judging progress (`judging.getAdminProgress`) rows now carry the team name,
track names and track ids, with the event's tracks, for the track filter.

### MCP

Every new organiser action has a tool with the same checks:
`preview_phase_change`, `set_phase`, `reopen_submissions`,
`set_judging_time_left`, `pause_judging_timer`, `resume_judging_timer`,
`set_stage_timer_remaining`, `list_recent_changes`, `undo_change`,
`get_judges_overview` (a sensitive read), `replace_judge_link` (makes its own
token), `move_judge_scores`, `set_judge_link_active`, `get_live_event`,
`create_practice_event`, `list_practice_events`, `add_practice_submissions`,
`score_as_test_judges`, `skip_practice_timer` and `reset_practice_event`
(needs a matching confirmation). Changes an assistant makes show as an
assistant's in Recent changes.

The judge page functions (`judging.getJudgeWorkspace`,
`judging.confirmJudge`) are judge capability calls and get no tool, like
`judging.saveReview`. The UI step adds them to the coverage exclusions.

## Progress

- Done (backend, 29 October 2026): items 1, 2, 3, 6, 7, 8, 9, 10 and MCP.
  Items 4 and 5 need nothing new in Convex.
- Next: the UI on top of `codex/dq-redesign`. It removes each
  `UI_PENDING` entry in `scripts/mcp-admin-coverage.mjs` as it adds the
  caller.
- Not done: no deploy and no `convex dev`, so the functions have only run
  in convex-test.

## Proposed

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
- Test hackathon submissions queue an AI summary like real ones, so a
  practice run calls the model for each.
- The MCP coverage check lets these tools land before their admin UI
  (`UI_PENDING`); each entry goes stale once the UI calls the function.
- The Undo toast reads the newest change marked as yours from
  `changes.listRecentChanges` after a mutation.
