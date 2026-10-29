import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v, type Infer } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, env, internalAction, internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { requireEventOrganization } from "./organizationAuth";
import type { socialSourcesValidator } from "./schema";
import {
  createLumaClient,
  LUMA_EVENT_INPUT_ERROR,
  lumaEmailHash,
  parseLumaEventInput,
  parseLumaOrganizationIds,
  type LumaFailureReason,
  type LumaSocials,
} from "../lib/luma";
import { emailKey, isValidEmail } from "../lib/validation";

/*
 * Luma import. Nothing here is reachable by an unauthenticated client: after a
 * submission is saved (or its emails change), an internal action looks up each
 * person on the event's Luma guest list and fills only their empty X, LinkedIn
 * and GitHub fields. Only organisations listed in LUMA_ORGANIZATION_IDS (the
 * owners of the key's Luma calendar) can link an event, and only to an event
 * on that calendar.
 */

export const SOCIAL_FIELDS = ["twitter", "linkedin", "githubProfile"] as const;
export type SocialField = (typeof SOCIAL_FIELDS)[number];
export type SocialSources = Infer<typeof socialSourcesValidator>;

/** How long a lookup result is reused before Luma is asked again. */
export const LUMA_LOOKUP_CACHE_MS = 10 * MINUTE;
/** Gap between submissions when a whole event is imported at once. */
export const LUMA_EVENT_IMPORT_STAGGER_MS = 4_000;

/**
 * Lookups are capped per email address and per event, as the status emails
 * are. The per-event cap keeps an import of a whole event well under Luma's
 * own limit (200 a minute per calendar). Cached answers do not count.
 */
