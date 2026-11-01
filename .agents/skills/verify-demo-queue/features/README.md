# demo-queue verification map

This folder is the maintained list of what demo-queue's users do and how to prove each one works. Read this index, then use the matching feature file as the recipe. Launch, doctor, evidence and cleanup are in [../SKILL.md](../SKILL.md).

## Baseline preconditions

- A verification server started by `dq-verify.sh up <port>`, and `dq-verify.sh doctor <port>` exits 0.
- The browser is signed in to the workspace as demyan310505@gmail.com for organiser features (sidebar shows `Account: demyan310505@gmail.com`).
- A dev event in the right state. Prefer a practice event (slug starts with `practice-`, made on `/events/practice`). Find one with `pnpm exec convex data events --limit 100 --format jsonl | jq -c '{_id, slug, eventType, phase, practice}'`.
- If this branch changed `convex/`, its functions were pushed to dev with `npm run -s convex:sync` and the report says so.

## Driving conventions

- Organiser pages: the agent's own browser (Claude Code Browser pane, Codex in-app browser), elements found by accessible name.
- Public pages: `scripts/shot.mjs` for crisp captures; the browser for clicking and typing.
- Wait for `.skeleton` and `aria-busy="true"` to disappear before reading a page.
- Tokens (status and judge links) stay in shell variables. Never put them in reports, file names or commit messages.
- Never press anything that writes on a non-practice event unless this run created it.

## Proof and skip reporting

- Record the feature ID, the entry point used, the event slug and the port with every artifact.
- UI proof: an ARIA snapshot or page text, plus a screenshot, at the phone size too for participant and judge pages.
- Mutation proof: a Convex read of the changed row before and after. "Must not write" proof: the same read, unchanged.
- An entry point you could not reach is reported as not verified, with what you tried and what was missing. Do not report it as verified through another entry point.

## Feature entry contract

Each feature file starts with an H1 and one paragraph describing the user-visible behaviour, then exactly four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with the browser and shot.mjs`, `Gotchas`.

## Features

- [Organiser workspace](./organiser-workspace.md): sign-in, organisation, events list, command menu, practice events.
- [Event admin](./event-admin.md): the per-event control room: submissions, judging, stage, results, settings, phase.
- [Submit form and status link](./submit-form.md): participants submit a demo or hackathon project and follow its status.
- [Judge link](./judge-link.md): a judge confirms who they are and scores assigned projects on their phone.
- [Presentation view](./presentation-view.md): what the room sees on the big screen.
