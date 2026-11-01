import { PostHog } from "posthog-node";
import { analyticsSurface, scrubPath, scrubUrl } from "./analytics-url";
import { redactExceptionList } from "./analytics-redact";

/** Server code sends straight to PostHog's EU ingestion, not through the browser proxy. */
export const POSTHOG_INGEST_HOST = "https://eu.i.posthog.com";

type RequestInfo = { path: string; method: string };
type ErrorContext = { routerKind: string; routePath: string; routeType: string };

/**
 * Reports an error from a Next.js server render, route handler or server
 * action. A short-lived client sends it at once and shuts down, since a
 * serverless function may stop as soon as the response ends. Errors are
 * anonymous: cookieless mode leaves no PostHog id to read from the request.
 */
export async function captureServerError(error: unknown, request: RequestInfo, context: ErrorContext) {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) return;
  const client = new PostHog(token, {
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
  const path = scrubUrl(request.path);
  try {
    client.captureException(error, undefined, {
      $process_person_profile: false,
      environment: process.env.VERCEL_ENV ?? "development",
      surface: analyticsSurface(path),
      path,
      route_path: scrubPath(context.routePath),
      route_type: context.routeType,
      router_kind: context.routerKind,
      method: request.method,
      ...(error && typeof error === "object" && typeof (error as { digest?: unknown }).digest === "string"
        ? { digest: (error as { digest: string }).digest } : {}),
    });
    await client.shutdown(2000);
  } catch {
    // Reporting must never turn one error into two.
  }
}
