---
title: Hackathon judging follow-ups after Daytona HackSprint
status: DRAFT
tier: Tier 2
created: 2026-09-01
updated: 2026-09-01
---

# Outcome

Make three post-event improvements without changing the fast, link-based judging model:

1. Give the admin quick, evidence-backed checks for sponsor usage and repository activity before the hackathon.
2. Let the admin resolve multiple submissions of the same project before judging so the project is scored once.
3. Make the web judging flow and generated Sheet use the same effective judge roster and assignments.

The Daytona HackSprint winners were recorded in production on 2026-09-01 using the existing submitted finalist and placement records:

1. self playing volleyball AI
2. Guardrail
3. Model Debugger Tool

# Decisions

- **D01: Quick checks are advisory.** They appear only to the event admin and never automatically reject, hide, rank, or change a submission.
- **D02: Use deterministic evidence where possible.** Commit timing is calculated from GitHub timestamps. AI summarizes sponsor evidence and ambiguous repository signals; it does not invent a pass or fail without evidence.
- **D03: Every quick-check result cites its evidence.** Sponsor findings include repository paths or README references. Commit findings include the relevant commit or repository timestamp and the configured event start time.
- **D04: Run checks on demand from the single-project admin review.** Cache the result for the repository revision so an admin can revisit it without another GitHub or model call. A bulk “check every submission” action is deferred.
- **D05: Duplicate detection proposes groups; the admin decides.** Strong signals are the same normalized GitHub repository, the same participant or overlapping team identity, and a closely matching project title. AI may suggest weaker matches but cannot combine entries.
- **D06: Duplicate resolution preserves records.** The admin chooses one canonical submission. Other entries remain in Convex with a `duplicate of` relationship but are excluded from judging, Sheet ranking, finalist decisions, and presentation selection. Nothing is deleted.
- **D07: Resolve duplicates before judging.** If either entry already has completed reviews, the app stops the combine action and explains that no score-transfer policy exists. It does not merge or redistribute scores automatically.
- **D08: Convex assignments are canonical.** `events.roundOneJudges` is the current roster and each submission’s assigned judges are the current assignment. Judge links, admin selectors, and Sheet synchronization derive from that state through shared normalization and reconciliation helpers.
- **D09: The Sheet does not keep an independent first-roster snapshot.** A sync updates judge names when the corresponding score cells are blank. A populated score slot is never relabelled or overwritten; the sync reports the conflict for admin action.
- **D10: Sheet filter views cover the effective roster.** Create views for every active roster judge and retain a view for any legacy judge whose populated score cells must be preserved.
- **D11: Winners continue using the existing finalist and placement model.** This work does not add a second winner table or publish placements publicly.

# Approaches considered

## Smallest workable approach

- Add a repository-check action to the existing admin project review.
- Detect exact repository duplicates only.
- Fix Sheet synchronization to use the current Convex assignment while preserving populated score cells.

This solves the observed event failures with the least surface area. It is the recommended first delivery.

## Larger approach

Continuously scan every repository, automatically cluster similar projects, merge their reviews, and maintain a full eligibility policy engine. This was rejected because it would make advisory checks consequential, introduce unreliable score-merging rules, and slow down the live judging path.

# Product blockers

- **B01: Event start time source.** The schema currently has event creation and submission-closure timestamps, but no hackathon start time. Recommendation: add an explicit admin-set hackathon start timestamp and show “Start time not configured” instead of guessing. Using event creation as the boundary could incorrectly flag legitimate existing repositories.
- **B02: Sponsor list source.** Recommendation: let the admin enter the sponsors to check for each event, one per line, with Daytona configured for this event. Inferring sponsors from the event name would be unreliable.
- **B03: Default canonical duplicate.** Recommendation: suggest the newest submission as canonical because it is most likely the corrected version, but require one admin click to confirm it.

The plan remains `DRAFT` until these three recommendations are accepted or replaced.

# Behaviour and failure states

## Repository quick checks

- No GitHub repository: show `Not available`; do not call GitHub or AI.
- Repository unavailable or private: show the GitHub failure and allow retry.
- Start time absent: sponsor evidence may run, but the commit-timing result remains `Not configured`.
- No commit predates the configured start: show the earliest observed commit and `No earlier commits found`.
- Earlier commit exists: show `Repository activity predates the event` with the timestamp and link. This is a warning, not a disqualification.
- AI unavailable: retain deterministic GitHub evidence, show that sponsor interpretation could not run, and allow retry.
- Repository revision changed after a cached check: label the result stale and offer rerun.

## Duplicate projects

- No likely duplicate: submission proceeds normally.
- Suggested duplicate is not the same project: admin chooses `Keep separate`; that decision suppresses the same suggestion unless identifying fields change.
- Admin confirms a duplicate before judging: one canonical entry remains eligible and every consumer reports one project.
- Completed review exists on either entry: combining is unavailable and the admin sees which entries contain reviews. The app does not silently discard or combine scores.

