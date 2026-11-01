# Organiser workspace

An organiser signs in with Google, works inside one WorkOS organisation at a time, sees that organisation's events newest first, jumps anywhere with the command menu, and rehearses on practice events that never reach real people.

## Sub-features

- `workspace-sign-in` signs in with Google through WorkOS and returns to the page asked for.
- `workspace-list` lists the active organisation's events, newest first, with the live one marked `Current event`.
- `workspace-org` switches the active organisation from the `Organization` button.
- `command-menu` opens on suggestions (live event places, recent events, create, pages) and searches events, pages and actions.
- `practice-events` lists practice events and creates one with test submissions and test judges.

## How to get to it (user POV)

- Open `/events` (`/` redirects there).
- A workspace link while signed out, which goes through `Continue with Google` and comes back.
- The sidebar: `Events`, `Practice`, `Styles`, `Members`, `Connections`, `AI usage`, `Getting started`.
- `Search and commands` button, or Cmd+K anywhere in the workspace.
- `G` then a letter for pages (`G P` Practice), listed under `All shortcuts` in the command menu.

## Driving it with the browser and shot.mjs

Preconditions:

- Doctor passes on the port. The browser is on `http://localhost:<port>/events`.

- **Signed in.** Read the page. The sidebar has `Account: demyan310505@gmail.com` and the main area a list headed `Events` ("Your events in <org>, newest first."). Signed out instead, the page shows `Continue with Google`: click it, choose demyan310505@gmail.com, and expect to land back on `/events`.
- **List.** The first rows link to `/events/<slug>/overview`; the live event also appears in the sidebar under `Live now` with its phase.
- **Command menu.** Click `Search and commands`. A dialog opens with combobox `Search events, pages and actions…` and the sections `Live now · <event>` and `Recent events`. Click into the combobox and type `practice`: sections `Events` (practice events, labelled `Practice · <phase>`), `Create` (`New practice event`) and `Go to` (`Practice`). Choose an event: the URL becomes `/events/<slug>/admin`.
- **Practice.** Open `/events/practice`. The page is headed `Practice` ("Real events with test people. Never in Events, never the live event.") with a `New practice event` control. Opening a practice event shows the banner `Practice  Same code as a real event. Only test people, and they send no emails.`
- **Organisation.** Click `Organization`; the menu lists the organisations the account belongs to (dev: Test and Outpost). Switching changes which events the list shows. Switch back before you finish.
- **Proof.** Save the page text or accessibility snapshot of the list and of the command menu results to the evidence folder, with the screenshot you looked at described in `notes.md`.

## Gotchas

- Typing right after opening the command menu can land before the combobox has focus, or append to an earlier query; click into the combobox (or triple-click to replace) and wait for the result sections before reading.
- Single letters outside a text field are shortcuts (`G` then a letter navigates). Do not type into the page body.
- Creating a practice event writes to dev; keep `Write AI summaries with the real model` off, as it spends OpenAI credit.
- Never use the account menu's sign-out.
- Events made by other checks fill the dev list. Find yours by slug, not by position.
