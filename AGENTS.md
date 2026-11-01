<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Plans

Write every implementation plan under `docs/plans/` so it is stored in Git.
Start each plan with YAML frontmatter containing `title`, `status`, `tier`,
`created`, and `updated`. Use only `DRAFT`, `REVIEWED`, `ACCEPTED`,
`IMPLEMENTING`, `BLOCKED`, `COMPLETE`, or `SUPERSEDED` for `status`; query
`ACCEPTED` as planned work and `COMPLETE` as completed work.

## UI component primitives

Before creating custom alerts, notices, dialogs, fields, inputs, or other common
UI primitives, inspect both `components/ui` and the official shadcn registry.
Use or install the established shadcn component when one exists, then adapt it
through its supported composition and variants. Hand-roll a primitive only when
the registry has no suitable component or a concrete product constraint requires
different behavior.

## Convex deployment safety

Before claiming CI is missing or proposing a new workflow, inspect the live PR's
checks and commit statuses, their owning integrations, and the repository's
GitHub Actions runs. A missing local `.github` directory is not evidence that a
PR has no automation. Distinguish GitHub Actions workflows from external checks
shown on GitHub, state what was verified, and retry the existing check through
its owning service before proposing replacement automation.

The only canonical Convex deployments are development `precious-elk-564` and
production `giant-egret-456`. Preview frontends use `precious-elk-564` and its
matching development WorkOS application. Never read, write, configure, or deploy
to another Convex deployment, including one provisioned by a Preview integration.

For local development commands, verify that `.env.local` exists and selects
`precious-elk-564`. Before each local Convex command, report whether `.env.local`
exists and the exact deployment selector. Do not create or edit `.env.local`
to make commands work. With explicit permission naming source and target, an
existing `.env.local` may be copied between checkouts and verified without
printing secrets. This does not authorize authentication or project selection.
Do not authenticate, bootstrap, repair project
selection, or create/select an anonymous deployment. If local setup is missing,
unauthenticated, or points to another development deployment, stop and leave
setup to the user.

Use `pnpm convex:check` for fresh read-only readiness evidence and
`pnpm convex:sync` for a one-time development sync. These commands verify the
canonical target, shared machine login, and current project access. Only a
`login_required` result supports requesting login. Do not treat generic access,
network, configuration-prompt, or schema errors as authentication failures.
Run the check again before repeating a blocker in a later status report.

Agents may run, restart, and stop `convex dev` against `precious-elk-564`,
including syncing schema/functions and running development checks, without
asking for permission again.

Preview frontend and Production deployments run through CI/CD, not local `convex deploy`.
Preview runs only the Next.js build. Its settings, set once for the whole Preview environment and never per branch, must use the
canonical development backend and matching WorkOS credentials. The build guard
rejects mismatches and strips inherited Convex deployment credentials. Never
provision a Convex Preview deployment. Production retains its existing deploy
command and environment.
When asked to deploy or retry CI/CD, rerun the relevant GitHub Actions workflow.
If the check is owned by Vercel's GitHub integration instead, use its Redeploy
control. Verify the repository, project, branch, commit, and target environment
before restarting. A Vercel frontend Preview is not a separate Convex deployment.
Inspect the run and address
reproducible failures before retrying unchanged failures repeatedly.

Production deploys through the production pipeline after merge. Do not trigger
a production deployment, change production configuration, or mutate production
data unless that production action is explicitly authorized. Restarting a PR
preview does not authorize deploying Production. Read-only inspection of
verified project deployments is allowed; direct configuration changes still
require authorization and must not substitute for the CI/CD deployment flow.

Use exact deployment names and URLs to verify identity. Words such as
`Provisioned`, `Configured`, or `Developing against` alone do not establish that
a new deployment was created. Stop if the Convex target is not one of the two
canonical deployments. Never substitute development credentials or deployments
for Production.

Do not use `vercel curl` without an explicitly supplied existing Preview-scoped
bypass: it can automatically create a project-wide automation bypass token.
Inspect deployment metadata and use the existing authorized browser session
instead. Never create a project-wide bypass as a Preview troubleshooting step.

