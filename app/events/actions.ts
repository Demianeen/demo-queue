"use server";

import { getWorkOS, signOut, switchToOrganization, withAuth } from "@workos-inc/authkit-nextjs";
import { unstable_rethrow } from "next/navigation";

export async function selectOrganization(organizationId: string) {
  try {
    const { user } = await withAuth();
    if (!user) return { error: "Your session expired. Sign in again." };
    const memberships = await getWorkOS().userManagement.listOrganizationMemberships({
      userId: user.id,
      organizationId,
      statuses: ["active"],
      limit: 1,
    });
    if (memberships.data.length === 0) return { error: "You no longer have access to that organization." };
    await switchToOrganization(organizationId, { revalidationStrategy: "none" });
    return { success: true };
  } catch (error) {
    unstable_rethrow(error);
    return { error: "Could not switch organizations. Please try again." };
  }
}

export async function logOut() {
  await signOut({ returnTo: new URL("/", process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI!).toString() });
}
