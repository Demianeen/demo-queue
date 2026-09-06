---
title: Workspace routes and loading optimization
status: COMPLETE
tier: Tier 3
created: 2026-09-06
updated: 2026-09-06
---

## Accepted outcome

September 6: user authorized the discussed loading optimization and separate Styles route. Work stays in c23c's existing detached checkout; no commits, pushes, production or WorkOS configuration changes. One implementation slice, approximately 30–45 minutes including local browser verification. No blocking product questions.

## Decisions

D01: /events and /styles become real routes in a shared route-group layout. Navigation uses Next links. Shared client workspace retains mounted event/style forms to preserve drafts during navigation; URL selects the visible surface. Browser refresh loads that URL, and Back follows links. Organization switching retains the current route but performs full navigation to discard SDK token state and drafts across organizations. Creation may use /events/new so its history also works.

D02: Authenticate with withAuth outside caching. Cache only active membership list results in Next unstable_cache, keyed by WorkOS client/environment and verified user ID. Store fetchedAt and revalidate after 60 seconds. A foreground freshness check refuses results older than 60 seconds, fetching directly if necessary; failures produce a retry screen, never an expired list. React cache deduplicates the foreground loader within one render request. Live organization switching continues its uncached membership check. No access or refresh tokens in membership cache, cache keys or logs. Backend JWT authorization unchanged.

D03: Server loads memberships and authenticated initial events/styles concurrently after withAuth. Initial queries are existing Convex APIs, with the authenticated token and explicit URL. Check returned organization IDs against session and active membership before exposing any result. Use request-only Convex results, never persistent shared caches for private events/admin links. Empty membership list shows invitation message, missing active org shows authorized org choices, upstream failure shows focused retry. No new schema or data changes.

D04: AuthKitProvider receives initialAuth with accessToken omitted. Create Convex client during initial render, using stable state, removing effect-only blank screen. Existing SDK manages access-token refresh. Show server-loaded content while client authentication initializes; start live queries only once authenticated, retaining initial results during that transition. Once authentication definitively fails, hide protected content and show retry. Initial page for paginated query is provided as fallback until usePaginatedQuery's first page is ready, maintaining its existing load-more behavior. Styles query uses the same initial-data fallback pattern because usePreloadedQuery cannot skip while auth initializes in this installed version. Delete redundant sequential getOrganizationContext client consumer; existing data queries verify organization themselves.

D05: Keep neutral style on /styles. Existing public event, admin, participant and saved-link routes unchanged. No Redis, framework upgrade, membership webhooks, new organization creation, production deployment or persistent draft storage. In-memory drafts persist between routes, not full reload/logout/org switch.

## Alternatives

Minimal route-only change would fix URLs but retain loading waterfall. Separate per-page providers would also discard drafts and subscriptions. Shared server/client workspace is selected. A durable webhook-synchronized membership store is more infrastructure than this bounded cache needs.

## Verification and stop rules

Measure real browser pre/post reload readiness and safe server timings for auth, membership loading, initial data. Report dev variability and no unmeasured speedup. Verify direct /styles load, reload, Back/Forward, event draft across routes, titles, neutral layout, defaults/custom selection, Test/Outpost isolation, initial HTML data, and no data flicker during switching. Meaningful unit tests for freshness boundary, cache key separation and upstream failure; existing Convex auth tests remain. TypeScript and focused lint. Screenshot required.

B01 cache identity/freshness; B02 SSR data isolation and auth failure; B03 route/draft lifecycle: independently review before and after implementation, resolve concrete findings. The referenced review-architecture-plan skill file is absent in installed skills; use direct independent plan reviews covering its stated contracts. No external setup permitted if current credentials fail.

One slice: shared routes + request initialization + bounded membership cache. No PR split or external landing operation requested.

## Plan review clarification

B03: Add /styles/:path* to AuthKit middleware before using withAuth on that route. Route-group error boundary handles shared layout and live query failures; existing /events error/loading files move to route-group scope. For StrictMode, use a document-lifetime authenticated browser Convex client (module singleton only in browser; independent inert client during SSR), with no effect cleanup that closes the retained client during replay. Full-document org switching resets both SDK token cache and this client. No client survives a browser document identity boundary.

