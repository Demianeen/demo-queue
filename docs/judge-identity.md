# Judge identity

## What was wrong

A judge had no id. Their key was their name, normalized ("Test judge C" became
`test judge c`), and the app worked it out again from the name wherever it
needed one. The roster (`events.roundOneJudges`) and every assignment
(`submissions.roundOneAssignedJudges`) held names, and reviews, links and
evening-out choices held the key made from the name.

So a judge's name was their identity. Renaming one meant saving a new list of
names: the new name made a new key, which looked like a new judge, and the old
key looked like a judge being removed. Once scoring had started this was
refused: "Reviews have started. Redistribute these judges before removing them:
Test judge C." Renaming "Test judge C" to "Test judge" was impossible.

## The rule now

A judge is their key. The key is made once, when the judge is added
(`j_` and 12 random hex characters), and is never worked out from a name again.

- The name is a label, kept in one place: the judge's link row,
  `judgeAccess.judgeName`. Every judge gets a link row when they are added.
- The roster, assignments, reviews, links and evening-out choices hold the key.
  Every comparison is between keys.
- Renaming (`renameJudge`, the `rename_judge` tool, Rename in the Judges dialog)
  changes only the label. The key, link, projects, scores and evening-out choice
  stay.
- `convex/judgeDirectory.ts` turns stored references into judges and names.
  `byName` is only for input that has nothing but a name: a typed or pasted
  name, or `save_judges` and `create_judge_link` from an assistant.

### Events set up before this

Nothing is migrated. On an older event the roster and assignments still hold
names, and each judge's key is their name normalized, as before.
`judgeKeyOf` reads both shapes: it normalizes a stored reference, and a new
`j_` key normalizes to itself. Writes keep an event in one shape
(`rosterReference`): an old event keeps names in its roster and assignments, a
new one keeps keys. On an old event, "Test judge C" stays in the roster after
the rename, as the key `test judge c`; the label "Test judge" is shown
everywhere. The test "an event set up before judges had ids keeps working" in
`convex/judgeIdentity.test.ts` covers scoring, progress, Help out,
redistribution, move scores and rename on that shape.

## Places that were tied to names, and how each is handled

| Place | Before | Now |
| --- | --- | --- |
| `normalizationDecisions` (evening out) | Kept by `judgeKey` | Same: the key never changes, so a rename keeps the choice. Tested. |
| Judging sheet, Judge 1 and Judge 2 cells | Compared the cell text with the current name; a rename showed as "assignment drift" | Each cell keeps `Judge id: <key>` in its note. Cells are matched by that key and rewritten with the current name. A cell with no note (an older sheet, or typed by hand) is matched by its text. |
| Judging sheet filter views "Judge: <name>" | Found by title, so a renamed judge kept an old view and got a second one | Each sync deletes "Judge: " views that no longer match a judge on the sheet and adds views for the current names. A rename queues a sync. Google filter views have no field for our id, so the title is the only handle. |
| Undo (`convex/changes.ts`) | Snapshots of the roster held names | Snapshots hold whatever the roster stored: names on an old event (which are its keys), keys on a new one. Undo restores those, so it never writes a label into the roster, and names always come from the link row. Undo of a remove after a rename is tested on both shapes. |
| Help out (`lib/judging-help.ts`) | Built keys from roster names | Takes keys from the directory. |

## Rules

Proposed:

1. Labels are display only. Never find, compare or store something by a label
   someone can edit.
2. No arrays of names. Lists of people or things hold ids.
3. Normalized keys are for spotting duplicates ("Sam" and "sam " are the same
   name), never for finding rows or blocking edits.
4. Round-trip ids through anything outside the app: sheets (as the cell note
   does), AI prompts and their answers, and MCP tools (tools take and return
   `judgeKey`, with the name beside it).
5. A copy of a label kept somewhere else is marked as a copy and moves with any
   schema change (the sheet cell text, the change log summary, the filter view
   title).

## Other places that still use a label as identity

- `create_judge_link` and `save_judges` take names. They are kept for
  assistants and match by the current name (`byName`); new callers should use
  `add_judges`, `rename_judge` and `remove_judge`, which take keys.
- `&judge=` on the Judging page holds the judge's key. On an old event that key
  is a normalized name, so a link copied before a rename still works, because
  the key did not change.
- AI summaries (`convex/aiSummaries.ts`) match the model's answer to tracks and
  sponsors by normalized name. Renaming a track or sponsor while a summary is
  being written would drop that match. Sending ids to the model and back would
  follow rule 4.
- Tracks and sponsors are deduplicated by normalized name (`trackKey`), which
  is fine for spotting duplicates (rule 3) as long as nothing finds rows that
  way.
- Change log summaries name the judge as they were called then. That is a copy
  (rule 5) and is expected to go stale.
