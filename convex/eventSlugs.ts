import { ConvexError, v } from "convex/values";
import { internalMutation, type QueryCtx } from "./_generated/server";

export async function findEventBySlug(ctx: Pick<QueryCtx, "db">, slug: string) {
  const event = await ctx.db.query("events").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
  if (event) return event;
  const alias = await ctx.db.query("eventSlugAliases").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
  return alias ? await ctx.db.get(alias.eventId) : null;
}

export const rename = internalMutation({
  args: {
    eventId: v.id("events"),
    expectedSlug: v.string(),
    expectedOrganizationId: v.string(),
    newSlug: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    for (const slug of [args.expectedSlug, args.newSlug]) {
      if (slug.length > 200 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new ConvexError("Invalid event slug.");
      }
    }
    if (args.expectedSlug === args.newSlug) throw new ConvexError("Choose a different event slug.");
    const event = await ctx.db.get(args.eventId);
    if (!event || !/^org_[A-Za-z0-9]+$/.test(args.expectedOrganizationId) || event.workosOrganizationId !== args.expectedOrganizationId) {
      throw new ConvexError("Event ownership changed. Review the rename again.");
    }
    const oldAlias = await ctx.db.query("eventSlugAliases").withIndex("by_slug", (q) => q.eq("slug", args.expectedSlug)).unique();
    const dryRun = args.dryRun ?? true;
    const result = { dryRun, eventId: event._id, previousSlug: args.expectedSlug, slug: args.newSlug };
    const previousCanonical = await ctx.db.query("events").withIndex("by_slug", (q) => q.eq("slug", args.expectedSlug)).unique();
    if (previousCanonical && previousCanonical._id !== event._id) throw new ConvexError("The previous slug belongs to another event.");
    if (event.slug === args.newSlug && oldAlias?.eventId === event._id) {
      return { ...result, kind: "noop" as const };
    }
    if (event.slug !== args.expectedSlug) throw new ConvexError("Event slug changed. Review the rename again.");
    if (oldAlias && oldAlias.eventId !== event._id) throw new ConvexError("The previous slug belongs to another event.");
    const [canonical, alias] = await Promise.all([
      ctx.db.query("events").withIndex("by_slug", (q) => q.eq("slug", args.newSlug)).unique(),
      ctx.db.query("eventSlugAliases").withIndex("by_slug", (q) => q.eq("slug", args.newSlug)).unique(),
    ]);
    if (canonical || alias) throw new ConvexError("That event slug already exists.");
    if (!dryRun) {
      if (!oldAlias) await ctx.db.insert("eventSlugAliases", { slug: args.expectedSlug, eventId: event._id });
      await ctx.db.patch(event._id, { slug: args.newSlug });
    }
    return { ...result, kind: "change" as const };
  },
});
