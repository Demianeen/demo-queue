# MCP tools

All 60 tools in the current server catalog. The component alternative filters
discovery and calls by Read or Manage permission. Manage includes Read. Contacts
and private judge links require Manage. Organization access is checked separately.

| Tool | Permission | What it does |
| --- | --- | --- |
| `list_organizations` | Read | List current active memberships covered by this connection's organization approval. |
| `list_events` | Read | List safe event metadata in an approved organization. |
| `get_event` | Read | Read safe event metadata. Capabilities, contacts, and judging records are excluded. |
| `create_event` | Manage | Create an initially unpublished event using a saved style, built-in preset, or the organization default. |
| `list_styles` | Read | List built-in presets and saved structured styles. |
| `create_style` | Manage | Create a new nondefault structured style. Existing styles are never updated. |
| `set_default_style` | Manage | Explicitly change the organization default. Existing event snapshots remain unchanged. |
| `get_event_overview` | Read | Read the event summary, submission count, judging and confirmed results status. |
| `get_event_admin` | Read | Read event controls, all six submission groups, team and video links, stage/demo timers and Sheet sync state. Contacts and capability tokens are excluded. |
| `get_submission_contacts` | Manage | Explicit sensitive read of one submission's contact/social fields and team-member contacts. |
| `add_submission` | Manage | Add one demo submission to the lineup or pool. Participant capability is generated privately. |
| `add_test_submissions` | Manage | Add 1 to 25 test submissions per call, including hackathon teams. All participant capabilities are generated privately. |
| `save_judges` | Manage | Save the event's round-one judge roster, preserving existing assignment/review constraints. |
| `change_event_type` | Manage | Change event type. Requires matching confirmation and confirmReset when submissions exist. Deletes submissions, team members and uploads, resets queue/timers and disconnects the Sheet. Does not delete the external Sheet. |
| `request_judging_sheet_sync` | Manage | Request asynchronous Sheet synchronization. Read get_event_admin revisions and errors to verify completion. |
| `update_submission` | Manage | Edit submission text and contact fields with the same validation as the admin app. |
| `publish_queue` | Manage | Publish the lineup and switch the stage to demo mode. |
| `set_stage_screen_mode` | Manage | Choose the stage's QR or demo screen. |
| `set_submission_count_visible` | Manage | Show or hide the submission count on the stage. |
| `set_stage_meet_link_visible` | Manage | Show or hide the meet link on the published stage. |
| `set_stage_timer_visible` | Manage | Show or hide the stage timer. |
| `set_stage_timer_duration` | Manage | Set the stage timer duration in milliseconds. |
| `start_stage_timer` | Manage | Start or resume the stage timer with an optional duration. |
| `set_demo_timer_visible` | Manage | Show or hide the current demo timer. |
| `set_demo_timer_duration` | Manage | Set the demo timer duration in milliseconds. |
| `start_demo_timer` | Manage | Start or resume the current demo timer. |
| `pause_demo_timer` | Manage | Pause the current demo timer. |
| `adjust_demo_timer` | Manage | Adjust remaining demo time by a signed millisecond delta. |
| `pause_stage_timer` | Manage | Pause the stage timer. |
| `reset_stage_timer` | Manage | Reset and hide the stage timer, optionally setting a duration. |
| `adjust_stage_timer` | Manage | Adjust remaining stage time by a signed millisecond delta. |
| `hide_submission` | Manage | Hide a submission from the active lineup/pool. |
| `restore_submission` | Manage | Restore a hidden or inactive submission to the pool. |
| `reorder_lineup` | Manage | Order eligible submissions into the lineup. Omitted existing lineup entries are not removed. |
| `shuffle_lineup` | Manage | Randomly select and order presenters up to the lineup target. |
| `move_to_pool` | Manage | Move a submission out of the lineup into the pool. |
| `set_lineup_target` | Manage | Set the lineup target, clamped to the app's supported range. |
| `mark_no_show` | Manage | Mark the current presenter as a no-show in a published queue. |
| `advance_presenter` | Manage | Finish the current presenter, advance the published queue and reset its demo timer. |
| `restore_previous_presenter` | Manage | Undo the last advance and restore the previous presenter and timer snapshot. |
| `skip_current_presenter` | Manage | Move the current presenter to the back of a published lineup. |
| `clear_queue` | Manage | Requires matching clear_queue confirmation. Deletes submissions, team members and uploads, resets queue/timers and disconnects the Sheet. Retains the external Sheet. Do not call without explicit approval of this event's data loss. |
| `list_judge_links` | Manage | Explicit sensitive read of private judge links and their active states. Paths are relative to the app origin. Never include them in public event metadata. |
| `create_judge_link` | Manage | Create or rotate a roster judge's private link. Returns a sensitive path relative to the app origin; rotation replaces that judge's old token. |
| `close_submissions` | Manage | Close hackathon submissions before preparing judging assignments. |
| `start_assignment_preparation` | Manage | Begin assignment preparation. Then call prepare_assignment_batch repeatedly until done=true. |
| `prepare_assignment_batch` | Manage | Prepare one resumable assignment batch of up to 50 submissions. Repeat until done=true. |
| `preview_redistribution` | Read | Preview reassignment of unfinished reviews for an unavailable judge. Completed reviews are preserved. |
| `apply_redistribution` | Manage | Apply the exact current redistribution preview and deactivate the unavailable judge link. Rejects stale or incomplete assignments. |
| `get_judging_progress` | Read | Read assignments, raw scores, reviews and judging progress. Closed-round normalized scores are supplied separately by get_normalization_overview. |
| `set_judging_timer` | Manage | Set configured judging duration in milliseconds, with the app's clamping behavior. |
| `start_judging` | Manage | Start judging after assignment preparation is ready. |
| `add_judging_time` | Manage | Adjust judging time by a millisecond delta using the app's timer operation. |
| `close_judging` | Manage | Close an open judging round and lock judge review writes. |
| `reopen_judging` | Manage | Reopen a closed judging round with the retained remaining time. |
| `get_judging_timer` | Read | Read judging status, timer status, remaining milliseconds and server time. |
| `get_normalization_overview` | Read | Read normalized and raw score previews, low-data warnings, basis readiness/version and per-judge decisions. |
| `save_normalization_decision` | Manage | Choose normalized or raw scoring for one contributing judge after judging closes. |
| `ai_shuffle` | Manage | Curate the lineup with AI using only names, titles and categories. Performs a real provider request; read the lineup after completion. |
| `create_judging_sheet` | Manage | Create or reuse the event's real Google judging Sheet. Checks folder access, formats the file, resolves concurrent saves and schedules sync. |
