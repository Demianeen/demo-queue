// Read-only Luma API client and the helpers around it. Framework free, so the
// Convex functions and the Node tests share it. Only GET requests exist here.

// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { isValidGithubProfile, isValidLinkedin, isValidTwitter, SUBMISSION_FIELD_LIMITS } from "./validation.ts";

export const LUMA_API_BASE = "https://public-api.luma.com";
export const LUMA_TIMEOUT_MS = 5_000;
export const LUMA_EVENT_INPUT_ERROR = "Enter a Luma event link (luma.com/...) or an event id that starts with evt-.";

/** The social answers the submit form can use, in the form's own formats. */
export type LumaSocials = { twitter?: string; linkedin?: string; githubProfile?: string };

export type LumaEventRef = { kind: "id"; eventId: string } | { kind: "slug"; slug: string };

export type LumaFailureReason =
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "bad_request"
  | "http_error"
  | "bad_response"
  | "timeout"
  | "network";

export type LumaResult<T> = { ok: true; data: T } | { ok: false; status: number; reason: LumaFailureReason };

export type LumaEventSummary = { id: string; name: string; url: string | null; calendarId: string | null };

type FetchLike = (input: string, init: { method: "GET"; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const EVENT_ID = /^evt-[A-Za-z0-9]{1,64}$/;
const LUMA_HOSTS = new Set(["lu.ma", "luma.com"]);

/**
 * A Luma event id (evt-...) or the slug of a Luma event page, from what an
 * organiser pasted: the id itself, luma.com/<slug>, lu.ma/<slug>, or a Luma
 * address that contains the id (such as a manage page). Null otherwise.
 */
export function parseLumaEventInput(input: string): LumaEventRef | null {
  const trimmed = input.trim();
  if (EVENT_ID.test(trimmed)) return { kind: "id", eventId: trimmed };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  if (!LUMA_HOSTS.has(url.hostname.toLowerCase().replace(/^www\./, ""))) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const id = segments.find((segment) => EVENT_ID.test(segment));
  if (id) return { kind: "id", eventId: id };
  if (segments.length !== 1 || !/^[A-Za-z0-9_-]{1,100}$/.test(segments[0])) return null;
  return { kind: "slug", slug: segments[0] };
}

/** A Luma page address worth linking to, or null for anything off Luma. */
export function lumaEventPageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://luma.com/${trimmed.replace(/^\/+/, "")}`);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!LUMA_HOSTS.has(url.hostname.toLowerCase().replace(/^www\./, ""))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function twitterHandle(value: string) {
  const bare = value.match(/^@?([A-Za-z0-9_]{1,15})$/)?.[1];
  if (bare) return `@${bare}`;
  const url = parseUrl(value);
  if (!url || !/(^|\.)(twitter\.com|x\.com)$/i.test(url.hostname)) return null;
  const handle = url.pathname.split("/").filter(Boolean)[0]?.match(/^@?([A-Za-z0-9_]{1,15})$/)?.[1];
  return handle ? `@${handle}` : null;
}

function githubUsername(value: string) {
  const bare = value.match(/^@?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))$/)?.[1];
  if (bare) return bare;
  const url = parseUrl(value);
  if (!url || !/(^|\.)github\.com$/i.test(url.hostname)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  return segments.length === 1 && isValidGithubProfile(segments[0]) ? segments[0] : null;
}

function linkedinUrl(value: string) {
  const url = parseUrl(value);
  if (url) {
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname) || url.pathname.length <= 1) return null;
    url.protocol = "https:";
    url.hash = "";
    url.search = "";
    return url.toString();
  }
  const path = value.replace(/^@/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!/^(in\/)?[A-Za-z0-9\-_%.]+$/.test(path)) return null;
  return `https://www.linkedin.com/${path.startsWith("in/") ? path : `in/${path}`}`;
}

