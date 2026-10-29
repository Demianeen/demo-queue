import { unstable_rethrow } from "next/navigation";
import { MembersLoadProblem, OrganizationMembers } from "@/components/OrganizationMembers";
import { getWorkspaceMemberships } from "@/lib/workos-memberships";
import { loadMembersOverview, MembersAccessError, requireOrganizationMember } from "@/lib/workos-members";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  try {
    const { user, organizationId } = await requireOrganizationMember();
    const [overview, organizations] = await Promise.all([loadMembersOverview(organizationId, user.id), getWorkspaceMemberships(user.id)]);
    const name = organizations.find((organization) => organization.id === organizationId)?.name ?? "this organization";
    return <OrganizationMembers key={organizationId} organizationName={name} overview={overview} now={Date.now()} />;
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof MembersAccessError) return <MembersLoadProblem access={error.access} message={error.message} />;
    console.error("members-load-failed", { reason: error instanceof Error ? error.name : "unknown" });
    return <MembersLoadProblem />;
  }
}