## Judge roster and Sheet

- Roster changes before scores: assignments, private-link activation, Sheet judge cells, and filter views converge on the new roster after sync.
- Roster changes with web reviews: existing redistribution rules remain authoritative.
- Roster changes with Sheet-only scores: preserve the scored Sheet slot, keep its view, and report a reconciliation conflict instead of relabelling it.
- Sheet API or authorization failure: keep Convex roster changes, show the existing sync failure, and allow manual retry.

# Delivery topology

```text
wave 1   [J1] Current roster reaches web and Sheet      [A1] Evidence-backed repository checks
                    |
wave 2             [D1] Resolve duplicate projects before judging
```

| # | Slice | Lines | Needs | Branches from | Wave |
|---|---|---:|---|---|---:|
| J1 | Current roster reaches web and Sheet | 250–400 | none | `main` | 1 |
| A1 | Admin can run evidence-backed repository checks | 450–700 | none | `main` | 1 |
| D1 | Admin resolves duplicate projects before judging | 350–550 | J1 | `main` after J1 merges | 2 |

J1 and A1 can be implemented in parallel. D1 waits for J1 because duplicate exclusion must use the same eligibility snapshot consumed by both web judging and the Sheet.

# Slice details

## J1: Current roster reaches web and Sheet

**Depends on:** independent.

Create one shared resolver for normalized roster identities, active judge access, current submission assignments, and preserved scored Sheet slots. Use it when saving the roster and when building the Sheet sync snapshot. The Sheet may update only blank judge slots; score cells remain human-owned.

**Observable check:** A generated Sheet created with judges A and B is synced after the roster changes to A and C. With blank scores, the affected judge cells and filter views become C. With scores in B’s slot, B and the scores remain and the admin receives a reconciliation warning. The web judge-link list and reassignment selectors show the same active roster.

**Regression guard:** Unit tests exercise the shared resolver directly, and integration tests compare the roster returned to web consumers with the roster used to build Sheet filter views.

**Stop rule:** Stop if a scored Sheet slot cannot be mapped to a submission and slot without reading or rewriting human score cells.

## A1: Admin can run evidence-backed repository checks

**Depends on:** independent.

Add event review settings for start time and sponsor names, plus an admin-token-gated repository-check action. Fetch bounded GitHub metadata and repository evidence, calculate the commit boundary deterministically, and ask the configured model only to classify sponsor evidence. Persist a bounded result with its repository revision and evidence links.

**Observable check:** From the single-project admin review, an admin runs checks and sees sponsor evidence, the earliest relevant commit compared with the event start, checked time, and stale/retry states. Missing repository, missing start time, GitHub failure, and AI failure each have a distinct visible result.

**Regression guard:** The backend result schema requires evidence for every positive warning, and tests reject model output that names an unconfigured sponsor or returns an unknown repository path.

**Stop rule:** Stop if the available GitHub API cannot provide enough bounded evidence without downloading arbitrary repository contents or exceeding practical event-time rate limits.

## D1: Admin resolves duplicate projects before judging

**Depends on:** J1 merged.

Add a duplicate relationship and an admin review step after submissions close. Exact repository matches and strong team/title matches are proposed automatically. The admin selects the canonical entry or keeps entries separate. All judging eligibility consumers, Sheet export, finalist selection, and presentation actions use the same canonical eligibility helper.

**Observable check:** Two submissions with the same normalized repository appear as one proposed group. After confirmation, the canonical entry remains in judging and the Sheet, the duplicate remains accessible in Convex but cannot be assigned or selected, and reopening the admin page preserves the decision. `Keep separate` leaves both eligible.

**Regression guard:** Tests enumerate every eligibility consumer and assert that a confirmed duplicate cannot re-enter through assignment preparation, Sheet synchronization, finalist validation, or presentation selection.

**Stop rule:** Stop when either entry has completed reviews. Score transfer or aggregation requires a separate product decision.

# Validation and estimates

- Convex integration tests for roster reconciliation, duplicate eligibility, advisory result authorization, and winner/finalist isolation.
- Google Sheet fixture tests for blank-slot replacement, populated-slot preservation, and current-roster filter views.
- Browser checks for repository-check states and duplicate confirmation before judging.
- TypeScript and lint on each slice.
- One critical-error review limited to overwritten Sheet scores, duplicate projects being counted twice, unauthorized repository-check access, or advisory checks changing eligibility automatically.

Estimated effort is 6–8 implementation hours sequentially. If J1 and A1 are worked in parallel, estimated wall-clock time is 4.5–6 hours including integration checks.

# Cut from this plan

- Automatic disqualification based on AI or repository history.
- Automatic merging or averaging of reviews across duplicate submissions.
- Deleting duplicate submission records or participant pages.
- Bulk scanning every submission on a schedule.
- Private-repository OAuth or GitHub account linking.
- Public sponsor, eligibility, finalist, or winner displays.
- Changes to the existing public stage or queue.
