---
title: Hackathon Judging
status: COMPLETE
tier: Tier 3
created: 2026-08-29
updated: 2026-08-29
---

# Hackathon Judging

## Outcome

Add one private hackathon judging round to the existing Demo Queue app. Judges score assigned submissions from private links. The existing event admin runs judging, approves normalization per judge, selects and submits finalists, and records ordered first-through-third placements.

Keep the current Google Sheet as a deliberately simple fallback. Demo events remain unchanged.

## Agreed Behavior

These are accepted decisions, not questions to reconfirm unless implementation reveals a direct contradiction.

1. The coordinator is the existing full event admin. There is no separate coordinator role.
2. The admin closes submissions before judging starts. After closure, no new submissions or participant withdrawals are accepted.
3. Each judge gets a separate private capability link and can see only their assignments and scores.
4. The fixed rubric is Innovation, Execution, and Demo clarity, each scored from 0 through 10.
5. The app and generated Sheet use one shared rubric definition so criteria and limits cannot drift.
6. A review is complete only when all three criteria are filled. Scores autosave; there is no separate judge submit button.
7. Two reviews per submission are the target, not a requirement:
   - `2/2`: score and rank normally.
   - `1/2`: score and rank with a warning.
   - `0/2`: no score or rank; show a warning and keep the submission available for manual finalist selection.
8. Partial reviews are saved but do not affect scores, rank, or normalization.
9. The admin can inspect raw scores while judging is open. Judges cannot see rankings or other judges' scores.
10. The admin sets judging time and may add time. The timer continues into negative overtime and never blocks judge input. Only the admin closes judging.
11. Initial assignments balance remaining workload, use two distinct judges where possible, and avoid repeating the same judge pair where possible.
12. Reassignment preserves completed reviews and redistributes only unstarted or partial reviews. The app previews a load-aware proposal and allows manual overrides.
13. Normalization is mean-centering per judge and criterion: `raw - judge mean + event mean`.
14. Adjusted scores are clamped to 0-10. The admin can see the raw score, proposed delta, unclamped value when relevant, and final clamped value.
15. A judge with fewer than five complete reviews gets a low-data warning, but the admin may still choose the adjustment.
16. Normalization approval is per judge: `Apply adjustment` or `Keep raw`. The combined score basis becomes ready automatically once every judge with at least one complete review has a fresh choice. There is no extra confirmation step.
17. Any contributing score edit recomputes normalization, marks only that judge's choice stale, and makes the combined score basis unready until that judge chooses again. Partial autosaves do not invalidate normalization.
18. The finalist deliberation view keeps all submissions on the left, sorted by the confirmed score basis, and an ordered finalist draft on the right. Unreviewed submissions remain visible.
19. The admin can drag submissions into, out of, and within the finalist draft. Selected submissions remain visible and subdued on the left.
20. `Submit finalists` stores the current finalist list in Convex and changes only finalist status on each affected participant's private submission page.
21. Submitting finalists does not change the stage, presentation lineup, public pages, email, or Sheet.
22. The admin may amend and resubmit finalists at any time.
23. Placements use a separate mode and submit action. The admin chooses one, two, or three awarded places, orders the placement draft, and submits it.
24. Placements are admin-only for now and may be amended and resubmitted.
25. If a placed finalist is removed, the placement draft removes them, shows `Needs review`, and lets the admin reorder and resubmit.
26. Previous submitted finalist and placement versions are retained with `@convex-dev/table-history`.
27. Reopening judging keeps the last submitted finalist status active, but marks normalization and the finalist and placement drafts `Needs review`. Resubmission requires judging to close and the score basis to be reconfirmed.
28. Existing hackathon queue copy is separated from judging finalist copy: `Presentation lineup` and `Scheduled to present` describe the queue; `Finalist` describes the submitted judging decision.

## Google Sheet Fallback

1. Keep the current `Generate Sheet`, automatic sync, and `Sync now` behavior.
2. Keep one Judging tab. Do not add finalist, placement, normalization-approval, or second-round tabs.
3. Add one named filter view per judge and one all-submissions view sorted by score.
4. All judge columns may remain visible. The fallback favors simplicity and reliability over privacy between judges.
5. Formulas accept one or two complete reviews, ignore partial reviews, and leave zero-review scores and ranks blank.
6. The Sheet and app import the same fixed rubric definition.
7. **Established behavior:** Human-entered Sheet score cells are never overwritten. This is not a pending design decision.
8. Judge labels on an existing generated row are immutable. If app reassignment later differs, show assignment drift rather than relabeling existing Sheet scores.
9. A populated Judging tab is never deleted or recreated. An incompatible layout stops safely and keeps the working tab untouched.
10. Sheet status is neutral judging eligibility and coverage. It does not expose finalist or presentation state.
11. App scores do not sync into the Sheet, and Sheet scores do not sync into the app. The Sheet remains an independent fallback.

## Implementation Shape

Keep the current round-one fields as canonical:

- `events.roundOneJudges`
- `submissions.roundOneAssignedJudges`

Do not introduce a legacy-to-new assignment migration for this delivery.

Add only the state needed around those fields:

- Event fields for submission closure, judging status, configurable timer, assignment preparation, and confirmed score-basis version.
- A judge-access table containing event, normalized judge key, private capability token, active state, and timestamps.
- A review table keyed by event, submission, and judge key, with three optional criteria, completion state, and timestamps.
- Small per-judge normalization-decision records.
- One current finalist/placement decision record per event, with TableHistory mounted for submitted-version history.
- Indexed and paginated judging queries for judge work, admin progress, submission scoring, and finalist deliberation. Do not enlarge the existing broad admin subscription with all review rows.

