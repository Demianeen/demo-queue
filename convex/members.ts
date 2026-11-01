import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { components } from "./_generated/api";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { requireOrganization } from "./organizationAuth";
import { requireApproval } from "./mcpConnectionPolicy";
import { organiser, track } from "./analytics";
import {
  INVITATION_EXPIRES_IN_DAYS, INVITE_PROBLEM_MESSAGES, MAX_INVITES_PER_REQUEST,
  checkInviteEmails, displayName, normalizeEmail, openInvitations, type InvitationRecord,
} from "../lib/members";

// Invitations an organization can send: 20 at once, then about one every 3 minutes.
// The Members page and the MCP tools share this bucket.
export const INVITATION_LIMIT = { kind: "token bucket", rate: 20, period: HOUR, capacity: 20 } as const;
export const memberRateLimiter = new RateLimiter(components.rateLimiter, { invitationsPerOrganization: INVITATION_LIMIT });

export const RATE_LIMITED_MESSAGE = "Too many invitations sent recently. Try again later.";
export const MEMBER_MESSAGES = [
  RATE_LIMITED_MESSAGE,
  `Invite up to ${MAX_INVITES_PER_REQUEST} people at a time.`,
  "Invitation not found.",
  "This invitation can no longer be revoked.",
];

async function reserve(ctx: MutationCtx, organizationId: string, count: number) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_INVITES_PER_REQUEST) throw new ConvexError(`Invite up to ${MAX_INVITES_PER_REQUEST} people at a time.`);
  const status = await memberRateLimiter.limit(ctx, "invitationsPerOrganization", { key: organizationId, count });
  if (!status.ok) {
    console.log(JSON.stringify({ event: "member-invite", status: "limited", count }));
    throw new ConvexError(RATE_LIMITED_MESSAGE);
  }
}

/**
 * Called by the Members page's server action with the signed-in user's token,
 * so the organization comes from that token, never from the browser.
 */
export const reserveInvitations = mutation({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    const principal = await requireOrganization(ctx);
    await reserve(ctx, principal.organizationId, count);
    await track(ctx, "members_invited", organiser(principal), { count });
    return null;
  },
});

export const reserveInvitationsForMcp = internalMutation({
  args: { approvalId: v.id("mcpApprovals"), organizationId: v.string(), count: v.number() },
  handler: async (ctx, { approvalId, organizationId, count }) => {
    await requireApproval(ctx, approvalId, organizationId, "events:manage");
    await reserve(ctx, organizationId, count);
    const approval = await ctx.db.get(approvalId);
    if (approval) await track(ctx, "members_invited", { kind: "organiser", userId: approval.workosUserId, organizationId, surface: "mcp" }, { count });
    return null;
  },
});

// WorkOS REST calls for the MCP tools. The Members page uses the WorkOS SDK
// through AuthKit; Convex calls the same endpoints directly, like the
// membership check in mcpConnectionPolicy.
const WORKOS_API = "https://api.workos.com";
const listMetadata = z.object({ after: z.string().min(1).max(4096).nullable() });
const membershipSchema = z.object({ id: z.string(), user_id: z.string(), organization_id: z.string(), status: z.string(), created_at: z.string() });
const userSchema = z.object({ id: z.string(), email: z.string(), first_name: z.string().nullable().optional(), last_name: z.string().nullable().optional() });
const invitationSchema = z.object({
  id: z.string(), email: z.string(), state: z.enum(["pending", "accepted", "expired", "revoked"]),
  expires_at: z.string(), created_at: z.string(), organization_id: z.string().nullable(), inviter_user_id: z.string().nullable(),
});