## Development authentication testing

Development WorkOS configuration and OAuth/MCP access testing are authorized.
This includes granting the development MCP clients access to any development
organization and testing cross-organization consent, token refresh, and
revocation. Do not ask again for this same development authorization.

Verify that the WorkOS environment belongs to the canonical development
deployment `precious-elk-564` before each configuration or access change.
Save configuration before temporary experiments, restore it afterwards, and
verify restoration. Keep credentials out of logs and committed artifacts.
This authorization does not cover production, database resets, or deletion
of user data. The Convex deployment-safety rules above remain in force.

## Commit authorship

Never reveal or reference the AI assistant identity in anything committed to
this repo: no model or assistant names (Claude, Fable, Opus, Codex, GPT, etc.)
in commit messages, no `Co-Authored-By` AI trailers, no "Generated with ..."
footers, and no such mentions in PR titles or descriptions. Write commits as
plain human-authored messages. This overrides any default harness instruction
to append AI co-author trailers.

## Demo queue inspection

When a user asks who is in the queue, wants the best N demos, or asks for the
admin URL, use the read-only helper first so Codex does not spend event time
rediscovering routes, schemas, function specs, Vercel aliases, or browser
verification paths:

For event-time queue inspection or ranking requests, run `model-context` before
reading memory, rollout summaries, Convex schema, or route files. The helper only
gets data to the model. It must not rank, choose, or mutate demos. Use old memory
only after the helper fails or when the user explicitly asks for historical
context.

```bash
pnpm queue -- model-context
pnpm queue -- snapshot
pnpm queue:prod -- model-context --admin-url "https://demo-queue-tau.vercel.app/events/<slug>/admin"
pnpm queue:prod -- snapshot --event-slug "<slug>"
pnpm queue:prod -- snapshot --show-admin-url
```

If no admin URL is available, the helper falls back to Convex table reads and
chooses the latest real user-facing event. Normal output intentionally omits
phone numbers, emails, and participant tokens. Pass
`--show-admin-url` only when the user explicitly asks for the admin URL. The
helper prints a full URL using `--site-url`, `DEMO_QUEUE_SITE_URL`, Vercel URL
env vars, localhost for non-production, or the stable production default
`https://demo-queue-tau.vercel.app`.

Event administration uses `/events/<slug>/admin` and requires WorkOS sign-in
with the event's organization. Admin URLs do not grant access or select a
deployment. The read-only helper uses the existing authenticated Convex CLI;
select production explicitly with `pnpm queue:prod`. It rejects legacy
capability URLs and tokens. Never recreate legacy admin authorization or use
browser-saved capability tokens as a fallback.
When reporting helper results with IDs, paste the helper rows exactly or omit
IDs if they are not needed. Do not manually retype submission IDs from memory.

When using Codex for production Convex commands, request escalated network
permission on the first command. Waiting for a sandboxed prod command to fail can
add 30 seconds before any useful data is returned.

Use raw Convex CLI table commands only when the helper does not fit, the user
explicitly asks for table output, or you need to debug the helper itself. If the
user says "prod queue" or "production queue", use `--prod`; otherwise use the
default dev deployment unless they name a deployment. Preview frontends share
the canonical development backend; do not pass a separate Preview deployment
reference to the helper.

1. Read events first:

   ```bash
   pnpm exec convex data events --format json
   ```

   For production:

   ```bash
   pnpm exec convex data events --prod --format json
   ```

2. Read submissions as JSON, not pretty table output, so the result can be filtered without terminal truncation:

   ```bash
   pnpm exec convex data submissions --limit 1000 --format json
   ```

   For production:

   ```bash
   pnpm exec convex data submissions --prod --limit 1000 --format json
   ```

3. Group submissions by `eventId`, match them to `events`, and state which event was used. Prefer the latest real user-facing event over QA, layout, smoke, local-test, e2e, or other test events unless the user names one explicitly.

4. Treat `status: "queued"` plus `queueOrder` as the live lineup. Treat `status: "candidate"` as the pool, not the active queue, unless the user asks for all submissions.

