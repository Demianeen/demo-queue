import { ConvexError } from "convex/values";
import posthog, { type CaptureResult, type PostHogConfig } from "posthog-js";
import { useEffect } from "react";
import { analyticsSurface, scrubSecretPaths, scrubUrl } from "./analytics-url";
import { redactExceptionList, redactText } from "./analytics-redact";
import { formId } from "./form-id";

/** Properties that hold a URL or a path, wherever they appear in an event. */
const URL_PROPERTY = /url|href|pathname|referrer/i;
/** Autocapture is on only in the organiser workspace, whose URLs hold no secrets. */
const ORGANISER_PAGES = /^https?:\/\/[^/]+\/(events|members|styles|ai-usage)(\/|\?|$)/;

export const analyticsEnvironment = () => process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development";

function scrubValue(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (key === "$elements_chain") return scrubSecretPaths(value);
    return URL_PROPERTY.test(key) ? scrubUrl(value) : value;
  }
  if (Array.isArray(value)) return value.map((item) => scrubValue(key, item));
  if (value && typeof value === "object") return scrubProperties(value as Record<string, unknown>);
  return value;
}

function scrubProperties(properties: Record<string, unknown>) {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) scrubbed[key] = scrubValue(key, value);
  return scrubbed;
}

/**
 * Exception messages can name people ("Redistribute these judges before
 * removing them: ..."), and a stack frame's file can be the page URL.
 */
function redactException(properties: Record<string, unknown>) {
  properties.$exception_list = redactExceptionList(properties.$exception_list);
  if (typeof properties.$exception_message === "string") properties.$exception_message = redactText(properties.$exception_message);
}

function isConvexError(list: unknown) {
  return Array.isArray(list) && list.some((item) => (item as { type?: unknown } | null)?.type === "ConvexError");
}

/**
 * Runs on every event before it leaves the browser: secrets out of every URL
 * property (including `$set` and `$set_once`), exception messages redacted,
 * and the surface the event came from added.
 */
export function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null;
  // Expected Convex states; their messages can name judges or projects.
  if (event.event === "$exception" && isConvexError(event.properties?.$exception_list)) return null;
  const properties = scrubProperties(event.properties ?? {});
  if (event.event === "$exception") redactException(properties);
  if (typeof window !== "undefined") properties.surface ??= analyticsSurface(window.location.pathname);
  event.properties = properties;
  if (event.$set) event.$set = scrubProperties(event.$set);
  if (event.$set_once) event.$set_once = scrubProperties(event.$set_once);
  return event;
}

/**
 * Cookieless on every page: PostHog stores nothing on the device and counts
 * visitors with a daily salted hash on its servers, so no banner is needed.
 * That also means no session replay, no surveys and no `identify`; organisers
 * are identified on server events from Convex instead.
 */
export function posthogOptions(): Partial<PostHogConfig> {
  return {
    api_host: "/ingest",
    ui_host: "https://eu.posthog.com",
    defaults: "2026-08-30",
    cookieless_mode: "always",
    person_profiles: "identified_only",
    disable_session_recording: true,
    disable_surveys: true,
    autocapture: { url_allowlist: [ORGANISER_PAGES] },
    mask_all_text: true,
    mask_all_element_attributes: true,
    capture_exceptions: { capture_unhandled_errors: true, capture_unhandled_rejections: true, capture_console_errors: false },
    // Web vitals for every page, judges' phones in particular; no network timing.
    capture_performance: { web_vitals: true, network_timing: false },
    before_send: scrubEvent,
    // Used wherever PostHog reads the page URL itself rather than an event property.
    get_current_url: scrubUrl,
    loaded: (client) => client.register({ environment: analyticsEnvironment() }),
  };
}

type None = Record<never, never>;

/**
 * Every product event the browser sends, with its properties. No free text:
 * slugs, codes, field names, counts and booleans only.
 */
export type ClientEvents = {
  submission_started: None;
  /** `fields` lists the invalid form fields by name, never what was typed. */
  submission_failed: { reason: "validation" | "email_taken" | "server_error"; fields?: string };
  judge_confirmed: None;
  /** Sent when a save leaves the review complete. */
  review_saved: { assigned: boolean };
  ai_summary_viewed: None;
  readme_opened: None;
  judge_link_failed: None;
  getting_started_step_completed: { step: string };
  /** An error page showed a server error, which the server reported itself under this `digest`. */
  server_error_shown: { boundary: string; digest: string };
};

/**
 * Adds the submit form's `form_id` to every event the page sends from now
 * on, errors included. Returns the cleanup that takes it off again.
 */
export function registerFormId(clientId: string) {
  let active = true;
  void formId(clientId).then((id) => {
    if (active && posthog.__loaded) posthog.register({ form_id: id });
  });
  return () => {
    active = false;
    if (posthog.__loaded) posthog.unregister("form_id");
  };
}

/** Sends a product event; a no-op when PostHog is not configured. */
export function captureEvent<Name extends keyof ClientEvents>(name: Name, properties: ClientEvents[Name] & { event_slug?: string }) {
  if (posthog.__loaded) posthog.capture(name, properties);
}

/**
 * Sends an error a boundary caught; a no-op when PostHog is not configured.
 * A `ConvexError` is an expected state the backend reported on purpose, such
 * as a stale judge link, so it is product analytics rather than a bug.
 * An error with a `digest` happened on the server, which already reported it
 * with its real message; the browser only gets Next.js's stand-in, so it
 * records the digest it showed instead of a second, emptier exception.
 */
export function reportClientError(error: unknown, properties: Record<string, string> = {}) {
  if (!posthog.__loaded || error instanceof ConvexError) return;
  const digest = error && typeof error === "object" ? (error as { digest?: unknown }).digest : undefined;
  if (typeof digest === "string") posthog.capture("server_error_shown", { boundary: properties.boundary ?? "unknown", ...properties, digest });
  else posthog.captureException(error, properties);
}

/**
 * Browser events in the workspace carry the active organisation as a plain
 * property. The WorkOS organisation id is not personal data; the person is
 * only identified on server events.
 */
export function useAnalyticsOrganization(organizationId: string | undefined) {
  useEffect(() => {
    if (!posthog.__loaded) return;
    if (organizationId) posthog.register({ organization_id: organizationId });
    else posthog.unregister("organization_id");
  }, [organizationId]);
}

/**
 * For Next.js `error.tsx` boundaries: React only logs the errors they catch,
 * so exception autocapture never sees them.
 */
export function useReportedError(error: unknown, boundary: string) {
  useEffect(() => reportClientError(error, { boundary }), [error, boundary]);
}