export const LUMA_LOOKUP_LIMITS = {
  perEmail: { kind: "fixed window", rate: 5, period: HOUR },
  perEvent: { kind: "token bucket", rate: 3_000, period: HOUR, capacity: 100 },
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
const personTarget = v.union(v.literal("presenter"), v.id("teamMembers"));

function lumaApiKey() {
  return env.LUMA_API_KEY?.trim() || null;
}

/** Whether this WorkOS organisation may use the deployment's Luma key. */
export function lumaOrganizationAllowed(organizationId: string | undefined) {
  return Boolean(organizationId) && parseLumaOrganizationIds(env.LUMA_ORGANIZATION_IDS).has(organizationId!);
}

/** Logs carry only what happened and why: never an email, an answer or the key. */
function logLuma(event: "luma-import" | "luma-link", fields: Record<string, string | number | boolean>) {
  console.log(JSON.stringify({ event, ...fields }));
}

function onlySocials(socials: LumaSocials): LumaSocials {
  const result: LumaSocials = {};
  for (const field of SOCIAL_FIELDS) if (socials[field]) result[field] = socials[field];
  return result;
}

type SocialValues = Partial<Record<SocialField, string | undefined>>;

/** Sources for what a person typed when submitting: each filled field is "typed". */
export function typedSocialSources(values: SocialValues): SocialSources | undefined {
  const sources: SocialSources = {};
  for (const field of SOCIAL_FIELDS) if (values[field]?.trim()) sources[field] = "typed";
  return Object.keys(sources).length ? sources : undefined;
}

/**
 * Sources after a person or an organiser edits socials. A changed field,
 * including one cleared, becomes "typed", so the import never refills it.
 * Unchanged fields keep their source.
 */
export function editedSocialSources(
  before: SocialValues & { socialSources?: SocialSources },
  after: SocialValues,
): SocialSources | undefined {
  const sources: SocialSources = { ...(before.socialSources ?? {}) };
  for (const field of SOCIAL_FIELDS) {
    if (!(field in after)) continue;
    if ((before[field] ?? "").trim() !== (after[field] ?? "").trim()) sources[field] = "typed";
  }
  return Object.keys(sources).length ? sources : undefined;
}

/**
 * When a person's email changes, what Luma filled in came from the old
 * address: those fields are cleared so the import can fill them again.
 */
export function clearLumaSocials(person: SocialValues & { socialSources?: SocialSources }) {
  const patch: SocialValues & { socialSources?: SocialSources } = {};
  const sources: SocialSources = { ...(person.socialSources ?? {}) };
  for (const field of SOCIAL_FIELDS) {
    if (sources[field] === "luma") {
      patch[field] = undefined;
      delete sources[field];
    }
  }
  if (Object.keys(patch).length === 0) return null;
  patch.socialSources = Object.keys(sources).length ? sources : undefined;
  return patch;
}

/**
 * The patch for a person whose socials (and maybe email) were edited: edited
 * fields become "typed", and a changed email clears what Luma filled from the
 * old address. `emailChanged` says whether to queue a new import.
 */
export function socialEditPatch(
  before: SocialValues & { email?: string; socialSources?: SocialSources },
  after: SocialValues,
  nextEmail: string | undefined,
) {
  let socialSources = editedSocialSources(before, after);
  const emailChanged = emailKey(before.email ?? "") !== emailKey(nextEmail ?? "");
  let cleared: SocialValues = {};
  if (emailChanged) {
    const merged = { ...Object.fromEntries(SOCIAL_FIELDS.map((field) => [field, before[field]])), ...after, socialSources };
    const result = clearLumaSocials(merged);
    if (result) {
      const { socialSources: remaining, ...fields } = result;
      cleared = fields;
      socialSources = remaining;
    }
  }
  return { patch: { ...after, ...cleared, socialSources }, emailChanged };
}

/**
 * What a participant may see of a person's socials: only what was typed.
 * Luma-imported values (and the fact that a field came from Luma) are for
 * organisers and judges only, or the status page would be a lookup tool for
 * whichever emails the submitter typed.
 */
export function participantSocials(person: SocialValues & { socialSources?: SocialSources }) {
  const visible = (field: SocialField) => (person.socialSources?.[field] === "luma" ? undefined : person[field]);
  return { twitter: visible("twitter"), linkedin: visible("linkedin"), githubProfile: visible("githubProfile") };
}

/**
 * The patch for socials a participant edited on the status page. They never
 * saw the imported values, so an empty field they send back keeps an imported
 * value. Anything they send counts as typed, even when it matches what Luma
 * had, so it shows to them from then on.
 */
export function participantSocialEditPatch(
  before: SocialValues & { email?: string; socialSources?: SocialSources },
  sent: SocialValues,
  nextEmail: string | undefined,
) {
  const after: SocialValues = { ...sent };
  const sources: SocialSources = { ...(before.socialSources ?? {}) };
  for (const field of SOCIAL_FIELDS) {
    if (!(field in sent)) continue;
    if (sent[field]?.trim()) sources[field] = "typed";
    else if (sources[field] === "luma") after[field] = before[field];
  }
  return socialEditPatch({ ...before, socialSources: Object.keys(sources).length ? sources : undefined }, after, nextEmail);
}

/** Queues the import for one submission when its event is linked and allowed. */
export async function queueLumaImport(
  ctx: Pick<MutationCtx, "scheduler">,
  event: Doc<"events">,
  submissionId: Id<"submissions">,
  delayMs = 0,
) {
  if (!event.lumaEventId || !lumaApiKey() || !lumaOrganizationAllowed(event.workosOrganizationId)) return;
  await ctx.scheduler.runAfter(delayMs, internal.luma.importSubmissionSocials, { submissionId });
}

function importableFields(person: SocialValues & { socialSources?: SocialSources }) {
  return SOCIAL_FIELDS.filter((field) => !person[field]?.trim() && person.socialSources?.[field] !== "typed");
}

// ---------------------------------------------------------------------------
// Import (internal only)

export const importPlan = internalQuery({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    const submission = await ctx.db.get(submissionId);
    if (!submission || submission.status === "withdrawn") return { kind: "skip" as const, reason: "no_submission" };
    const event = await ctx.db.get(submission.eventId);
    if (!event?.lumaEventId) return { kind: "skip" as const, reason: "not_linked" };
    if (!lumaOrganizationAllowed(event.workosOrganizationId)) return { kind: "skip" as const, reason: "organization_not_allowed" };
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_submission", (q) => q.eq("submissionId", submissionId))
      .take(50);
    const people = [
      { target: "presenter" as const, email: submission.email, fields: importableFields(submission) },
      ...members.map((member) => ({ target: member._id, email: member.email, fields: importableFields(member) })),
    ].filter((person): person is { target: "presenter" | Id<"teamMembers">; email: string; fields: SocialField[] } =>
      Boolean(person.email) && person.fields.length > 0,
    );
    return { kind: "import" as const, eventId: event._id, lumaEventId: event.lumaEventId, people };
  },
});

