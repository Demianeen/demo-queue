---
title: Members and invitations
status: IMPLEMENTING
tier: Tier 2
created: 2026-10-29
updated: 2026-10-29
---

## Outcome

A Members page at `/members` where anyone in the organization can invite
people by email, resend or revoke pending invitations, and remove members.
Removing someone also removes their assistant connections' access to that
organization on the next call. The same member and invitation reads and
writes are available as MCP tools.

## Implementation

1. WorkOS stays the source of truth for members and invitations. The page
   reads them on the server and changes them through Next server actions.
2. Every action takes the organization from the session, never from the
   browser, and checks the caller's active WorkOS membership first.
3. Invitation sends share one Convex rate limit per organization (20 per
   hour, burst 20) between the page and MCP.
4. The page shows every state: a skeleton while loading, a load error with
   Retry, empty lists with a next step, inline errors next to the control
   that failed, partial sends that keep the failed addresses, the rate limit,
   and an expired session with a sign-in link.
5. Rows an action returns or removes update at once. The page then reloads
   from WorkOS to reconcile.
6. MCP gains `list_members`, `list_invitations`, `send_invitations` and
   `revoke_invitation`, all with the manage scope because they show emails.
   There is no MCP tool for removing a member.

## Proposed

- Everyone in the organization can invite and remove; there are no roles.
- WorkOS sends the invitation emails.
- The rate limit numbers above.
- Member and invitation tools need manage access, reads included.
- "Send again" on an expired invitation sends a new one.

## Verification

- Node and Convex tests cover the email rules, the rate limit, the MCP tools,
  and that a removed member's connections lose the organization.
- A local harness (mock WorkOS, local Convex, production Next build) drives
  each page state in a browser, with screenshots in
  `docs/reports/members-invites/`.
- The invitation accept path was checked by reading the code only.
