---
title: Hackathon Judging Run Ledger
status: COMPLETE
tier: Tier 3
created: 2026-08-29
updated: 2026-08-29
---

# Hackathon Judging Run Ledger

## Accepted Source

- Plan: `docs/plans/hackathon-judging.md`
- Branch: `codex/hackathon-judging`
- Worktree: `/Users/demian/.codex/worktrees/85c4/demo-queue`
- Starting commit: `be5c21e463b85db54808ffe273888131f4ba6f90`
- Remote starting commit: `be5c21e463b85db54808ffe273888131f4ba6f90`
- Continuation: heartbeat `continue-hackathon-judging-implementation`, every 30 minutes
- Coordination task: `01a0490e-4950-7be0-9195-4a114eaf5945`

## External Mutation Allowlist

- Commit and push accepted judging work to `codex/hackathon-judging`.
- Run and restart local Next.js and Convex development processes when their identity is verified.
- Sync only canonical development Convex `precious-elk-564` after the local schema preserves the redesign task's optional `visualStyle` field.
- Create and mutate only a disposable development Google Sheet for verification.
- Send concise conflict-coordination messages to task `01a0490e-4950-7be0-9195-4a114eaf5945`.

## Denylist

- No production Convex deployment, data mutation, or deployment configuration.
- No mutation of the historical July judging Sheet.
- No reset or event-type rework.
- No WorkOS, second-round judging, branding, or public finalist behavior.
- No writes to the redesign task's branch.
- No broad architecture review expansion beyond the accepted critical-error check.

## Coordination State

- Redesign branch: `codex/outpost-visual-style`
- Stable redesign feature commit: `3ab7050`
- Stable redesign instruction commit: `b7f022e`
- Overlap: `convex/schema.ts`, `convex/events.ts`, and `app/globals.css`
- Development Convex already contains the redesign's optional `visualStyle` schema.
- Redesign task has agreed not to run further Convex syncs while judging work is active.
- Judging task must not sync its schema until `visualStyle` compatibility is present locally.
- Redesign refinement resumed only on public-page files. It will not touch Convex or run a sync. Judging will avoid `app/globals.css` and integrate the small participant-page overlap after the redesign commit is stable.

## Wave Ledger

| Wave | Slice | Premise | Stop rule | Expected check | State |
|---|---|---|---|---|---|
| 1 | S1 shared model, rubric, access, tests | Existing round-one judge and assignment fields remain canonical | Stop on incompatible persisted schema or private-link leakage | Unit, Convex integration, TypeScript, and lint checks passed | complete |
| 2 | S2 judging backend | S1 schema and access contract merged | Stop if 500 assignments cannot be prepared without partial judge visibility | Convex integration covers 500 assignments, one-review ranking, link isolation, and unfinished-slot redistribution | complete |
| 2 | S3 Sheet fallback | Shared rubric exists and current sync preserves human score cells | Stop before any write that can replace a populated tab or human score | Local tests passed; one tab and four generated views verified live; automatic sync blocked by expired backend Google authorization | complete; one external live check skipped |
| 3 | S4 judge workflow | S2 judge API stable | Stop if judge payload exposes rankings or other judges | Rendered private judge flow verified with autosave, overtime, assignment isolation, and read-only closure | complete |
| 3 | S5 admin workflow | S2 admin API stable | Stop if demo-event behavior changes | Rendered admin setup, timer, raw-score visibility, close, reopen, and coverage states verified | complete |
| 4 | S6 normalization | Completed-review aggregation stable | Stop if raw values can be overwritten or unapproved adjustment can rank | Per-judge choices, low-data warnings, clamping, staleness, and raw-to-final values verified | complete |
| 4 | S7 finalists and placements | Score-basis and admin extension points stable | Stop if finalist submit changes queue, stage, Sheet, or public state | Finalist, placement, amendment, participant-private, and history paths verified | complete |
| 5 | S8 integration and critical review | S3, S6, and S7 merged | Stop on data loss, private leak, or broken end-to-end path | Development sync, aggregate checks, browser flow, private-page and stage isolation checks | complete; Sheet resync skipped |

## Last Verified Synchronization Point

- The judging schema and functions were synced only to canonical development deployment `precious-elk-564`.
- A disposable development event completed the full admin, judge, normalization, finalist, placement, amendment, participant-private, and stage-isolation flow.
- A disposable Google Sheet was created in the signed-in account with one `Judging` tab and views for all submissions, Alice, Bob, and Cara.
- Production Convex and the historical July Sheet were not mutated.

## S1/S2 Worker Update

