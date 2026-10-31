import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireEventOrganization } from "./organizationAuth";
import { MAX_EVENT_SPONSORS, normalizeSponsorInput, normalizeSponsorList, sponsorKey, type SponsorInput } from "../lib/sponsors";

export const sponsorInputValidator = v.object({
  name: v.string(),
  usage: v.optional(v.string()),
});

function toConvexError(error: unknown): never {
  if (error instanceof ConvexError) throw error;
  throw new ConvexError(error instanceof Error ? error.message : "Invalid sponsor.");
}

export async function listEventSponsors(ctx: Pick<QueryCtx, "db">, eventId: Id<"events">) {
  return await ctx.db
    .query("eventSponsors")
    .withIndex("by_event_and_order", (q) => q.eq("eventId", eventId))
    .take(MAX_EVENT_SPONSORS + 1);
}

export function publicSponsor(sponsor: Doc<"eventSponsors">) {
  return { id: sponsor._id, name: sponsor.name, usage: sponsor.usage };
}

export async function insertEventSponsors(ctx: MutationCtx, eventId: Id<"events">, inputs: SponsorInput[]) {
  let sponsors;
  try {
    sponsors = normalizeSponsorList(inputs);
  } catch (error) {
    toConvexError(error);
  }
  const now = Date.now();
  for (const [order, sponsor] of sponsors.entries()) {
    await ctx.db.insert("eventSponsors", { eventId, ...sponsor, order, createdAt: now, updatedAt: now });
  }
}

/** The hackathon and the sponsor, for an organiser of its organization. */
async function adminEvent(ctx: MutationCtx, slug: string) {
  const { event, actor } = await requireEventOrganization(ctx, slug);
  if (event.eventType !== "hackathon") throw new ConvexError("Sponsors are for hackathons.");
  return { event, actor };
}

async function adminSponsor(ctx: MutationCtx, slug: string, sponsorId: Id<"eventSponsors">) {
  const { event, actor } = await adminEvent(ctx, slug);
  const sponsor = await ctx.db.get(sponsorId);
  if (!sponsor || sponsor.eventId !== event._id) throw new ConvexError("Sponsor not found.");
  return { event, actor, sponsor };
}

function assertUniqueName(sponsors: Doc<"eventSponsors">[], name: string, exceptId?: Id<"eventSponsors">) {
  const key = sponsorKey(name);
  if (sponsors.some((sponsor) => sponsor._id !== exceptId && sponsorKey(sponsor.name) === key)) {
    throw new ConvexError(`There is already a sponsor called "${name}".`);
  }
}

async function logSponsorAction(ctx: MutationCtx, eventId: Id<"events">, action: string, actor: string, details: string) {
  await ctx.db.insert("auditLog", { eventId, action, actor, details, createdAt: Date.now() });
}

export const addSponsor = mutation({
  args: { slug: v.string(), name: v.string(), usage: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { event, actor } = await adminEvent(ctx, args.slug);
    let input;
    try {
      input = normalizeSponsorInput(args);
    } catch (error) {
      toConvexError(error);
    }
    const sponsors = await listEventSponsors(ctx, event._id);
    if (sponsors.length >= MAX_EVENT_SPONSORS) throw new ConvexError(`An event can have up to ${MAX_EVENT_SPONSORS} sponsors.`);
    assertUniqueName(sponsors, input.name);
    const now = Date.now();
    const order = sponsors.reduce((max, sponsor) => Math.max(max, sponsor.order), -1) + 1;
    const sponsorId = await ctx.db.insert("eventSponsors", { eventId: event._id, ...input, order, createdAt: now, updatedAt: now });
    await logSponsorAction(ctx, event._id, "sponsor_added", actor, input.name);
    return { sponsorId };
  },
});

export const updateSponsor = mutation({
  args: { slug: v.string(), sponsorId: v.id("eventSponsors"), name: v.string(), usage: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { event, actor, sponsor } = await adminSponsor(ctx, args.slug, args.sponsorId);
    let input;
    try {
      input = normalizeSponsorInput(args);
    } catch (error) {
      toConvexError(error);
    }
    assertUniqueName(await listEventSponsors(ctx, event._id), input.name, sponsor._id);
    await ctx.db.patch(sponsor._id, { name: input.name, usage: input.usage, updatedAt: Date.now() });
    await logSponsorAction(ctx, event._id, "sponsor_updated", actor, `${sponsor.name} -> ${input.name}`);
  },
});

export const removeSponsor = mutation({
  args: { slug: v.string(), sponsorId: v.id("eventSponsors") },
  handler: async (ctx, args) => {
    const { event, actor, sponsor } = await adminSponsor(ctx, args.slug, args.sponsorId);
    await ctx.db.delete(sponsor._id);
    await logSponsorAction(ctx, event._id, "sponsor_removed", actor, sponsor.name);
  },
});
