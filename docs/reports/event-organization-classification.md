# Historical event organization classification

Status: Approved on 27 October 2026 for ownership assignment after merge and
deployment. No production records have been changed.

Read-only production inventory checked on 27 October 2026. All 25 events have no organization. The read requested up to 1,000 rows and returned 25. The complete WorkOS production organization listing contains Outpost and Test only.

## Approved assignment

6 events to Outpost and 19 to Test. The renamed Daytona event is Outpost and
SwiftXR is Test. The complete manifest is approved. Event names and publication
state supplied classification evidence; the two ambiguous rows received an
explicit ownership decision.

| Event | Slug | Approved organization | Review | Reason |
| --- | --- | --- | --- | --- |
| test 1 | `test-1-8d81a6` | Test | Approved | Explicit test/debug event name. |
| test | `test-04dfc4` | Test | Approved | Explicit test/debug event name. |
| Codex meetup: GPT-6 ASTRA | `codex-meetup-gpt-6-astra-2c2568` | Outpost | Approved | Named community meetup or HackSprint. Outpost assignment approved. |
| test | `test-7dd381` | Test | Approved | Explicit test/debug event name. |
| ZZ Debug Probe | `zz-debug-probe-95ab5d` | Test | Approved | Explicit test/debug event name. |
| Daytona HackSprint - London, August 2026 | `daytona-hacksprint-london-august-2026-a76e6e` | Outpost | Approved | Named community meetup or HackSprint. Outpost assignment approved. |
| test hack 5 | `test-hack-5-063e28` | Test | Approved | Explicit test/debug event name. |
| Daytona HackSprint - London, August 2026 | `test-hack-5-1db202` | Outpost | Approved | Explicitly confirmed Outpost despite the original test slug. |
| test hack 5 | `test-hack-5-4a554d` | Test | Approved | Explicit test/debug event name. |
| test hack 4 | `test-hack-4-18a4b3` | Test | Approved | Explicit test/debug event name. |
| test hack 3 | `test-hack-3-693570` | Test | Approved | Explicit test/debug event name. |
| test hack 2 | `test-hack-2-b054fd` | Test | Approved | Explicit test/debug event name. |
| test hack | `test-hack-77e3e2` | Test | Approved | Explicit test/debug event name. |
| test | `test-a3f042` | Test | Approved | Explicit test/debug event name. |
| test event | `test-event-8f5310` | Test | Approved | Explicit test/debug event name. |
| Test | `test-5adaf2` | Test | Approved | Explicit test/debug event name. |
| test | `test-aad9bb` | Test | Approved | Explicit test/debug event name. |
| Codex Community Hackathon 18th July 2026 | `codex-community-hackathon-18th-july-2026-b29005` | Outpost | Approved | Named community meetup or HackSprint. Outpost assignment approved. |
| test 1 | `test-1-93c0bb` | Test | Approved | Explicit test/debug event name. |
| test | `test-72459f` | Test | Approved | Explicit test/debug event name. |
| SwiftXR Guassian Splatting | `swiftxr-guassian-splatting-0a2d3f` | Test | Approved | Explicitly confirmed Test. |
| Codex Community Meetup 3 | `codex-community-meetup-3-0c20e4` | Outpost | Approved | Named community meetup or HackSprint. Outpost assignment approved. |
| test 1 | `test-1-0a16d5` | Test | Approved | Explicit test/debug event name. |
| test | `test-12007b` | Test | Approved | Explicit test/debug event name. |
| Codex Community Meetup London #2 | `codex-community-meetup-london-2-968789` | Outpost | Approved | Named community meetup or HackSprint. Outpost assignment approved. |

## Exact destinations

Approved manifest SHA-256, computed from normalized JSON by `manifestHash`:
`729b689cfdd07f941252fd939baef4e1c39a527588907053ad7680efa69e7b67`.

- Outpost: `org_01M5WZN8BW5GYKKED6Q7XQHDDK`.
- Test: `org_01M5WZNE05EYW9TZ2CF7W0QSEE`.

## Execution safety

The [proposed manifest](event-organization-proposed.json) preserves exact inventory event IDs and slugs. Every expected owner is null. The migration changes only organization ownership. Event content, submissions, judging, participant and judge links remain unchanged. Historical admin-token fields stay inert and never authorize administration.

The helper defaults to a read-only plan. Applying requires the exact reviewed manifest hash and an already-deployed internal mutation. A duplicate ID, changed slug, or conflicting existing owner rejects the batch. Repeating an already-completed assignment is a no-op.

Classification and production ownership assignment are approved after the
required code is merged and deployed. Do not deploy or apply before that merge.
Removing legacy admin authorization before assignment would leave these
historical events unavailable for administration until migration. Public
participant, judge and presentation routes remain account-free.

## Confirmed choices and separate slug change

The Daytona event with slug `test-hack-5-1db202` belongs to Outpost. SwiftXR with
slug `swiftxr-guassian-splatting-0a2d3f` belongs to Test. All other proposed rows
are approved unchanged.

The proposed readable Daytona slug is
`daytona-hacksprint-london-august-2026-1db202`. That rename is separate from the
approved ownership-only manifest. Preserve old participant, judge, submission,
and presentation links through a slug alias before changing the canonical slug.

No production code deployment or migration has been performed. The manifest is not an execution receipt.
