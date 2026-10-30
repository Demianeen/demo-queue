---
title: Organiser redesign
status: IMPLEMENTING
tier: Tier 2
created: 2026-10-29
updated: 2026-10-29
---

## Outcome

The organiser app looks and works like Linear: one sidebar, an inset main
panel with a breadcrumb header, a command menu, and keyboard shortcuts that
show on hover after a second. Every feature from the previous tip stays.
Participant pages and the stage keep their five styles, now described by
one theme contract. The judge page uses the B3 layout.

No behaviour changes. Convex is untouched.

## Decisions

| Date | Decision | Words |
| --- | --- | --- |
| 2026-10-29 | Linear-like organiser, keyboard first | "I really love how c looks and I would save it somewhere but I think as a organizer of the event is all about speed and clarity. So I would go with linear like design there, being keyboard first etc" |
| 2026-10-29 | One live event per org | "you can expect there be only 1 event live at a time per org for now, so we can structure the design around this. Usually people will be able to sign up for multiple tracks or no tracks and go only with the main event" |
| 2026-10-29 | Shortcuts on hover | "no need to always show the keyboard shortcuts, linear shows it on hover after a second" |
| 2026-10-29 | Flexible | "The whole idea of the app is to be flexible since fuckups happen all the timee" |
| 2026-10-29 | Submission link by QR | "You would only even share the submission link through qr code honestly" |
| 2026-10-29 | Judges use links, not QR | "I don't think judges will use qr, since they will go from their laptops, not phones. We will likely just have a table of links per judge so you can share them as a table in a shared whatsapp group or notion page" |
| 2026-10-29 | Number score picker | "instead of slider, we already had a nice score picker with numbers, since having decimal is just too big" |
| 2026-10-29 | No editing after submit | "no, at least not for now" |
| 2026-10-29 | Practice events separate | "they should be separate. Normal events shouldn't appear in practice events list and vice verca" |
| 2026-10-29 | Keep current onboarding | "No need for linear style onboarding like an org create since we wouldn't org creation for now. Everyone is invite only. Let's leave what we have" |
| 2026-10-29 | Small stack | "I wouldn't make a stack huge. Since I would maximum look at a couple of prs" |

## Proposed

Not agreed yet:

1. The current event is the newest event, until PR 3 adds event phases.
2. Judges sit inside the Judging view, not in their own sidebar item.
3. No Practice item in the sidebar until PR 3 builds practice events.
4. The Base style's panel border follows the theme foreground. This is the
   only pixel change on participant pages (see the style diff below).
5. Codex, Outpost, Astra and DevDay expose the contract tokens, but their
   CSS does not read them yet. They render exactly as before.
6. Getting started has its own page (`/events/getting-started`, G then G)
   and also stays above the events list until it is hidden.
7. The accent is indigo `#5b5bd6`, used for focus, selection and checked
   controls. Everything else is greys from one scale.

## Organiser shell

- Sidebar: org switcher, search (opens ⌘K) and New event (C) at the top.
- Current event group: the event and its views (Queue or Presentations,
  People or Submissions, Judging for hackathons, Settings). Skeleton while
  loading, "Create your first event" when there is none.
- Workspace group: Events (G E), Styles (G S), Members (G M), Connections
  (G C).
- Footer: Getting started (G G) and the account menu.
- Main panel: inset card, breadcrumb header, page actions on the right.
- ⌘K command menu: the page's own actions first, then Create, Current
  event, Go to, Switch organization, Help. Shows the page name above the
  input.
- `?` opens the shortcut sheet. ⌘B collapses the sidebar.
- Tooltips show the action and its keys after 1 second.
- Single keys never fire while typing in a field or with a menu or dialog
  open. Two-key sequences (G then S) have 1.2 seconds.
- Admin views live in the address: `?view=queue|submissions|judging|settings`.

## Fixes in this PR

- The judge clock stops at 0:00 and says "Time's up". The previous tip
  (290283b) counted below zero, for example -3187:02.
- The judge page always fills the AI summary slot, first: the summary,
  "Summary is being written" while one is queued, or "No summary". The
  judge query adds `aiSummaryStatus` for this.

## Known gap

The sidebar's current event is the newest event, so on another event's
admin page it can name a different event (for example DevDay Demo Hour
while Daytona HackSprint London is open). PR 3 replaces it with the live
event.

## Feature inventory

Taken from the previous tip (290283b) before each page was redrawn. Every
item is still there.

**Events** (`/events`): getting started guide with five live steps and
Hide guide; events list with name, type, date, submission count and the
current event marked; J and K to move, O to open; New event; sign-in
failed, switch failed, needs invitation, session unverified and choose
workspace messages; org switching.

**Create event** (`/events/new`): name, demo or hackathon, optional
tracks, Google Meet link, style picker with live presentation preview,
Manage styles link, first-event heading for an empty org.

**Event summary** (`/events/[slug]/overview`): event details, links to
the form, status and presentation pages, Manage event, missing event
message.

