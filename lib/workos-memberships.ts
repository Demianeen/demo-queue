import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { freshMemberships, membershipEnvironmentKey } from "./membership-freshness";

async function fetchMemberships(userId: string) {
  const startedAt = Date.now();
  const response = await getWorkOS().userManagement.listOrganizationMemberships({ userId, statuses: ["active"], limit: 100 });
  const memberships = await response.autoPagination();
  if (process.env.NODE_ENV === "development") console.info("workspace-memberships", { source: "workos", durationMs: Date.now() - startedAt });
  return {
    fetchedAt: startedAt,
    value: memberships.map(({ organizationId, organizationName }) => ({ id: organizationId, name: organizationName })),
  };
}

const cachedMemberships = unstable_cache(
  async (_environment: string, userId: string) => fetchMemberships(userId),
  ["active-workspace-memberships-v1"],
  { revalidate: 60 },
);

// Call only with the ID from withAuth, never from user-supplied route arguments.
export const getWorkspaceMemberships = cache(async (userId: string) => {
  return freshMemberships(
    () => cachedMemberships(membershipEnvironmentKey(process.env), userId),
    () => fetchMemberships(userId),
  );
});