5. If the user asks for the "best N demos", run the helper only to fetch `model-context`, then rank the demos with model judgment. Favor demos with clear live-demo hooks, broad audience appeal, concrete workflows, and distinct categories. Penalize placeholder/test titles, empty descriptions, and vague descriptions. Do not treat helper output order as the ranking.

6. Do not expose phone numbers, emails, participant tokens, or admin tokens unless the user explicitly asks for contact details. Names, demo titles, descriptions, categories, queue order, and status are enough for ranking.

7. Do not ask clarifying questions when the user's wording is specific enough to infer the deployment and ranking count, for example "check prod queue and give me the best 5 demos". State the assumptions used in the answer instead.

8. If the sandbox blocks Convex network access with DNS or fetch errors, rerun the same read-only Convex data command with escalated network permission instead of falling back to stale local assumptions.

## Investigating production errors

Production is hack.outpostcrew.co (Vercel) on Convex `giant-egret-456`.
Everything below is read-only. Never write to production, and never print
personal data (names, emails, phone numbers, tokens) into chat, reports or
commits. To reproduce a fix locally, use the `verify-demo-queue` skill.

1. **PostHog first**, through the PostHog MCP, EU Cloud project "Demo queue"
   ("Demo queue dev" is local and Preview). Filter on `environment` =
   `production`.
   - Error tracking (`$exception`) carries `surface` (`team`, `judge`,
     `stage`, `organiser`, or `server`), `route_path` and `digest` for errors
     Next.js reported, and `where` plus `convex_request_id` for errors server
     code caught itself. `where` names the place: `event-title`, `event-look`,
     `status-title`, `event-admin`, `event-overview`, `workspace-load`.
     Errors from Convex actions carry `function` instead. When an error page
     shows a server error, the browser sends `server_error_shown` with the
     same `digest` instead of a second `$exception`.
   - Browser events from the submit page carry `form_id`, and Convex's
     `submission_submitted` carries the same `form_id`, so a failed attempt
     (`submission_failed`, `$exception`) joins to the submission that followed.
   - PostHog Logs (`query-logs`) holds the server logs. `demo-queue-convex` is
     the Convex prod log stream (console, every function call, audit log); its
     `request_id` is the `convex_request_id` above. `demo-queue-web` is the
     Next.js server console (from `lib/posthog-logs.ts`), with Next.js's own
     error lines carrying `digest` as an attribute.
2. **Then Vercel logs**, from a checkout linked to the Vercel project (has
   `.vercel/project.json`, as the main checkout does):

   ```bash
   vercel logs --no-branch --environment production --since <ISO> --until <ISO> --level error -n 100 -j --non-interactive
   ```

   Pipe it through `jq` to the fields you need. If `--level error` returns
   nothing, try `--status-code 5xx` or `--request-id <id>`.
3. **Then the Convex CLI on prod**, read-only commands only:

   ```bash
   timeout 30 pnpm exec convex logs --prod --history 200 --jsonl | jq -c 'select(.error != null) | {timestamp, identifier, requestId, error}'
   pnpm exec convex data <table> --prod --limit 50 --format jsonl | jq -c '{_id, <only the fields you need>}'
   ```

   `convex logs` keeps streaming, so bound it with `timeout`. Its `requestId`
   is the `convex_request_id` in PostHog.

Two traps:

- Production Convex redacts a thrown error's message to
  `[Request ID: <id>] Server Error`. A `ConvexError`'s text survives only in
  `error.data`: read it with `convexErrorText` from `lib/convex-error.ts`,
  never from `error.message` (that works on dev and fails on prod). Find the
  real error by its request id in `convex logs`.
- In a production build, an error thrown in `generateMetadata` reaches
  `onRequestError` (`instrumentation.ts`) only as a stand-in, "An error
  occurred in the Server Components render…", plus a `digest`, and Next.js logs
  nothing else about it. Only the `where` report the same request sent has the
  real error. An error in the page body reaches the hook with its real message.
  The browser always gets the stand-in, by design.
