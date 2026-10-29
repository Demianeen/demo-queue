import { v, ConvexError, type Infer } from "convex/values";
import type { UserIdentity } from "convex/server";
import { vMcpUser } from "@convex-dev/mcp";
import { z } from "zod";
import type { QueryCtx } from "./_generated/server";
import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const accessValidator = v.union(v.literal("read"), v.literal("manage"));
export const MCP_SCOPES = {
  "events:read": "Read event administration, without contacts or capability links",
  "events:manage": "All read access plus managing events, contacts, capability links, judging, styles and external actions",
};
export type McpAccess = Infer<typeof accessValidator>;
export type McpScope = keyof typeof MCP_SCOPES;
export function normalizeScopes(scopes: readonly string[]): McpScope[] {
  if (scopes.includes("events:manage")) return ["events:read", "events:manage"];
  return scopes.includes("events:read") ? ["events:read"] : [];
}
export const scopesForAccess = (access: McpAccess): McpScope[] => normalizeScopes([`events:${access}`]);

export function connectionIdentity(identity: UserIdentity | null) {
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!identity || !clientId || !/^user_[A-Za-z0-9]+$/.test(identity.subject) ||
    !["https://api.workos.com/", `https://api.workos.com/user_management/${clientId}`].includes(identity.issuer)) {
    throw new ConvexError("Sign in to connect an agent.");
  }
  return { ownerAccountKey: `workos:${clientId}:${identity.subject}`, workosUserId: identity.subject, actor: identity.tokenIdentifier };
}

export function componentSiteUrl() {
  switch (process.env.CONVEX_SITE_URL) {
    case "https://precious-elk-564.convex.site": return "https://precious-elk-564.convex.site";
    case "https://giant-egret-456.convex.site": return "https://hack.outpostcrew.co";
    default: throw new Error("MCP requires a canonical Convex site URL.");
  }
}

export function componentConfiguration() {
  const siteUrl = componentSiteUrl();
  if (siteUrl === "https://hack.outpostcrew.co") {
    return { siteUrl, consentUrl: `${siteUrl}/events/connect`, allowedOrigins: [siteUrl] };
  }
  const consentUrl = process.env.MCP_CONSENT_URL ?? "http://localhost:3002/events/connect";
  const url = new URL(consentUrl);
  if ((url.origin !== "http://localhost:3002" && url.protocol !== "https:") ||
    url.username || url.password || consentUrl !== `${url.origin}/events/connect`) {
    throw new Error("Invalid MCP consent URL.");
  }
  return { siteUrl, consentUrl, allowedOrigins: [...new Set(["http://localhost:3002", url.origin])] };
}

const membershipPage = z.object({
  data: z.array(z.object({ user_id: z.string(), organization_id: z.string(), organization_name: z.string(), status: z.enum(["active", "inactive", "pending"]) })).max(100),
  list_metadata: z.object({ after: z.string().min(1).max(4096).nullable() }),
});

export async function currentMemberships(workosUserId: string): Promise<{ id: string; name: string }[]> {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) throw new ConvexError("Membership verification is unavailable.");
  const organizations = new Map<string, { id: string; name: string }>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const url = new URL("https://api.workos.com/user_management/organization_memberships");
    url.searchParams.set("user_id", workosUserId);
    url.searchParams.set("limit", "100");
    url.searchParams.append("statuses", "active");
    if (cursor) url.searchParams.set("after", cursor);
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000), redirect: "error" });
      if (!response.ok) throw new Error("provider_unavailable");
      const page = membershipPage.parse(await response.json());
      for (const membership of page.data) {
        if (membership.user_id === workosUserId && membership.status === "active") organizations.set(membership.organization_id, { id: membership.organization_id, name: membership.organization_name });
      }
      cursor = page.list_metadata.after;
      if (cursor && cursors.has(cursor)) throw new Error("Repeated membership cursor");
      if (cursor) cursors.add(cursor);
      if (cursors.size > 100) throw new Error("Membership pagination limit");
    } catch { throw new ConvexError("Membership verification is unavailable."); }
  } while (cursor);
  return [...organizations.values()];
}

export function selectedOrganizations(selected: string[], memberships: { id: string }[], allOrganizations?: true) {
  if (allOrganizations) {
    if (selected.length !== 0) throw new ConvexError("Choose either all organizations or specific organizations.");
    if (memberships.length === 0) throw new ConvexError("You must currently belong to an organization.");
    return [];
  }
  const organizationIds = [...new Set(selected)];
  if (organizationIds.length === 0 || organizationIds.length > 100 || organizationIds.some((id) => !memberships.some((organization) => organization.id === id))) {
    throw new ConvexError("Choose organizations you currently belong to.");
  }
  return organizationIds;
}

export async function requireApproval(ctx: Pick<QueryCtx, "db">, approvalId: Id<"mcpApprovals">, organizationId: string, scope: string) {
  const approval = await ctx.db.get("mcpApprovals", approvalId);
  if (!approval || approval.revokedAt !== undefined || !normalizeScopes(approval.approvedScopes).some((approvedScope) => approvedScope === scope)) throw new ConvexError("Unauthorized");
  if (!approval.allOrganizations) {
    const organization = await ctx.db.query("mcpApprovalOrganizations").withIndex("by_approvalId_and_organizationId", (q) => q.eq("approvalId", approvalId).eq("organizationId", organizationId)).unique();
    if (!organization) throw new ConvexError("Unauthorized");
  }
  return approval;
}

export const getApproval = internalQuery({
  args: { approvalId: v.string() },
  handler: async (ctx, { approvalId }) => {
    const id = ctx.db.normalizeId("mcpApprovals", approvalId);
    const approval = id ? await ctx.db.get("mcpApprovals", id) : null;
    return approval?.revokedAt === undefined ? approval : null;
  },
});

export const getPrincipal = internalQuery({
  args: { user: vMcpUser(v.id("mcpApprovals")), organizationId: v.string(), scope: v.string() },
  handler: async (ctx, { user, organizationId, scope }) => {
    if (!normalizeScopes(user.scopes).some((userScope) => userScope === scope)) throw new ConvexError("Unauthorized");
    const approval = await requireApproval(ctx, user.userId, organizationId, scope);
    return { organizationId, actor: approval.actor, mcp: { approvalId: approval._id, scope } };
  },
});

export const listApprovedOrganizations = internalQuery({
  args: { approvalId: v.id("mcpApprovals") },
  handler: async (ctx, { approvalId }) => {
    const approval = await ctx.db.get("mcpApprovals", approvalId);
    if (!approval || approval.revokedAt !== undefined) throw new ConvexError("Unauthorized");
    return await ctx.db.query("mcpApprovalOrganizations").withIndex("by_approvalId_and_organizationId", (q) => q.eq("approvalId", approvalId)).take(100);
  },
});
