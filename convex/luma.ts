import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { action, env, internalMutation, internalQuery, mutation } from "./_generated/server";
import { findEventBySlug } from "./eventSlugs";
import { requireEventOrganization } from "./organizationAuth";
import {
  createLumaClient,
  LUMA_EVENT_INPUT_ERROR,
  lumaEmailHash,
  parseLumaEventInput,
  type LumaFailureReason,
  type LumaSocials,
} from "../lib/luma";
import { emailKey, isValidEmail } from "../lib/validation";

/** How long a lookup result is reused before Luma is asked again. */
export const LUMA_LOOKUP_CACHE_MS = 10 * MINUTE;

/**
 * The lookup needs no sign-in, so it is capped like the status emails: a few
 * per email address per hour across all events, and a ceiling per event that
 * stays well under Luma's own limit (200 a minute per calendar). Cached
 * answers do not count.
 */
export const LUMA_LOOKUP_LIMITS = {
  perEmail: { kind: "fixed window", rate: 5, period: HOUR },
  perEvent: { kind: "token bucket", rate: 600, period: HOUR, capacity: 60 },
} as const;

export const lumaRateLimiter = new RateLimiter(components.rateLimiter, {
  lumaLookupPerEmail: LUMA_LOOKUP_LIMITS.perEmail,
  lumaLookupPerEvent: LUMA_LOOKUP_LIMITS.perEvent,
});

const socialsValidator = v.object({
  twitter: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  githubProfile: v.optional(v.string()),
});

function lumaApiKey() {
  return env.LUMA_API_KEY?.trim() || null;
}

/** Logs carry only what happened and why: never the email, the answers or the key. */
function logLuma(event: "luma-lookup" | "luma-link", fields: Record<string, string | number | boolean>) {
  console.log(JSON.stringify({ event, ...fields }));
}

function onlySocials(socials: LumaSocials): LumaSocials {
  const result: LumaSocials = {};
  if (socials.twitter) result.twitter = socials.twitter;
  if (socials.linkedin) result.linkedin = socials.linkedin;
  if (socials.githubProfile) result.githubProfile = socials.githubProfile;
  return result;
}

// ---------------------------------------------------------------------------
// Prefill on the submit form

export const beginGuestLookup = internalMutation({
  args: { slug: v.string(), emailHash: v.string() },
  handler: async (ctx, args) => {
    const event = await findEventBySlug(ctx, args.slug);
    if (!event?.lumaEventId || event.submissionsClosedAt !== undefined) return { kind: "skip" as const };
    const cached = await ctx.db
      .query("lumaGuestLookups")
      .withIndex("by_event_and_email", (q) => q.eq("eventId", event._id).eq("emailHash", args.emailHash))
      .first();
    if (cached && cached.lumaEventId === event.lumaEventId && cached.expiresAt > Date.now()) {
      return { kind: "cached" as const, socials: onlySocials(cached.socials) };
    }
    const perEmail = await lumaRateLimiter.limit(ctx, "lumaLookupPerEmail", { key: args.emailHash });
    if (!perEmail.ok) return { kind: "limited" as const, limit: "per_email" };
    const perEvent = await lumaRateLimiter.limit(ctx, "lumaLookupPerEvent", { key: event._id });
    if (!perEvent.ok) return { kind: "limited" as const, limit: "per_event" };
    return { kind: "fetch" as const, eventId: event._id, lumaEventId: event.lumaEventId };
  },
});

export const saveGuestLookup = internalMutation({
  args: { eventId: v.id("events"), lumaEventId: v.string(), emailHash: v.string(), socials: socialsValidator },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("lumaGuestLookups")
      .withIndex("by_event_and_email", (q) => q.eq("eventId", args.eventId).eq("emailHash", args.emailHash))
      .take(10);
    for (const row of existing) await ctx.db.delete(row._id);
    const id = await ctx.db.insert("lumaGuestLookups", { ...args, socials: onlySocials(args.socials), expiresAt: Date.now() + LUMA_LOOKUP_CACHE_MS });
    await ctx.scheduler.runAfter(LUMA_LOOKUP_CACHE_MS, internal.luma.expireGuestLookup, { id });
  },
});

export const expireGuestLookup = internalMutation({
  args: { id: v.id("lumaGuestLookups") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row && row.expiresAt <= Date.now()) await ctx.db.delete(id);
  },
});

/**
 * The X, LinkedIn and GitHub answers this email gave when registering on the
 * event's Luma page, to prefill the submit form. Returns only those handles,
 * and an empty object whenever anything is missing, limited or failing, so the
 * form never depends on it.
 */
