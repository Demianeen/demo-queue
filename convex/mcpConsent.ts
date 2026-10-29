import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { normalizeUserCode } from "@convex-dev/mcp";
import { components, internal } from "./_generated/api";
import { action, query, mutation, internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { accessValidator, componentSiteUrl, connectionIdentity, currentMemberships, selectedOrganizations, scopesForAccess, normalizeScopes, MCP_SCOPES } from "./mcpConnectionPolicy";

function randomSecret(prefix: string) {
  return prefix + Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function hashSecret(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
const ownerFields = { ownerAccountKey: v.string(), workosUserId: v.string(), actor: v.string() };
const selectionFields = { organizationIds: v.array(v.string()), allOrganizations: v.optional(v.literal(true)), access: accessValidator };

export const getRequest = query({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    connectionIdentity(await ctx.auth.getUserIdentity());
    const request = await ctx.runQuery(components.mcp.oauth.getAuthRequest, args);
    if (!request) return null;
    const common = {
      clientName: request.clientName ?? "Unnamed client", status: request.status,
      scopes: normalizeScopes(request.scopes).map((name) => ({ name, description: MCP_SCOPES[name] })),
    };
    if (request.kind === "redirect") return { ...common, kind: "redirect" as const, redirectUri: request.redirectUri };
    return { ...common, kind: "device" as const };
  },
});

export const findRequest = mutation({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }): Promise<string | null> => {
    const owner = connectionIdentity(await ctx.auth.getUserIdentity());
    const normalized = normalizeUserCode(userCode);
    if (!normalized) return null;
    const found = await ctx.runMutation(components.mcp.oauth.findByUserCode, { userCode: normalized, limitKey: owner.ownerAccountKey });
    if (!found.ok) throw new ConvexError("Too many attempts. Try again in a few minutes.");
    return found.requestId;
  },
});

export const memberships = action({
  args: {},
  handler: async (ctx): Promise<{ id: string; name: string }[]> => currentMemberships(connectionIdentity(await ctx.auth.getUserIdentity()).workosUserId),
});

async function insertApproval(ctx: MutationCtx, args: { ownerAccountKey: string; workosUserId: string; actor: string; organizationIds: string[]; allOrganizations?: true; access: "read" | "manage"; source: "oauth" | "device" | "apiKey"; name: string; requestedScopes: string[]; requestId?: string }) {
  if (args.allOrganizations && args.organizationIds.length !== 0) throw new ConvexError("Choose either all organizations or specific organizations.");
  const requestedScopes = normalizeScopes(args.requestedScopes);
  const approvedScopes = scopesForAccess(args.access).filter((scope) => requestedScopes.includes(scope));
  if (approvedScopes.length === 0) throw new ConvexError("The request has no supported permissions.");
  const { organizationIds, ...approval } = args;
  const id = await ctx.db.insert("mcpApprovals", { ...approval, access: approvedScopes.includes("events:manage") ? "manage" : "read", approvedScopes });
  for (const organizationId of organizationIds) await ctx.db.insert("mcpApprovalOrganizations", { approvalId: id, organizationId });
  return { id, approvedScopes };
}

export const decide = internalMutation({
  args: { ...ownerFields, ...selectionFields, requestId: v.string(), approve: v.boolean(), codeHash: v.optional(v.string()), userCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(components.mcp.oauth.getAuthRequest, { requestId: args.requestId });
    if (!request || request.status !== "pending") throw new ConvexError("This request has expired. Start again from your agent.");
    let principalId: string = args.ownerAccountKey;
    if (args.approve) {
      const approval = await insertApproval(ctx, { ownerAccountKey: args.ownerAccountKey, workosUserId: args.workosUserId, actor: args.actor, organizationIds: args.organizationIds, allOrganizations: args.allOrganizations, access: args.access,
        source: request.kind === "device" ? "device" : "oauth", name: request.clientName ?? "Unnamed client", requestedScopes: request.scopes, requestId: args.requestId });
      principalId = approval.id;
    }
    const decided = await ctx.runMutation(components.mcp.oauth.decideAuthRequest, {
      requestId: args.requestId, userId: principalId, approved: args.approve, codeHash: args.codeHash, codeTtlMs: 60000,
      confirmedUserCode: args.userCode === undefined ? undefined : normalizeUserCode(args.userCode) ?? undefined,
    });
    if (!decided) throw new ConvexError("This request has expired. Start again from your agent.");
    if (decided.kind === "device" && !decided.confirmed) throw new ConvexError("Confirm the code your agent is showing before approving.");
    return decided;
  },
});

