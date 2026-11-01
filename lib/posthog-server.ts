import { PostHog } from "posthog-node";
import { analyticsSurface, scrubPath, scrubUrl } from "./analytics-url";
import { redactExceptionList } from "./analytics-redact";
import { convexErrorText } from "./convex-error";

/** Server code sends straight to PostHog's EU ingestion, not through the browser proxy. */
export const POSTHOG_INGEST_HOST = "https://eu.i.posthog.com";

type RequestInfo = { path: string; method: string };
type ErrorContext = { routerKind: string; routePath: string; routeType: string };

/**
 * A short-lived client per error, since a serverless function may stop as
 * soon as the response ends. Errors are anonymous: cookieless mode leaves no
 * PostHog id to read from the request.
 */
function errorClient() {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) return null;
  return new PostHog(token, {
    host: POSTHOG_INGEST_HOST,
    flushAt: 1,
    flushInterval: 0,
    // Next.js waits for this before answering a route handler, so give up fast.
    fetchRetryCount: 0,
    requestTimeout: 2000,
    before_send: (event) => {
      if (!event?.properties) return event ?? null;
      event.properties.$exception_list = redactExceptionList(event.properties.$exception_list);
      return event;
    },
  });
}

/**
 * Sends one error and waits for PostHog to take it. `captureException`
 * queues it behind an async step, so a 2 s shutdown right after it sometimes
 * gave up first ("Timeout while shutting down PostHog") and the error was lost.
 */
async function send(error: unknown, properties: Record<string, unknown>) {
  const client = errorClient();
  if (!client) return;
  try {
    await client.captureExceptionImmediate(error, undefined, {
      $process_person_profile: false,
      environment: process.env.VERCEL_ENV ?? "development",
      ...properties,
    });
  } catch {
    // Reporting must never turn one error into two.
  }
}

/** Convex puts its request id in the message, also on prod, where the rest is redacted. */
const convexRequestId = (error: unknown) => (error instanceof Error ? /\[Request ID: ([0-9a-f]+)\]/.exec(error.message)?.[1] : undefined);

/**
 * Reports an error from a Next.js server render, route handler or server
 * action. In a production build a render error reaches this hook only as a
 * stand-in ("An error occurred in the Server Components render", plus a
 * digest), so code that can catch the real error reports it with
 * `reportCaughtServerError` as well.
 */
export async function captureServerError(error: unknown, request: RequestInfo, context: ErrorContext) {
  const path = scrubUrl(request.path);
  await send(error, {
    surface: analyticsSurface(path),
    path,
    route_path: scrubPath(context.routePath),
    route_type: context.routeType,
    router_kind: context.routerKind,
    method: request.method,
    ...(error && typeof error === "object" && typeof (error as { digest?: unknown }).digest === "string"
      ? { digest: (error as { digest: string }).digest } : {}),
  });
}

/**
 * Reports an error server code caught itself, with its real message, where
 * the page then shows a fallback or rethrows. `where` names the place, such
 * as "status-title". An error a Convex function threw on purpose
 * (`ConvexError`, such as "Event not found") is an expected state, not a bug,
 * so it is not sent.
 */
export async function reportCaughtServerError(error: unknown, where: string, properties: Record<string, string> = {}) {
  if (convexErrorText(error) !== null) return;
  const requestId = convexRequestId(error);
  await send(error, { surface: "server", where, ...(requestId ? { convex_request_id: requestId } : {}), ...properties });
}