**Event admin, Queue view**: publish or make live, advance, skip,
no-show, restore previous presenter, shuffle, AI shuffle with notes,
add test people, clear all; presentation timer and stage timer with
start, pause, reset, plus and minus, minutes, show in presentation view,
show submission count; presentation preview with Submissions and Demo
mode; form link with QR; open presentation view; lineup table with drag
to reorder, target count, move to pool, hide and restore.

**Event admin, Submissions view**: all people or submissions table with
tracks, contact, hide and restore, drag into the lineup.

**Event admin, Judging view** (hackathons): judges dialog (add, remove,
links per judge), judging sheet button and messages, judging panel with
timer, progress per judge, assignment batches, redistribution preview and
apply, normalisation decisions, close and reopen judging.

**Event admin, Settings view**: event type with reset warning, meet link
with show in presentation view, Luma event, tracks panel (add, rename,
reorder, delete, counts, no track count).

**Styles** (`/styles`): style picker with every saved style, the
organization default marked, make a style the default, live presentation
preview.

**Members** (`/members`): members and invitations, invite, resend and
revoke invitations, remove members.

**Connections** (`/events/connections`): assistant setup per client with
copy buttons, live connection status, connected assistants, script keys.

**Judge page** (`/judge/[slug]/[token]`): search, track filter,
assigned and other submissions with scored state, project details,
GitHub and video links, video embed, README, AI summary, 0 to 10 buttons
per criterion, autosave, timer, Previous (K) and Next (J).

**Participant pages and stage**: submit form, status page and stage in
all five styles, QR on the stage, timers, meet link, sidebar stage for
DevDay.

## States

Screenshots are in `docs/reports/redesign/`, 2x, 1440 wide, plus 390 wide
for phone shots.

| State | Trigger | Screenshot |
| --- | --- | --- |
| Events list | signed in, org with events | `events.png` |
| Workspace loading | memberships request slow | `events-loading.png` |
| Workspace error | memberships request fails | `events-error.png` |
| No events | org with no events | `events-empty.png` |
| Command menu | ⌘K | `command-menu.png` |
| Command search | type "sty" | `command-menu-search.png` |
| No matching action | type "zzzz" | `command-menu-empty.png` |
| Shortcut sheet | `?` | `shortcut-sheet.png` |
| Tooltip with keys | hover 1 second | `tooltip-shortcut.png` |
| Sidebar collapsed | ⌘B | `sidebar-collapsed.png` |
| Org switcher open | click the org | `org-switcher.png` |
| Create event | C or New event | `create-event.png` |
| Styles, Members, Connections, Getting started | sidebar | `styles.png`, `members.png`, `connections.png`, `getting-started.png` |
| Event summary | G then O | `event-summary.png` |
| Event not found | unknown slug | `event-summary-missing.png` |
| Admin loading | Convex not connected yet | `admin-loading.png` |
| Admin queue, demo and hackathon | Queue | `admin-queue.png`, `admin-queue-hackathon.png` |
| Admin submissions | `?view=submissions` | `admin-submissions.png` |
| Admin judging | `?view=judging` | `admin-judging.png` |
| Judges dialog | Manage judges | `admin-judges-modal.png` |
| Admin settings | `?view=settings` | `admin-settings.png` |
| Admin actions in ⌘K | ⌘K on admin | `admin-command-menu.png` |
| Add test people dialog | Add test people | `admin-test-people.png` |
| Judge page | judge link | `judge.png` |
| Judge, time is up | the judging clock passes 0:00 | `judge-times-up.png` |
| AI summary being written | summary queued, not saved yet | `judge-summary-writing.png` |
| No AI summary | no model key, or not in judging | `judge-summary-none.png` |
| Judge tooltip | hover Next project | `judge-tooltip.png` |
| Judge loading | Convex not connected yet | `judge-loading.png` |
| Phone events, sidebar, admin | 390 wide | `phone-events.png`, `phone-sidebar.png`, `phone-admin.png` |

## Styles, before and after

`docs/reports/redesign/styles/` has the after shots for all five styles
(submit, submit on phone, status, status on phone, stage). Before shots
are kept only where a pixel differs. Pixel differences at 2% fuzz:

| Style | Difference | Cause |
| --- | --- | --- |
| Base | 0.25% to 0.74% on submit and status | panel border colour (Proposed 4) |
| Codex | 0% | |
| Outpost | 0% except stage 0.58% | QR code encodes the local port |
| Astra | 0% except stage 7.8% | animated background and QR code |
| DevDay | up to 0.65% | timer digits and QR code |

## Checks

- `tsc --noEmit`, `pnpm lint`: clean.
- `pnpm test`: 187 pass, including `test/redesign.test.mjs`.
- `pnpm test:convex`: 218 pass.
- Live checks against a local build with local Convex and a WorkOS mock,
  in `docs/reports/redesign/`: ⌘K, search and Enter, `?`, tooltip delay,
  G then S, C, keys ignored in fields, ⌘B, every admin view, judge page.