export const lookupLumaSocials = action({
  args: { slug: v.string(), email: v.string() },
  returns: socialsValidator,
  handler: async (ctx, args): Promise<LumaSocials> => {
    try {
      const key = emailKey(args.email);
      if (!isValidEmail(key)) return {};
      const apiKey = lumaApiKey();
      if (!apiKey) {
        logLuma("luma-lookup", { status: "skipped", reason: "not_configured" });
        return {};
      }
      const emailHash = await lumaEmailHash(key);
      const begin = await ctx.runMutation(internal.luma.beginGuestLookup, { slug: args.slug, emailHash });
      if (begin.kind === "skip") return {};
      if (begin.kind === "cached") return begin.socials;
      if (begin.kind === "limited") {
        logLuma("luma-lookup", { status: "skipped", reason: "rate_limited", limit: begin.limit });
        return {};
      }
      const result = await createLumaClient({ apiKey }).getGuestSocials(begin.lumaEventId, key);
      if (!result.ok && result.reason !== "not_found") {
        logLuma("luma-lookup", { status: "failed", reason: result.reason, httpStatus: result.status });
        return {};
      }
      const socials = result.ok ? onlySocials(result.data) : {};
      await ctx.runMutation(internal.luma.saveGuestLookup, { eventId: begin.eventId, lumaEventId: begin.lumaEventId, emailHash, socials });
      logLuma("luma-lookup", { status: "ok", registered: result.ok, fields: Object.keys(socials).length });
      return socials;
    } catch (error) {
      logLuma("luma-lookup", { status: "failed", reason: error instanceof Error ? error.name : "unknown" });
      return {};
    }
  },
});

// ---------------------------------------------------------------------------
// Linking an event (organisers)

export const requireLinkAccess = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    await requireEventOrganization(ctx, args.slug);
    return null;
  },
});

export const saveLumaLink = internalMutation({
  args: { slug: v.string(), lumaEventId: v.string(), lumaEventName: v.string(), lumaEventUrl: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { event } = await requireEventOrganization(ctx, args.slug);
    await ctx.db.patch(event._id, {
      lumaEventId: args.lumaEventId,
      lumaEventName: args.lumaEventName,
      lumaEventUrl: args.lumaEventUrl,
      updatedAt: Date.now(),
    });
  },
});

function linkError(reason: LumaFailureReason) {
  if (reason === "not_found" || reason === "forbidden" || reason === "bad_request") {
    return "Luma could not find that event for this API key. Check the link, and that the event is on the Luma calendar the key belongs to.";
  }
  if (reason === "unauthorized") return "Luma refused the API key. Ask your developer to check LUMA_API_KEY.";
  if (reason === "rate_limited") return "Luma is busy. Try again in a minute.";
  return "Luma did not answer. Try again.";
}

/**
 * Links this event to a Luma event, from its luma.com link or evt- id. The
 * event is looked up on Luma first, so only an event the key can read is
 * saved. Read-only: nothing is changed on Luma.
 */
export const linkLumaEvent = action({
  args: { slug: v.string(), lumaEvent: v.string() },
  handler: async (ctx, args): Promise<{ id: string; name: string; url: string | null }> => {
    await ctx.runQuery(internal.luma.requireLinkAccess, { slug: args.slug });
    const ref = parseLumaEventInput(args.lumaEvent);
    if (!ref) throw new ConvexError(LUMA_EVENT_INPUT_ERROR);
    const apiKey = lumaApiKey();
    if (!apiKey) {
      logLuma("luma-link", { status: "skipped", reason: "not_configured" });
      throw new ConvexError("Luma is not connected on this deployment yet. Ask your developer to add LUMA_API_KEY.");
    }
    const client = createLumaClient({ apiKey });
    let eventId: string;
    if (ref.kind === "slug") {
      const found = await client.lookupSlug(ref.slug);
      if (!found.ok) {
        logLuma("luma-link", { status: "failed", step: "lookup", reason: found.reason, httpStatus: found.status });
        throw new ConvexError(linkError(found.reason));
      }
      if (found.data.kind !== "event") throw new ConvexError("That Luma link is not an event page.");
      eventId = found.data.eventId;
    } else {
      eventId = ref.eventId;
    }
    const lumaEvent = await client.getEvent(eventId);
    if (!lumaEvent.ok) {
      logLuma("luma-link", { status: "failed", step: "event", reason: lumaEvent.reason, httpStatus: lumaEvent.status });
      throw new ConvexError(linkError(lumaEvent.reason));
    }
    await ctx.runMutation(internal.luma.saveLumaLink, {
      slug: args.slug,
      lumaEventId: lumaEvent.data.id,
      lumaEventName: lumaEvent.data.name,
      lumaEventUrl: lumaEvent.data.url ?? undefined,
    });
    logLuma("luma-link", { status: "ok" });
    return lumaEvent.data;
  },
});

export const unlinkLumaEvent = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const { event } = await requireEventOrganization(ctx, args.slug);
    await ctx.db.patch(event._id, { lumaEventId: undefined, lumaEventName: undefined, lumaEventUrl: undefined, updatedAt: Date.now() });
  },
});
