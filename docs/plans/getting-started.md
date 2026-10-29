---
title: Getting started guide
status: IMPLEMENTING
tier: Tier 2
created: 2026-10-29
updated: 2026-10-29
---

## Outcome

A checklist card above the events list that gets a new organization ready
for its first event. It has five steps, each ticked off from real data, a
progress bar and "N of 5 done". The connections page leads with the same
assistant setup, then the list of connected assistants, then script keys.

## Steps and what ticks them off

1. Create your first event: the organization has an event.
2. Invite your team: WorkOS shows an invitation for the organization, or
   more than one active member.
3. Connect your AI assistant: this person has a live, unrevoked connection
   (OAuth, device or script key) that covers this organization.
4. Add your look: the organization has a style.
5. Do a dry run: any event in the organization has had test people added,
   or the person marked it done by hand.

## Implementation

1. `convex/gettingStarted.ts` holds `status` (one query for steps 3 and 5,
   the hidden flag and the MCP address), `teamStatus` (an action, because the
   counts come from WorkOS), `setHidden`, `markDryRun` and `mcpAddress`.
2. "Hide guide" and "Mark done" are saved per person per organization in the
   `gettingStartedGuides` table, so they follow the person between browsers.
3. The MCP address comes from `componentSiteUrl()`, the same function the MCP
   server uses. A deployment without a public address shows a plain note
   instead of setup steps.
4. Assistant tabs: Claude Code, Codex, Claude app and Cursor. Each tab has
   numbered steps with copy buttons, and ends with the read-only prompt "List
   my Demo Queue organizations and events. Do not change anything."
5. "Waiting for your first connection" is a live query, so it turns into
   "Connected" as soon as a connection appears, with no reload.
6. The guide sits inside an error boundary: if it fails, the events list
   still works, and the guide offers Retry and "Sign in again".
7. The guide, setup and assistant-only tools stay out of MCP (they are the
   person's own onboarding), and the coverage script records that.

## States

Loading skeletons shaped like the content, the team step's own loading and
error with Retry, hidden, waiting and connected, all done, a guide error with
Retry, and on the connections page a loading skeleton, empty list, load error
with Retry, and a per-row "Disconnecting..." that blocks a second click.

## Proposed

- Five steps, in this order, with step 4 marked optional.
- A script key counts as a connection for step 3.
- Test people added to any event count as the dry run.
- Hiding is per person per organization, not per organization.
- The button reset in `app/globals.css` moves into Tailwind's base layer, so
  outline buttons across the app show their border.
