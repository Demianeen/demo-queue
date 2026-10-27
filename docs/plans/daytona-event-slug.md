# Rename Daytona without breaking existing links

Status: prepared, not applied.

The proposed canonical slug is `daytona-hacksprint-london-august-2026-1db202`.
The current slug is `test-hack-5-1db202`.
The event ID is `j974h0f71ht5dghe27pkrnwpx98df3ny`.

This rename is separate from the approved organization-ownership manifest.
The ownership approval does not authorize this production slug change.
No production rename has run.

## Preserve existing links

`eventSlugAliases` maps each previous slug to the unchanged event ID.
The shared `findEventBySlug` resolver checks the canonical slug, then the alias.
Participant, judge, submission, presentation, and signed-in administration queries use that resolver.
Aliases carry no access rights. Administration still requires the event's WorkOS organization.

An alias table keeps lookup indexed without a growing array on each event.
A redirect-only solution would leave direct backend calls using previous slugs broken.
New events cannot reuse reserved aliases.

`eventSlugs:rename` is an internal mutation. Its default is a dry run.
It checks the exact event ID, current slug, organization ownership, and destination availability.
Application atomically records the previous slug and changes only `events.slug`.
Existing submission and judge records do not change.
Repeating the same applied rename returns `kind: "noop"`.

## Run only after merge, deployment, ownership assignment, and separate rename approval

Before either command, verify that `.env.local` exists and report the explicit selector `--prod`, which must resolve to `giant-egret-456`.
Stop if the CLI reports a different deployment.

Preview the rename without changing records.

```bash
pnpm exec convex run --prod eventSlugs:rename '{"eventId":"j974h0f71ht5dghe27pkrnwpx98df3ny","expectedSlug":"test-hack-5-1db202","expectedOrganizationId":"org_01M5WZN8BW5GYKKED6Q7XQHDDK","newSlug":"daytona-hacksprint-london-august-2026-1db202","dryRun":true}'
```

After reviewing that result and obtaining production rename approval, apply the same operation.

```bash
pnpm exec convex run --prod eventSlugs:rename '{"eventId":"j974h0f71ht5dghe27pkrnwpx98df3ny","expectedSlug":"test-hack-5-1db202","expectedOrganizationId":"org_01M5WZN8BW5GYKKED6Q7XQHDDK","newSlug":"daytona-hacksprint-london-august-2026-1db202","dryRun":false}'
```

Open the existing and canonical participant, judge, submission, and presentation URLs.
Verify that both slugs refer to the same event and existing role-specific tokens still work.
Verify that anonymous and other-organization administration requests remain denied.

## Rerun local verification

```bash
pnpm exec vitest run convex/eventSlugs.test.ts
```