export const beginGuestLookup = internalMutation({
  args: { eventId: v.id("events"), lumaEventId: v.string(), emailHash: v.string() },
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("lumaGuestLookups")
      .withIndex("by_event_and_email", (q) => q.eq("eventId", args.eventId).eq("emailHash", args.emailHash))
      .first();
    if (cached && cached.lumaEventId === args.lumaEventId && cached.expiresAt > Date.now()) {
      return { kind: "cached" as const, socials: onlySocials(cached.socials) };
    }
    const perEmail = await lumaRateLimiter.limit(ctx, "lumaLookupPerEmail", { key: args.emailHash });
    if (!perEmail.ok) return { kind: "limited" as const, limit: "per_email" };
    const perEvent = await lumaRateLimiter.limit(ctx, "lumaLookupPerEvent", { key: args.eventId });
    if (!perEvent.ok) return { kind: "limited" as const, limit: "per_event" };
    return { kind: "fetch" as const };
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
 * Fills a person's empty socials from Luma. Never replaces a value, never
 * fills a field the team cleared, and only if the email is still the one
 * that was looked up.
 */
export const applyImportedSocials = internalMutation({
  args: { submissionId: v.id("submissions"), target: personTarget, email: v.string(), socials: socialsValidator },
  handler: async (ctx, args) => {
    const person =
      args.target === "presenter" ? await ctx.db.get(args.submissionId) : await ctx.db.get(args.target);
    if (!person) return 0;
    if ("submissionId" in person && person.submissionId !== args.submissionId) return 0;
    if (!person.email || emailKey(person.email) !== args.email) return 0;
    const patch: SocialValues = {};
    const sources: SocialSources = { ...(person.socialSources ?? {}) };
    for (const field of importableFields(person)) {
      const value = args.socials[field];
      if (!value) continue;
      patch[field] = value;
      sources[field] = "luma";
    }
    const filled = Object.keys(patch).length;
    if (filled === 0) return 0;
    await ctx.db.patch(person._id, { ...patch, socialSources: sources });
    if (args.target === "presenter") await ctx.db.patch(args.submissionId, { updatedAt: Date.now() });
    return filled;
  },
});

/**
 * Looks up the presenter and every team member of one submission on the
 * event's Luma guest list, and fills their empty X, LinkedIn and GitHub.
 * Failures are logged with status and reason only, and change nothing.
 */
export const importSubmissionSocials = internalAction({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    try {
      const apiKey = lumaApiKey();
      if (!apiKey) {
        logLuma("luma-import", { status: "skipped", reason: "not_configured" });
        return;
      }
      const plan = await ctx.runQuery(internal.luma.importPlan, { submissionId });
      if (plan.kind === "skip") {
        if (plan.reason === "organization_not_allowed") logLuma("luma-import", { status: "skipped", reason: plan.reason });
        return;
      }
      const client = createLumaClient({ apiKey });
      const counts = { people: plan.people.length, cached: 0, registered: 0, notRegistered: 0, failed: 0, limited: 0, fieldsFilled: 0 };
      for (const person of plan.people) {
        const key = emailKey(person.email);
        if (!isValidEmail(key)) continue;
        const emailHash = await lumaEmailHash(key);
        const begin = await ctx.runMutation(internal.luma.beginGuestLookup, { eventId: plan.eventId, lumaEventId: plan.lumaEventId, emailHash });
        let socials: LumaSocials;
        if (begin.kind === "limited") {
          counts.limited += 1;
          logLuma("luma-import", { status: "skipped", reason: "rate_limited", limit: begin.limit });
          continue;
        }
        if (begin.kind === "cached") {
          counts.cached += 1;
          socials = begin.socials;
        } else {
          const result = await client.getGuestSocials(plan.lumaEventId, key);
          if (!result.ok && result.reason !== "not_found") {
            counts.failed += 1;
            logLuma("luma-import", { status: "failed", reason: result.reason, httpStatus: result.status });
            continue;
          }
          socials = result.ok ? onlySocials(result.data) : {};
          if (result.ok) counts.registered += 1;
          else counts.notRegistered += 1;
          await ctx.runMutation(internal.luma.saveGuestLookup, { eventId: plan.eventId, lumaEventId: plan.lumaEventId, emailHash, socials });
        }
        if (Object.keys(socials).length > 0) {
          counts.fieldsFilled += await ctx.runMutation(internal.luma.applyImportedSocials, { submissionId, target: person.target, email: key, socials });
        }
      }
      logLuma("luma-import", { status: "ok", ...counts });
    } catch (error) {
      logLuma("luma-import", { status: "failed", reason: error instanceof Error ? error.name : "unknown" });
    }
  },
});

/** Imports every submission of an event, a few seconds apart (after linking). */
export const importEventSocials = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) return { queued: 0 };
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .take(1000);
    let queued = 0;
    for (const submission of submissions) {
      if (submission.status === "withdrawn") continue;
      await queueLumaImport(ctx, event, submission._id, queued * LUMA_EVENT_IMPORT_STAGGER_MS);
      queued += 1;
    }
    return { queued };
  },
});

