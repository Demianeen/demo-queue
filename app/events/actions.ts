"use server";

import { getWorkOS, signOut, switchToOrganization, withAuth } from "@workos-inc/authkit-nextjs";
import { unstable_rethrow } from "next/navigation";
import { getWorkOSRedirectUri } from "@/lib/auth-config";

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
  const redirectUri = getWorkOSRedirectUri();
  if (!redirectUri) throw new Error("Authentication is not configured.");
  await signOut({ returnTo: new URL("/", redirectUri).toString() });
}
