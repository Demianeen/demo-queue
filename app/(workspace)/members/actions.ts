"use server";

import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { fetchMutation } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { checkInviteEmails, displayName, INVITE_PROBLEM_MESSAGES, MAX_INVITES_PER_REQUEST } from "@/lib/members";
import { loadMembersOverview, MembersAccessError, type InvitationRow, type MembersAccess, organizationInvitation, organizationMembership, requireOrganizationMember, sendInvitation } from "@/lib/workos-members";

export type InviteResult = { email: string; status: "sent" | "skipped" | "failed"; message?: string; invitation?: InvitationRow };

/** The row the page shows for an invitation this action just sent. */
function sentRow(invitation: { id: string; email: string; expiresAt: string; createdAt: string }, inviter: Parameters<typeof displayName>[0]): InvitationRow {
  // The same first-name rule the page uses for invitations loaded from WorkOS.
  return { id: invitation.id, email: invitation.email.toLowerCase(), expired: false, expiresAt: invitation.expiresAt, invitedAt: invitation.createdAt, invitedBy: displayName(inviter).split(" ")[0] };
}
export type ActionResult<T = undefined> = { ok: true; value?: T } | { ok: false; error: string; access?: MembersAccess };

function failure(error: unknown, fallback: string): { ok: false; error: string; access?: MembersAccess } {
  unstable_rethrow(error);
  if (error instanceof MembersAccessError) return { ok: false, error: error.message, access: error.access };
  if (error instanceof ConvexError && typeof error.data === "string") return { ok: false, error: error.data };
  console.error("members-action-failed", { reason: error instanceof Error ? error.name : "unknown" });
  return { ok: false, error: fallback };
}

/** Counts sends against the organization's invitation limit, in Convex. */
async function reserve(accessToken: string, count: number) {
  await fetchMutation(api.members.reserveInvitations, { count }, { token: accessToken, url: process.env.NEXT_PUBLIC_CONVEX_URL });
}

export async function inviteMembers(emails: string[]): Promise<ActionResult<InviteResult[]>> {
  try {
    if (!Array.isArray(emails) || emails.length < 1 || emails.length > MAX_INVITES_PER_REQUEST || emails.some((email) => typeof email !== "string" || email.length > 320)) {
      return { ok: false, error: `Invite up to ${MAX_INVITES_PER_REQUEST} people at a time.` };
    }
    const { user, organizationId, accessToken } = await requireOrganizationMember();
    // Check again on the server: the page's list may be out of date.
    const overview = await loadMembersOverview(organizationId, user.id);
    const checked = checkInviteEmails(emails, {
      memberEmails: overview.members.map((member) => member.email),
      invitedEmails: overview.invitations.filter((invitation) => !invitation.expired).map((invitation) => invitation.email),
    });
    const sendable = checked.filter((entry) => !entry.problem);
    if (sendable.length) await reserve(accessToken, sendable.length);
    const results: InviteResult[] = [];
    for (const entry of checked) {
      if (entry.problem) { results.push({ email: entry.email, status: "skipped", message: INVITE_PROBLEM_MESSAGES[entry.problem](entry.email) }); continue; }
      try {
        const invitation = await sendInvitation(organizationId, user.id, entry.email);
        results.push({ email: entry.email, status: "sent", invitation: sentRow(invitation, user) });
      } catch (error) {
        console.error("member-invite-failed", { reason: error instanceof Error ? error.name : "unknown" });
        results.push({ email: entry.email, status: "failed", message: `Could not invite ${entry.email}. Try again.` });
      }
    }
    revalidatePath("/members");
    return { ok: true, value: results };
  } catch (error) { return failure(error, "Could not send invitations. Try again."); }
}

/** Resends a pending invitation, or sends a new one when it expired (returned, to replace the old row). */
export async function resendInvitation(invitationId: string): Promise<ActionResult<InvitationRow>> {
  try {
    const { user, organizationId, accessToken } = await requireOrganizationMember();
    const invitation = await organizationInvitation(organizationId, invitationId);
    if (!invitation || (invitation.state !== "pending" && invitation.state !== "expired")) return { ok: false, error: "This invitation is no longer open. Reload the page." };
    await reserve(accessToken, 1);
    const expired = invitation.state === "expired" || Date.parse(invitation.expiresAt) <= Date.now();
    if (expired) {
      const replacement = await sendInvitation(organizationId, user.id, invitation.email);
      revalidatePath("/members");
      return { ok: true, value: sentRow(replacement, user) };
    }
    await getWorkOS().userManagement.resendInvitation(invitation.id);
    revalidatePath("/members");
    return { ok: true };
  } catch (error) { return failure(error, "Could not send the invitation again. Try again."); }
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  try {
    const { organizationId } = await requireOrganizationMember();
    const invitation = await organizationInvitation(organizationId, invitationId);
    if (!invitation) return { ok: false, error: "This invitation is no longer open. Reload the page." };
    if (invitation.state === "pending") await getWorkOS().userManagement.revokeInvitation(invitation.id);
    revalidatePath("/members");
    return { ok: true };
  } catch (error) { return failure(error, "Could not revoke the invitation. Try again."); }
}

export async function removeMember(membershipId: string): Promise<ActionResult> {
  try {
    const { user, organizationId } = await requireOrganizationMember();
    const membership = await organizationMembership(organizationId, membershipId);
    if (!membership) return { ok: false, error: "This person is no longer a member. Reload the page." };
    if (membership.userId === user.id) return { ok: false, error: "You cannot remove yourself." };
    await getWorkOS().userManagement.deleteOrganizationMembership(membership.id);
    console.log(JSON.stringify({ event: "member-removed", status: "ok" }));
    revalidatePath("/members");
    return { ok: true };
  } catch (error) { return failure(error, "Could not remove this member. Try again."); }
}

/**
 * First names of the organization's members by WorkOS user id, for "who did
 * this" in Recent changes and the practice list. Names only, no emails.
 */
export async function memberNames(): Promise<Record<string, string>> {
  try {
    const { user, organizationId } = await requireOrganizationMember();
    const overview = await loadMembersOverview(organizationId, user.id);
    return Object.fromEntries(overview.members.map((member) => [member.userId, member.name]));
  } catch (error) {
    unstable_rethrow(error);
    console.error("member-names-failed", { reason: error instanceof Error ? error.name : "unknown" });
    return {};
  }
}