Plan review: cache_plan_review APPROVE; route_plan_review APPROVE after explicit middleware coverage and shared-loader catch clarification. Final reviews cover conformance and independent architecture separately.


## Completed implementation and evidence

- Routes: /events, /events/new, /styles share one authenticated server/client layout. Ordinary Next Link elements use shadcn buttonVariants and retain native link semantics. Shared identity-keyed form owner stays mounted during route navigation, pending/failed organization switching and temporary auth interruption, hidden/inert while unavailable. Successful full organization navigation resets it. No persistent drafts were added.
- Membership cache uses Next Data Cache with environment and verified user arguments; strict age guard checks both cached and freshly fetched snapshots. React cache deduplicates within a render. Installed Next background revalidation can overlap the foreground expired-result refresh; this bounded extra request is retained to guarantee freshness without adding distributed locking/Redis.
- SSR fetchQuery initializes events and styles with request-local authenticated no-store HTTP clients. Server checks top-level organization IDs even on empty pages. AuthKit initialAuth omits accessToken. Client subscribes after Convex auth while retaining server data. No Convex schema/function deployment needed in this task.
- One shared shadcn Skeleton fallback covers initial server loading. Existing /events sequential client messages and getOrganizationContext consumer removed. Failed sign-in notice restored for signed-out pages and returnTo allowlisted to workspace routes.
- Newly server-rendered URLs use useSiteOrigin (useSyncExternalStore) to keep server/hydration output consistent. Confirmed initial hydration failure in Test before this correction; clean-tab Test event list and final Styles have no browser errors or warnings afterward.

### Checks

47 Node tests and 18 Convex tests pass. TypeScript and focused ESLint pass; git diff --check passes. Five cache tests cover fresh reuse, exact expiration, failed refresh without stale fallback, future timestamps/empty memberships, environment separation, and already-expired slow refresh.

Browser: direct Styles load and full refresh retain /styles and Styles · Outpost | Demo Queue. Back/Forward traverse /events/new and /styles with Route draft QA retained. Custom style-name draft survives Events and Styles navigation. Switch Test→Outpost stays on /styles, hides Test custom style/drafts, and returns current Outpost defaults. No style or event data was saved during this verification. Signed-out HTTP checks for /styles and /styles?error=sign-in confirm login, error feedback and returnTo=/styles; no access to browser credentials was used.

Local reload-to-editable-form timings, measured with the same browser goto + textbox interaction: before 1878/1854 ms; final 779/524 ms. One interim run during active development compilation took 1886 ms; another early run took 725 ms. Final server logs show initial loads around 125–362 ms with cached memberships and no repeated WorkOS source log within the cache window. These are development samples, not production benchmarks.

Screenshot inspected at 1910×1075: /Users/demian/.codex/visualizations/2026/09/05/01a0715b-ed44-70a0-aec3-d83d37dd7e17/styles-route-final.png.

### Review dispositions

- cache_plan_review: pre-plan APPROVE; final initially REJECT B01 slow refresh age unchecked. Fixed with post-refresh freshness guard and passing boundary test. Final APPROVE B01/B02.
- route_plan_review: pre-plan initially REJECT B03 missing explicit middleware coverage. Added coverage, final plan APPROVE. Final implementation initially REJECT for signed-out error feedback and hydration mismatch. Both corrected; final APPROVE B02/B03.
- workspace_cache_architecture: independent blind APPROVE 9/10; no material finding. Notes duplicate refresh request at expiry as bounded efficiency limitation.
- workspace_routes_architecture: independent blind initially REJECT 7.5/10 for draft loss on failed org switches/auth interruptions. Kept owner mounted hidden/inert; re-review APPROVE 8.5/10.

B01/B02/B03 resolved by fixes and re-review; no deferred merge blockers from this slice.

### Limits

No production build/deployment, new mobile visual check, live membership revocation, deliberate WorkOS outage, or forced token expiry. Error freshness is covered by deterministic tests; auth retry/draft lifecycle has source review, not fault-injected browser proof. No commits/pushes, production/environment configuration, Redis, framework upgrades, or persistent draft storage. Production performance and distributed-cache behavior are not claimed. Existing event/style defaults remain as found.