export const authorize = action({
  args: { requestId: v.string(), approve: v.boolean(), ...selectionFields, userCode: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ redirectUrl: string | null }> => {
    const owner = connectionIdentity(await ctx.auth.getUserIdentity());
    const organizationIds = args.approve ? selectedOrganizations(args.organizationIds, await currentMemberships(owner.workosUserId), args.allOrganizations) : [];
    const code = args.approve ? randomSecret("mcp_code_") : undefined;
    const decided = await ctx.runMutation(internal.mcpConsent.decide, { ...args, ...owner, organizationIds, codeHash: code ? await hashSecret(code) : undefined });
    if (decided.kind === "device") return { redirectUrl: null };
    const url = new URL(decided.redirectUri);
    if (code) url.searchParams.set("code", code);
    else { url.searchParams.set("error", "access_denied"); url.searchParams.set("error_description", "The user denied access"); }
    if (decided.state !== undefined) url.searchParams.set("state", decided.state);
    url.searchParams.set("iss", componentSiteUrl());
    return { redirectUrl: url.href };
  },
});

export const insertApiKey = internalMutation({
  args: { ...ownerFields, ...selectionFields, name: v.string(), hash: v.string(), resource: v.string() },
  handler: async (ctx, args): Promise<Id<"mcpApprovals">> => {
    const { id, approvedScopes } = await insertApproval(ctx, { ownerAccountKey: args.ownerAccountKey, workosUserId: args.workosUserId, actor: args.actor, organizationIds: args.organizationIds, allOrganizations: args.allOrganizations, access: args.access, source: "apiKey", name: args.name, requestedScopes: scopesForAccess(args.access) });
    await ctx.runMutation(components.mcp.grants.createApiKey, { userId: id, name: args.name, scopes: approvedScopes, resource: args.resource, hash: args.hash });
    return id;
  },
});

export const createApiKey = action({
  args: { name: v.string(), ...selectionFields },
  handler: async (ctx, args): Promise<{ id: string; apiKey: string; url: string }> => {
    const owner = connectionIdentity(await ctx.auth.getUserIdentity());
    const organizationIds = selectedOrganizations(args.organizationIds, await currentMemberships(owner.workosUserId), args.allOrganizations);
    const apiKey = randomSecret("mcp_key_");
    const url = componentSiteUrl() + "/mcp";
    const id = await ctx.runMutation(internal.mcpConsent.insertApiKey, { ...owner, organizationIds, allOrganizations: args.allOrganizations, access: args.access, name: args.name.trim().slice(0, 100) || "API key", hash: await hashSecret(apiKey), resource: url });
    return { id, apiKey, url };
  },
});

export const listConnections = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const owner = connectionIdentity(await ctx.auth.getUserIdentity());
    const approvals = await ctx.db.query("mcpApprovals").withIndex("by_ownerAccountKey", (q) => q.eq("ownerAccountKey", owner.ownerAccountKey)).order("desc").paginate(paginationOpts);
    const connections = [];
    for (const approval of approvals.page) {
      if (approval.revokedAt !== undefined) continue;
      const grants = await ctx.runQuery(components.mcp.grants.list, { userId: approval._id });
      if (grants.length === 0) continue;
      const organizations = await ctx.db.query("mcpApprovalOrganizations").withIndex("by_approvalId_and_organizationId", (q) => q.eq("approvalId", approval._id)).take(100);
      connections.push({ id: approval._id, name: approval.name, organizationIds: organizations.map((org) => org.organizationId), allOrganizations: approval.allOrganizations, access: approval.access, createdAt: approval._creationTime,
        lastUsedAt: grants.reduce<number | undefined>((latest, grant) => grant.lastUsedAt === undefined ? latest : Math.max(latest ?? 0, grant.lastUsedAt), undefined), kind: approval.source === "apiKey" ? "apiKey" : "oauth" });
    }
    return { ...approvals, page: connections };
  },
});

export const revokeConnection = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const owner = connectionIdentity(await ctx.auth.getUserIdentity());
    const approvalId = ctx.db.normalizeId("mcpApprovals", id);
    const approval = approvalId ? await ctx.db.get("mcpApprovals", approvalId) : null;
    if (!approval || approval.ownerAccountKey !== owner.ownerAccountKey) throw new ConvexError("Unauthorized");
    await ctx.db.patch("mcpApprovals", approval._id, { revokedAt: Date.now() });
    const grants = await ctx.runQuery(components.mcp.grants.list, { userId: approval._id });
    for (const grant of grants) await ctx.runMutation(components.mcp.grants.revoke, { userId: approval._id, grantId: grant._id });
    return true;
  },
});