// ---------------------------------------------------------------------------
// Linking an event (organisers of the key's calendar only)

const NOT_AVAILABLE = "Luma import is not available for this organization.";

export const requireLinkAccess = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const { event } = await requireEventOrganization(ctx, args.slug);
    if (!lumaOrganizationAllowed(event.workosOrganizationId)) throw new ConvexError(NOT_AVAILABLE);
    return null;
  },
});

export const saveLumaLink = internalMutation({
  args: { slug: v.string(), lumaEventId: v.string(), lumaEventName: v.string(), lumaEventUrl: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { event } = await requireEventOrganization(ctx, args.slug);
    if (!lumaOrganizationAllowed(event.workosOrganizationId)) throw new ConvexError(NOT_AVAILABLE);
    await ctx.db.patch(event._id, {
      lumaEventId: args.lumaEventId,
      lumaEventName: args.lumaEventName,
      lumaEventUrl: args.lumaEventUrl,
      updatedAt: Date.now(),
    });
    // Teams that submitted before the link get their socials too.
    await ctx.scheduler.runAfter(0, internal.luma.importEventSocials, { eventId: event._id });
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
 * event is looked up on Luma first and must be on the key's own calendar.
 * Read-only: nothing is changed on Luma.
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
    const fail = (step: string, failure: { reason: LumaFailureReason; status: number }): never => {
      logLuma("luma-link", { status: "failed", step, reason: failure.reason, httpStatus: failure.status });
      throw new ConvexError(linkError(failure.reason));
    };
    let eventId: string;
    if (ref.kind === "slug") {
      const found = await client.lookupSlug(ref.slug);
      if (!found.ok) return fail("lookup", found);
      if (found.data.kind !== "event") throw new ConvexError("That Luma link is not an event page.");
      eventId = found.data.eventId;
    } else {
      eventId = ref.eventId;
    }
    const lumaEvent = await client.getEvent(eventId);
    if (!lumaEvent.ok) return fail("event", lumaEvent);
    const calendar = await client.getKeyCalendarId();
    if (!calendar.ok) return fail("calendar", calendar);
    if (!lumaEvent.data.calendarId || lumaEvent.data.calendarId !== calendar.data) {
      logLuma("luma-link", { status: "rejected", reason: "other_calendar" });
      throw new ConvexError("That Luma event is not on the calendar this deployment's key belongs to, so it cannot be linked.");
    }
    await ctx.runMutation(internal.luma.saveLumaLink, {
      slug: args.slug,
      lumaEventId: lumaEvent.data.id,
      lumaEventName: lumaEvent.data.name,
      lumaEventUrl: lumaEvent.data.url ?? undefined,
    });
    logLuma("luma-link", { status: "ok" });
    return { id: lumaEvent.data.id, name: lumaEvent.data.name, url: lumaEvent.data.url };
  },
});

export const unlinkLumaEvent = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const { event } = await requireEventOrganization(ctx, args.slug);
    await ctx.db.patch(event._id, { lumaEventId: undefined, lumaEventName: undefined, lumaEventUrl: undefined, updatedAt: Date.now() });
  },
});
