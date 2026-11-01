import "server-only";
import { getWorkOS, withAuth } from "@workos-inc/authkit-nextjs";
import { displayName, INVITATION_EXPIRES_IN_DAYS, normalizeEmail, openInvitations, type InvitationRecord } from "./members";

export type MemberRow = { membershipId: string; userId: string; name: string; email: string; joinedAt: string; you: boolean };
export type InvitationRow = { id: string; email: string; expired: boolean; expiresAt: string; invitedAt: string; invitedBy: string | null };
export type MembersOverview = { organizationId: string; members: MemberRow[]; invitations: InvitationRow[] };

/** Why the caller cannot use the Members page: shown with the matching next step. */
export type MembersAccess = "session" | "organization" | "membership";
export class MembersAccessError extends Error {
  constructor(readonly access: MembersAccess, message: string) { super(message); }
}

/**
 * The signed-in user and the organization of their session. The organization
 * comes from the session, never from the browser, and the user must still be
 * an active member of it in WorkOS.
 */
export async function requireOrganizationMember() {
  const auth = await withAuth();
  if (!auth.user || !auth.accessToken) throw new MembersAccessError("session", "Sign in again to keep managing members. Nothing was changed.");
  const organizationId = auth.organizationId;
  if (!organizationId) throw new MembersAccessError("organization", "Choose an organization first.");
  const memberships = await getWorkOS().userManagement.listOrganizationMemberships({ userId: auth.user.id, organizationId, statuses: ["active"], limit: 1 });
  if (!memberships.data.some((membership) => membership.organizationId === organizationId)) throw new MembersAccessError("membership", "You are no longer a member of this organization.");
  return { user: auth.user, organizationId, accessToken: auth.accessToken };
}

export async function loadMembersOverview(organizationId: string, currentUserId: string): Promise<MembersOverview> {
  const workos = getWorkOS();
  const [memberships, users, invitations] = await Promise.all([
    workos.userManagement.listOrganizationMemberships({ organizationId, statuses: ["active"], limit: 100 }).then((list) => list.autoPagination()),
    workos.userManagement.listUsers({ organizationId, limit: 100 }).then((list) => list.autoPagination()),
    workos.userManagement.listInvitations({ organizationId, limit: 100 }).then((list) => list.autoPagination()),
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const members = memberships
    .filter((membership) => membership.organizationId === organizationId && membership.status === "active")
    .map((membership): MemberRow => {
      const user = usersById.get(membership.userId);
      const email = user ? normalizeEmail(user.email) : "";
      return { membershipId: membership.id, userId: membership.userId, name: user ? displayName(user) : "Unknown member", email, joinedAt: membership.createdAt, you: membership.userId === currentUserId };
    })
    .sort((a, b) => Number(b.you) - Number(a.you) || Date.parse(a.joinedAt) - Date.parse(b.joinedAt));
  const records: InvitationRecord[] = invitations
    .filter((invitation) => invitation.organizationId === organizationId)
    .map((invitation) => ({ id: invitation.id, email: invitation.email, state: invitation.state, expiresAt: invitation.expiresAt, createdAt: invitation.createdAt, inviterUserId: invitation.inviterUserId }));
  const memberNames = new Map(members.map((member) => [member.userId, member.name.split(" ")[0]]));
  return {
    organizationId,
    members,
    invitations: openInvitations(records, members.map((member) => member.email), Date.now()).map((invitation) => ({
      id: invitation.id, email: normalizeEmail(invitation.email), expired: invitation.expired, expiresAt: invitation.expiresAt, invitedAt: invitation.createdAt,
      invitedBy: invitation.inviterUserId ? memberNames.get(invitation.inviterUserId) ?? null : null,
    })),
  };
}

export async function sendInvitation(organizationId: string, inviterUserId: string, email: string) {
  return getWorkOS().userManagement.sendInvitation({ email, organizationId, inviterUserId, expiresInDays: INVITATION_EXPIRES_IN_DAYS });
}

/** The invitation, only when it belongs to this organization. */
export async function organizationInvitation(organizationId: string, invitationId: string) {
  if (!/^invitation_[A-Za-z0-9]+$/.test(invitationId)) return null;
  try {
    const invitation = await getWorkOS().userManagement.getInvitation(invitationId);
    return invitation.organizationId === organizationId ? invitation : null;
  } catch { return null; }
}

/** The membership, only when it belongs to this organization. */
export async function organizationMembership(organizationId: string, membershipId: string) {
  if (!/^om_[A-Za-z0-9]+$/.test(membershipId)) return null;
  try {
    const membership = await getWorkOS().userManagement.getOrganizationMembership(membershipId);
    return membership.organizationId === organizationId ? membership : null;
  } catch { return null; }
}
