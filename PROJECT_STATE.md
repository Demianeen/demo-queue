# Project state

One dated entry per landed change, newest first. Each entry says what changed
for users, the PR, and how it was checked.

## How this repo is worked on

- One pull request per user feature, opened as a draft. The owner reviews and
  merges. Merging to main deploys production and its Convex schema.
- Checks before a PR is marked ready: `pnpm lint`, `pnpm exec tsc --noEmit`,
  `pnpm test`, `pnpm test:convex`, and a screenshot of the change on the PR's
  Vercel Preview, which uses the development Convex deployment.

## Entries

(none yet)

### 2026-11-02

Mistyped or out-of-date links now show a branded Demo Queue page with a
"Go to events" link. Offline checks run before handoff; PR Preview screenshot
verification is assigned to the coordinator.