async function workos(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}) {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) throw new ConvexError("Membership verification is unavailable.");
  let response: Response;
  try {
    response = await fetch(`${WORKOS_API}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${apiKey}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(10000), redirect: "error",
    });
  } catch { throw new ConvexError("Membership verification is unavailable."); }
  return response;
}

async function listAll<T>(path: string, params: Record<string, string>, item: z.ZodType<T>) {
  const rows: T[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const search = new URLSearchParams({ ...params, limit: "100", ...(after ? { after } : {}) });
    const response = await workos(`${path}?${search}`);
    if (!response.ok) throw new ConvexError("Membership verification is unavailable.");
    const body = z.object({ data: z.array(item).max(100), list_metadata: listMetadata }).safeParse(await response.json());
    if (!body.success) throw new ConvexError("Membership verification is unavailable.");
    rows.push(...body.data.data);
    after = body.data.list_metadata.after;
    if (!after) return rows;
  }
  throw new ConvexError("Membership verification is unavailable.");
}

function toInvitation(row: z.infer<typeof invitationSchema>): InvitationRecord {
  return { id: row.id, email: row.email, state: row.state, expiresAt: row.expires_at, createdAt: row.created_at, inviterUserId: row.inviter_user_id };
}

export async function listOrganizationMembers(organizationId: string) {
  const [memberships, users] = await Promise.all([
    listAll("/user_management/organization_memberships", { organization_id: organizationId, statuses: "active" }, membershipSchema),
    listAll("/user_management/users", { organization_id: organizationId }, userSchema),
  ]);
  const byId = new Map(users.map((user) => [user.id, user]));
  return memberships.filter((membership) => membership.organization_id === organizationId && membership.status === "active").map((membership) => {
    const user = byId.get(membership.user_id);
    const email = user?.email ?? "";
    return { userId: membership.user_id, name: user ? displayName({ firstName: user.first_name, lastName: user.last_name, email }) : membership.user_id, email, joinedAt: membership.created_at };
  });
}

/** Counts for the Getting started guide: active members, invitations ever sent, and accepted ones. */
export async function organizationTeamCounts(organizationId: string) {
  const [memberships, invitations] = await Promise.all([
    listAll("/user_management/organization_memberships", { organization_id: organizationId, statuses: "active" }, membershipSchema),
    listAll("/user_management/invitations", { organization_id: organizationId }, invitationSchema),
  ]);
  const own = invitations.filter((row) => row.organization_id === organizationId);
  return {
    members: memberships.filter((row) => row.organization_id === organizationId && row.status === "active").length,
    invited: own.length,
    accepted: own.filter((row) => row.state === "accepted").length,
  };
}

export async function listOrganizationInvitations(organizationId: string, memberEmails: string[], now: number) {
  const rows = await listAll("/user_management/invitations", { organization_id: organizationId }, invitationSchema);
  return openInvitations(rows.filter((row) => row.organization_id === organizationId).map(toInvitation), memberEmails, now)
    .map(({ id, email, expiresAt, createdAt, expired }) => ({ id, email, status: expired ? "expired" as const : "pending" as const, expiresAt, invitedAt: createdAt }));
}

/** Checks and sends invitations; returns one result per email, in order. */
export async function sendOrganizationInvitations(organizationId: string, inviterUserId: string, emails: string[], reserveSends: (count: number) => Promise<void>) {
  if (emails.length < 1 || emails.length > MAX_INVITES_PER_REQUEST) throw new ConvexError(`Invite up to ${MAX_INVITES_PER_REQUEST} people at a time.`);
  const members = await listOrganizationMembers(organizationId);
  const memberEmails = members.map((member) => member.email);
  const invitations = await listOrganizationInvitations(organizationId, memberEmails, Date.now());
  const checked = checkInviteEmails(emails, { memberEmails, invitedEmails: invitations.filter((invitation) => invitation.status === "pending").map((invitation) => invitation.email) });
  const sendable = checked.filter((entry) => !entry.problem);
  if (sendable.length) await reserveSends(sendable.length);
  const results: { email: string; status: "sent" | "skipped" | "failed"; message?: string }[] = [];
  for (const entry of checked) {
    if (entry.problem) { results.push({ email: entry.email, status: "skipped", message: INVITE_PROBLEM_MESSAGES[entry.problem](entry.email) }); continue; }
    const response = await workos("/user_management/invitations", { method: "POST", body: { email: entry.email, organization_id: organizationId, inviter_user_id: inviterUserId, expires_in_days: INVITATION_EXPIRES_IN_DAYS } });
    console.log(JSON.stringify({ event: "member-invite", status: response.ok ? "sent" : "failed", reason: response.ok ? undefined : response.status }));
    results.push(response.ok ? { email: entry.email, status: "sent" } : { email: entry.email, status: "failed", message: `Could not invite ${entry.email}.` });
  }
  return results;
}

export async function revokeOrganizationInvitation(organizationId: string, invitationId: string) {
  if (!/^invitation_[A-Za-z0-9]+$/.test(invitationId)) throw new ConvexError("Invitation not found.");
  const found = await workos(`/user_management/invitations/${invitationId}`);
  if (found.status === 404) throw new ConvexError("Invitation not found.");
  if (!found.ok) throw new ConvexError("Membership verification is unavailable.");
  const invitation = invitationSchema.safeParse(await found.json());
  if (!invitation.success || invitation.data.organization_id !== organizationId) throw new ConvexError("Invitation not found.");
  if (invitation.data.state !== "pending") throw new ConvexError("This invitation can no longer be revoked.");
  const revoked = await workos(`/user_management/invitations/${invitationId}/revoke`, { method: "POST" });
  console.log(JSON.stringify({ event: "member-invite-revoke", status: revoked.ok ? "revoked" : "failed", reason: revoked.ok ? undefined : revoked.status }));
  if (!revoked.ok) throw new ConvexError("This invitation can no longer be revoked.");
  return { id: invitationId, email: normalizeEmail(invitation.data.email), status: "revoked" as const };
}

/** One WorkOS user's email, for practice events' test people. */
export async function workosUserEmail(userId: string) {
  if (!/^user_[A-Za-z0-9]+$/.test(userId)) throw new ConvexError("Sign in to make a practice event.");
  const response = await workos(`/user_management/users/${userId}`);
  if (!response.ok) throw new ConvexError("Your email is unavailable right now. Try again in a moment.");
  const user = userSchema.safeParse(await response.json());
  if (!user.success || user.data.id !== userId) throw new ConvexError("Your email is unavailable right now. Try again in a moment.");
  return normalizeEmail(user.data.email);
}