- Worker: `/root/judging_backend_map`
- Implemented backend-only schema and APIs in `convex/judging.ts`, shared rubric in `lib/judging-rubric.ts`, and optional redesign-compatible visual style files.
- Added closure guards in `convex/events.ts` and participant finalist boolean return field.
- Root corrected two critical product behaviors before accepting the slice: closing submissions is idempotent and cannot reset active judging, and unavailable-judge redistribution replaces only that judge's unfinished slot while preserving the other judge and completed review.
- Assignment preparation now uses a durable Convex pagination cursor and is covered with 500 submissions. Judge links are raw private capability URLs with exact-match access, matching the existing admin-link model.
- `pnpm test` passed (28 tests), `pnpm test:convex` passed (3 integration tests), `pnpm exec tsc --noEmit` passed, and targeted ESLint passed.
- Not run yet: canonical development Convex sync, external Sheet operations, rendered browser checks, or production actions.
- Remaining later-wave dependency: submitted finalist and placement history for S7. Submission closure is intentionally one-way; reopening submissions remains out of scope.

## S3 Sheet Update

- The generated Sheet remains one simple `Judging` tab. Sync writes submission details, formulas, blank judge labels, and filter views but never human score cells or populated judge labels.
- One named view is created per judge and one all-submissions view sorts by final score. Repeat sync updates the generated views instead of duplicating them.
- Final score uses each complete three-criterion review independently: two complete reviews are averaged, one complete review is rankable, and zero complete reviews remain blank.
- Finalist and presentation state are absent. Sheet status is limited to `eligible`, `excluded`, or `assignment drift`.
- An incompatible existing `Judging` tab now stops sync with a clear error and is left untouched instead of being deleted or replaced.
- The shared rubric supplies criterion labels, category count, and the 0–10 bounds to both app and Sheet code.
- Live validation remains limited to a disposable development Sheet in S8. The historical July Sheet has not been mutated.

## S4/S5 UI Update

- Added one noindex private judge route. Before judging it shows a waiting state; while open it shows only that judge's assignments, signed timer, completion count, and fixed 0–10 rubric controls; after close it becomes read-only.
- Every rubric change uses the ordinary Convex mutation and shows Saving, Saved, or Error. The judge payload contains no rankings, aggregate scores, or other judges.
- Added one hackathon-only admin judging panel. It creates and copies judge links, closes submissions, prepares assignments, controls the configurable timer, adds time, closes or reopens judging, and shows coverage plus raw per-judge scores.
- Unavailable-judge redistribution now shows every affected submission, proposed replacement, preserved completed work, and a manual replacement choice before apply.
- Demo-event behavior and global styling are untouched. Judge and admin judging styles are local modules, avoiding the redesign task's `app/globals.css` work.
- Browser rendering remains pending until the canonical development Convex schema/functions are synced in S8.

## S6/S7 Backend Update

- Normalization is computed per judge and criterion from complete, currently assigned reviews only. The admin sees raw values, proposed deltas, unclamped values, final clamped 0-10 values, and averages.
- Each contributing judge receives an independent `Apply adjustment` or `Keep raw` choice. The combined score basis becomes ready automatically when every contributing judge has a fresh choice; judges with zero complete reviews need no choice.
- Only an actual completed-review change invalidates normalization. Ordinary partial autosaves do not. A change marks only that judge's choice stale while preserving the other judges' choices.
- Finalist ranking applies fresh approved adjustments, preserves raw scores separately, accepts one complete review with a warning, and leaves zero-review submissions visible and unranked.
- Finalist submission changes only the private `finalist` boolean and current decision record. Placement submission has its own version and cannot change the finalist version. Draft edits do not enter submitted-version history.
- Finalists and placements can be amended. Removing a placed finalist prunes that placement and marks placements `Needs review` without changing queue or presentation state.
- TableHistory is mounted and integration-tested for submitted finalist and placement snapshots only.
- Before live verification, `pnpm test` passed 32 tests, `pnpm test:convex` passed 4 integration tests, and TypeScript passed. The final aggregate check is recorded with the delivery commit.

## S8 Live Verification Update

- Canonical development sync completed against `precious-elk-564`; the TableHistory component, schema indexes, and judging functions were accepted.
- The browser flow used five synthetic submissions and three judges. Two judges completed reviews, including one-review and zero-review submissions. The admin saw raw coverage while judging remained open.
- The timer visibly continued below zero without disabling judge scoring. Score edits autosaved and became read-only only after the admin closed judging.
- Normalization was chosen independently per contributing judge. The browser showed low-data warnings, unclamped values above 10, clamped values at 10, and raw-to-final score changes.
- Finalists were selected, reordered, submitted, amended, and reflected only on the selected participant's private submission page. The presentation stage remained unchanged.
- Placements were ordered and submitted separately. Removing a placed finalist pruned that placement and changed the placement draft to `Needs review`.
- The generated Sheet has one `Judging` tab and the expected all-submissions and per-judge views. Its later automatic sync failed because the backend Google authorization is no longer valid, so live manual-score preservation and retry could not be exercised.
- The critical-error pass found and fixed one interaction bug where the full finalist row intercepted the Add button's pointer event. Drag listeners now live only on the drag handle.
