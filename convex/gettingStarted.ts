import { v } from "convex/values";
import { action, mutation, query, type QueryCtx } from "./_generated/server";
import { components } from "./_generated/api";
import { requireOrganization } from "./organizationAuth";
import { componentSiteUrl, connectionIdentity } from "./mcpConnectionPolicy";
import { organizationTeamCounts } from "./members";

const TEST_PEOPLE_ACTION = "test_submission_admin_added";

/** The MCP address assistants connect to, or null on a deployment without a public one. */
function mcpUrl() {
  try { return `${componentSiteUrl()}/mcp`; } catch { return null; }
}

async function guideRow(ctx: QueryCtx, ownerAccountKey: string, organizationId: string) {
  return ctx.db.query("gettingStartedGuides").withIndex("by_owner_and_organization", (q) => q.eq("ownerAccountKey", ownerAccountKey).eq("organizationId", organizationId)).unique();
}

/** True when this person has a live assistant connection that can use this organization. */
async function hasConnection(ctx: QueryCtx, ownerAccountKey: string, organizationId: string) {
  const approvals = await ctx.db.query("mcpApprovals").withIndex("by_ownerAccountKey", (q) => q.eq("ownerAccountKey", ownerAccountKey)).order("desc").take(50);
  for (const approval of approvals) {
    if (approval.revokedAt !== undefined) continue;
    const covers = approval.allOrganizations || await ctx.db.query("mcpApprovalOrganizations").withIndex("by_approvalId_and_organizationId", (q) => q.eq("approvalId", approval._id).eq("organizationId", organizationId)).first();
    if (!covers) continue;
    const grants = await ctx.runQuery(components.mcp.grants.list, { userId: approval._id });
    if (grants.length > 0) return true;
  }
  return false;
}

/** True when any of the organization's events has had test people added. */
async function hasTestPeople(ctx: QueryCtx, organizationId: string) {
  const events = await ctx.db.query("events").withIndex("by_workosOrganizationId", (q) => q.eq("workosOrganizationId", organizationId)).order("desc").take(50);
  for (const event of events) {
    const added = await ctx.db.query("auditLog").withIndex("by_event_and_action", (q) => q.eq("eventId", event._id).eq("action", TEST_PEOPLE_ACTION)).first();
    if (added) return true;
  }
  return false;
}

/** The guide's own state for the signed-in person in their current organization. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await requireOrganization(ctx);
    const { ownerAccountKey } = connectionIdentity(await ctx.auth.getUserIdentity());
    const row = await guideRow(ctx, ownerAccountKey, organizationId);
    return {
      organizationId,
      hidden: row?.hidden ?? false,
      dryRunMarked: row?.dryRunMarkedAt !== undefined,
      testPeopleAdded: await hasTestPeople(ctx, organizationId),
      connected: await hasConnection(ctx, ownerAccountKey, organizationId),
      mcpUrl: mcpUrl(),
    };
  },
});

/** The MCP address for the connections page, which may have no organization chosen. */
export const mcpAddress = query({
  args: {},
  handler: async (ctx) => {
    connectionIdentity(await ctx.auth.getUserIdentity());
    return mcpUrl();
  },
});

export const setHidden = mutation({
  args: { hidden: v.boolean() },
  handler: async (ctx, { hidden }) => {
    const { organizationId } = await requireOrganization(ctx);
    const { ownerAccountKey } = connectionIdentity(await ctx.auth.getUserIdentity());
    const row = await guideRow(ctx, ownerAccountKey, organizationId);
    if (row) await ctx.db.patch("gettingStartedGuides", row._id, { hidden, updatedAt: Date.now() });
    else await ctx.db.insert("gettingStartedGuides", { ownerAccountKey, organizationId, hidden, updatedAt: Date.now() });
    return null;
  },
});

export const markDryRun = mutation({
  args: { done: v.boolean() },
  handler: async (ctx, { done }) => {
    const { organizationId } = await requireOrganization(ctx);
    const { ownerAccountKey } = connectionIdentity(await ctx.auth.getUserIdentity());
    const row = await guideRow(ctx, ownerAccountKey, organizationId);
    const dryRunMarkedAt = done ? Date.now() : undefined;
    if (row) await ctx.db.patch("gettingStartedGuides", row._id, { dryRunMarkedAt, updatedAt: Date.now() });
    else await ctx.db.insert("gettingStartedGuides", { ownerAccountKey, organizationId, hidden: false, dryRunMarkedAt, updatedAt: Date.now() });
    return null;
  },
});

/** Invitation and member counts from WorkOS, for the "Invite your team" step. */
export const teamStatus = action({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await requireOrganization(ctx);
    return organizationTeamCounts(organizationId);
  },
});