function parseUrl(value: string) {
  const looksLikeUrl = /^https?:\/\//i.test(value) || /^[^/@\s]+\.[a-z]{2,}\//i.test(value);
  if (!looksLikeUrl) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

const SOCIAL_QUESTIONS = {
  twitter: { field: "twitter", normalize: twitterHandle, valid: isValidTwitter },
  linkedin: { field: "linkedin", normalize: linkedinUrl, valid: isValidLinkedin },
  github: { field: "githubProfile", normalize: githubUsername, valid: isValidGithubProfile },
} as const;

/**
 * The X, LinkedIn and GitHub answers from a Luma guest, normalised to what the
 * submit form accepts. Everything else about the guest (name, email, phone,
 * other answers, tickets) is dropped here. Answers the form would refuse are
 * left out.
 */
export function lumaSocialsFromGuest(guest: unknown): LumaSocials {
  const answers = (guest as { registration_answers?: unknown } | null)?.registration_answers;
  if (!Array.isArray(answers)) return {};
  const socials: LumaSocials = {};
  for (const answer of answers) {
    if (!answer || typeof answer !== "object") continue;
    const { question_type: type, value } = answer as { question_type?: unknown; value?: unknown };
    if (typeof type !== "string" || !Object.hasOwn(SOCIAL_QUESTIONS, type)) continue;
    const question = SOCIAL_QUESTIONS[type as keyof typeof SOCIAL_QUESTIONS];
    if (socials[question.field] || typeof value !== "string") continue;
    const trimmed = value.normalize("NFKC").trim();
    if (!trimmed || trimmed.length > SUBMISSION_FIELD_LIMITS[question.field]) continue;
    const normalized = question.normalize(trimmed);
    if (normalized && normalized.length <= SUBMISSION_FIELD_LIMITS[question.field] && question.valid(normalized)) {
      socials[question.field] = normalized;
    }
  }
  return socials;
}

/** The WorkOS organisation ids allowed to use the deployment's Luma key, from a comma separated list. */
export function parseLumaOrganizationIds(value: string | undefined | null): Set<string> {
  return new Set((value ?? "").split(",").map((id) => id.trim()).filter((id) => /^org_\w+$/.test(id)));
}

/** A SHA-256 of the normalised email, so lookups are cached without storing the address. */
export async function lumaEmailHash(normalizedEmail: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`luma-lookup:${normalizedEmail}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function reasonForStatus(status: number): LumaFailureReason {
  if (status === 404) return "not_found";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status === 400) return "bad_request";
  return "http_error";
}

/**
 * A read-only Luma client. `fetch` is injectable so tests never reach Luma.
 * Results carry only an HTTP status and a reason on failure, never the
 * response body, the request URL or the key.
 */
export function createLumaClient({
  apiKey,
  fetch: fetchImpl = globalThis.fetch as unknown as FetchLike,
  timeoutMs = LUMA_TIMEOUT_MS,
}: {
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}) {
  async function get(path: string, params: Record<string, string>): Promise<LumaResult<unknown>> {
    const url = new URL(path, LUMA_API_BASE);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: { accept: "application/json", "x-luma-api-key": apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return { ok: false, status: 0, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
    }
    if (!response.ok) return { ok: false, status: response.status, reason: reasonForStatus(response.status) };
    try {
      return { ok: true, data: await response.json() };
    } catch {
      return { ok: false, status: response.status, reason: "bad_response" };
    }
  }

  return {
    /** What a luma.com/<slug> page is: an event (with its id) or something else. */
    async lookupSlug(slug: string): Promise<LumaResult<{ kind: "event"; eventId: string } | { kind: "other" }>> {
      const result = await get("/v1/entities/lookup", { slug });
      if (!result.ok) return result;
      const entity = (result.data as { entity?: { type?: unknown; event?: { id?: unknown } } | null } | null)?.entity;
      const eventId = entity?.type === "event" ? entity.event?.id : undefined;
      return { ok: true, data: typeof eventId === "string" && EVENT_ID.test(eventId) ? { kind: "event", eventId } : { kind: "other" } };
    },

    /** The event's id, name and page, when the key can read it. */
    async getEvent(eventId: string): Promise<LumaResult<LumaEventSummary>> {
      const result = await get("/v1/events/get", { event_id: eventId });
      if (!result.ok) return result;
      const body = result.data as { event?: unknown } | null;
      const event = (body && typeof body === "object" && "event" in body ? body.event : body) as { id?: unknown; name?: unknown; url?: unknown; calendar_id?: unknown } | null;
      if (!event || typeof event.id !== "string" || !EVENT_ID.test(event.id)) return { ok: false, status: 200, reason: "bad_response" };
      const name = typeof event.name === "string" && event.name.trim() ? event.name.trim().slice(0, 200) : event.id;
      const calendarId = typeof event.calendar_id === "string" && event.calendar_id ? event.calendar_id : null;
      return { ok: true, data: { id: event.id, name, url: lumaEventPageUrl(event.url), calendarId } };
    },

    /** The id of the calendar this API key belongs to. */
    async getKeyCalendarId(): Promise<LumaResult<string>> {
      const result = await get("/v1/calendars/get", {});
      if (!result.ok) return result;
      const body = result.data as { calendar?: unknown } | null;
      const calendar = (body && typeof body === "object" && "calendar" in body ? body.calendar : body) as { id?: unknown } | null;
      if (!calendar || typeof calendar.id !== "string" || !calendar.id) return { ok: false, status: 200, reason: "bad_response" };
      return { ok: true, data: calendar.id };
    },

    /** Only the X, LinkedIn and GitHub answers of the guest registered with this email. */
    async getGuestSocials(eventId: string, email: string): Promise<LumaResult<LumaSocials>> {
      const result = await get("/v1/events/guests/get", { event_id: eventId, id: email });
      if (!result.ok) return result;
      const body = result.data as { guest?: unknown } | null;
      const guest = body && typeof body === "object" && "guest" in body ? body.guest : body;
      return { ok: true, data: lumaSocialsFromGuest(guest) };
    },
  };
}
