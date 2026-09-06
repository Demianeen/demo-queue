---
title: WorkOS development setup
status: COMPLETE
tier: 1
created: 2026-09-05
updated: 2026-09-05
---

Prepare initial development provisioning in this worktree. Demian completes
the interactive WorkOS setup himself. This bounded preparation does not yet
change application authentication or event ownership.

## Decisions carried forward

- Convex-managed WorkOS, Google-only login, invitation-based membership.
- Start with Outpost and Test WorkOS organizations; Demian belongs to both.
- An organization picker on `/events` scopes listing and creation together.
- Only signed-in users will create events, using the verified active organization.
- Existing event-admin and participant, judge, submission, and presentation
  links remain account-free.

## Initial setup

1. Verify existing `.env.local` selects `dev:precious-elk-564` and install the
   locked dependencies. Do not authenticate or reconfigure Convex.
2. Add development-only AuthKit provisioning configuration, using localhost
   port 3000. Validate against the installed Convex schema and CLI source.
3. Launch the development setup in a visible terminal for Demian to complete
   the managed WorkOS prompt. The CLI may create a development AuthKit
   environment and write its credentials to `.env.local`.
4. Configure Google-only login, invitation-based access, Outpost, and Test in
   WorkOS. Demian authorized this configuration through the WorkOS plugin on
   September 5. Then resume application integration and its separate
   authorization review and end-to-end validation.

Stop if deployment identity differs, CLI authorization is unavailable, or a
project-selection/authentication flow is required. Do not proceed through
Demian's interactive provisioning decisions. Before each Convex command,
report environment-file presence and exact deployment selector.

## Validation and remaining work

- Completed: frozen dependency install; provisioning JSON passes the installed
  Convex 1.40.0 schema; canonical development authorization returned HTTP 200
  and the expected project.
- Demian completed managed WorkOS provisioning on September 5. His CLI output
  reports the AuthKit environment ready and Convex functions ready.
- Verified: WORKOS_CLIENT_ID, WORKOS_API_KEY,
  NEXT_PUBLIC_WORKOS_REDIRECT_URI, and WORKOS_COOKIE_PASSWORD exist and match
  the primary checkout exactly. This worktree's `.env.local` is a symlink to
  `/Users/demian/projects/demo-nights/demo-queue/.env.local`, so no copy is
  needed. Both identify canonical development `precious-elk-564`.
- Port 3000 had no listener during preparation; check again before starting
  the future callback server.
- The interactive terminal handoff is complete. Demian performed provisioning.
- Development configuration was completed through the WorkOS plugin and
  verified by subsequent queries: Google is the only enabled sign-in method,
  public signup is disabled, and Outpost and Test each contain Demian's user.
  No password was set and no invitation email was sent; the user and both
  memberships were added directly with the authorized administrator access.
- Outpost and Test have no domain-based enrollment, SSO connections, or
  directories. Profiles outside the organization are disallowed. The seeded
  Test Organization was preserved; it is separate from the new Test org.
- The plugin environment's client ID was verified against the local
  WORKOS_CLIENT_ID before changes. The configured environment is
  `demo-queue precious-elk-564 (dev)`.
- Login, token validation, organization switching, event ownership, and
  retirement of anonymous creation remain subsequent implementation work.
  This plan's COMPLETE status covers development provisioning and WorkOS
  configuration only; an actual Google login has not yet been tested.
- No production configuration, deployment, event classification, or migration
  is part of this step. No judging, scoring, timer, or finalist changes.

## MUST DO BEFORE MERGING THE AUTH INTEGRATION

- P01: Configure separate production WorkOS credentials for the production
  Convex deployment `giant-egret-456` and the frontend's production hosting
  environment. Use production callback/home/CORS URLs and a separate cookie
  password; do not copy development credentials into production. Verify the
  production configuration before merging the auth integration. Demian
  requested this requirement on September 5; execution remains pending the
  production setup step.