For 500 submissions, assignment creation and large redistribution run in bounded batches while the event is `Preparing assignments`. Judges cannot start until the complete assignment version is activated. This is the only batching workflow in the current scope.

Once assignments are activated, those assigned submissions are the round population regardless of later presentation-queue status. This avoids adding a separate eligibility-snapshot system.

Each score edit uses a normal Convex React mutation. Convex executes mutations from one client in their triggered order, so no custom autosave queue or review-version system is needed.

## Critical Safety Rules

1. A judge function validates the exact private capability token, event, judge key, and active state before returning any private data.
2. Raw review values are never overwritten by normalization or reassignment.
3. No submission can be counted twice for the same judge, and one judge cannot fill both assignment slots.
4. A partial or zero-review submission never receives an invented score.
5. A Sheet sync never overwrites score cells, relabels an established judge slot, or replaces a populated tab.
6. Submitting finalists never mutates queue, stage, presentation, Sheet, or placement state.
7. Participant queries return only that participant's submitted finalist boolean, not draft order, scores, rank, normalization, or placements.
8. Event reset and event-type change after judging data exists are unavailable. Their full cleanup and history behavior are deferred to a separate plan.

## Review Triage

The broad architecture review was stopped at the user's request. Only findings that prevent data loss, private-data exposure, or a broken live judging path remain in scope.

Kept because they are critical:

1. Judge capability validation before private reads or writes.
2. Raw-score preservation and visible normalization changes.
3. Preserving the existing Sheet guarantee that sync never changes human score cells.
4. Bounded assignment preparation before judges can start at the 500-submission target.
5. Separate judging-finalist and presentation-lineup state.

Skipped as unnecessary expansion for this delivery:

1. Generic multi-round tables and a new assignment source of truth.
2. A legacy-to-new judging migration and multi-state cutover protocol.
3. A separate eligibility-snapshot subsystem.
4. Reworking event reset, event-type changes, or event-scoped history deletion.
5. Broad architecture, conformance, and extensibility review rounds beyond the final critical-error check.
6. Any future presentation, notification, organization, configurable-rubric, or second-round architecture.

## Delivery Waves

```text
wave 1   S1 shared model, rubric, access, and tests
                         |
wave 2   S2 judging backend        S3 Sheet fallback
                         \          /
wave 3   S4 judge workflow         S5 admin workflow
                         \          /
wave 4   S6 normalization          S7 finalists and placements
                         \          /
wave 5   S8 integration, live checks, and critical-error review
```

| Slice | Work | Depends on | Target |
|---|---|---|---:|
| S1 | Shared rubric, schema additions, private judge capabilities, submission closure, TableHistory setup, and Convex test harness | none | 45-60 min |
| S2 | Batched assignment, reassignment, reviews, ordinary Convex autosave, scoring, progress, and score-basis query | S1 | 45-60 min |
| S3 | One-review formulas, filter views, neutral status, immutable judge labels, and populated-tab preservation | S1 | 30-45 min |
| S4 | Private judge page, timer, autosave feedback, navigation, closed and error states | S2 | 45-60 min |
| S5 | Admin setup, links, timer, progress, raw scores, close/reopen, assignment preview, and presentation-lineup copy | S2 | 60-90 min |
| S6 | Per-judge normalization preview, clamping, approval, invalidation, and confirmation | S4, S5 | 30-45 min |
| S7 | Finalist board, private participant status, amendments, placement ordering, and TableHistory recording | S2, S5 | 45-60 min |
| S8 | 100/500-submission fixtures, browser flows, live Convex and Sheet checks, aggregate tests, and critical fixes | S3, S6, S7 | 60-90 min |

### Wave ownership

- All slices land on `codex/hackathon-judging`; no partial deployment or production mutation is allowed.
- Parallel branches start only after their dependency is merged to trunk.
- Shared types and UI primitives land in the dependency slice, not copied into parallel branches.
- S4 and S5 use separate route components and local styles.
- S6 and S7 use separate admin extension components, so they can land independently.

## Validation

- `pnpm test`
- `pnpm test:convex`
- `pnpm lint`
- `pnpm build`
- Rendered browser checks for judge, admin, and participant-private states.
- A disposable generated Sheet check covering per-judge views, one-review ranking, zero-review blanks, manual score preservation, and safe retry.
- Development Convex check only against canonical `precious-elk-564`.
- One final critical-error review limited to private-data leakage, raw-score loss, Sheet-score loss, invalid finalist exposure, and a broken start-to-finish judging path.

Browser access and the canonical development Convex deployment were verified during implementation. A disposable Sheet and its judge views were created in the signed-in Google account. The later automatic sync could not be verified because the backend's saved Google authorization had expired; local coverage still verifies that sync preserves human score cells.

## Blocking Questions

None. Event reset, second-round judging, WorkOS, branding, and the other items below are explicitly deferred.

## Estimate

- Target wall clock with three parallel implementation streams and one integrator: **5-7 hours**.
- This includes test setup, browser and live-development checks, one critical-error review, and one normal fix pass.
- Human product review and merge latency are not included.
- Re-estimate only if an external integration is unavailable or a critical safety rule cannot be met with the existing model.

## Deferred

- Optional second-round judging.
- Event reset and event-type changes after judging data exists.
- Reopening submissions or allowing post-close additions or withdrawals.
- Configurable rubric criteria or score range.
- Bidirectional app and Sheet score sync.
- Finalists, placements, or normalization approval in the Sheet.
- Finalist effects on the presentation queue, stage, public pages, or email.
- Public rankings, public finalist lists, and public placements.
- Placement ties, prizes, and custom award categories.
- Separate coordinator permissions and judge accounts.
- WorkOS organization access, tracked in its separate task.
- Andy's branding request and general redesign.
