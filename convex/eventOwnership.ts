import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const rowValidator = v.object({
  eventId: v.id("events"),
  slug: v.string(),
  expectedOrganizationId: v.union(v.string(), v.null()),
  organizationId: v.string(),
});

export const inventory = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    if (paginationOpts.numItems < 1 || paginationOpts.numItems > 100) {
      throw new Error("Inventory page size must be between 1 and 100");
    }
    const result = await ctx.db.query("events").paginate(paginationOpts);
    return {
      ...result,
      page: result.page.map((event) => ({
        eventId: event._id,
        name: event.name,
        slug: event.slug,
        organizationId: event.workosOrganizationId ?? null,
      })),
    };
  },
});

export const assign = internalMutation({
  args: { rows: v.array(rowValidator), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { rows, dryRun = true }) => {
    if (rows.length < 1 || rows.length > 100) {
      throw new Error("Manifest must contain between 1 and 100 rows");
    }
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.eventId)) throw new Error("Duplicate event ID");
      seen.add(row.eventId);
      if (!/^org_[A-Za-z0-9]+$/.test(row.organizationId)) {
        throw new Error("Invalid organization ID");
      }
      if (row.expectedOrganizationId !== null && row.expectedOrganizationId !== row.organizationId) {
        throw new Error("Existing organization ownership cannot be reassigned");
      }
    }
    const plan = [];
    for (const row of rows) {
      const event = await ctx.db.get(row.eventId);
      if (!event || event.slug !== row.slug) throw new Error("Event identity precondition failed");
      const currentOrganizationId = event.workosOrganizationId ?? null;
      const kind: "noop" | "change" = currentOrganizationId === row.organizationId ? "noop" : "change";
      if (kind === "change" && (currentOrganizationId !== row.expectedOrganizationId || currentOrganizationId !== null)) {
        throw new Error("Event ownership precondition failed");
      }
      plan.push({ ...row, currentOrganizationId, kind });
    }
    if (!dryRun) {
      for (const row of plan) {
        if (row.kind === "change") {
          await ctx.db.patch(row.eventId, { workosOrganizationId: row.organizationId });
        }
      }
    }
    return { dryRun, rows: plan };
  },
});
