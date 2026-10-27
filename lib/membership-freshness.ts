export const MEMBERSHIP_MAX_AGE_MS = 60_000;

export type MembershipSnapshot<T> = { fetchedAt: number; value: T };

// Next may return stale data while revalidating. Never expose that stale result.
export async function freshMemberships<T>(
  cached: () => Promise<MembershipSnapshot<T>>,
  fresh: () => Promise<MembershipSnapshot<T>>,
  now: () => number = Date.now,
): Promise<T> {
  const snapshot = await cached();
  const age = now() - snapshot.fetchedAt;
  if (age >= 0 && age < MEMBERSHIP_MAX_AGE_MS) return snapshot.value;
  const refreshed = await fresh();
  const refreshedAge = now() - refreshed.fetchedAt;
  if (refreshedAge < 0 || refreshedAge >= MEMBERSHIP_MAX_AGE_MS) {
    throw new Error("Membership refresh expired before it completed. Please retry.");
  }
  return refreshed.value;
}

export function membershipEnvironmentKey(env: Record<string, string | undefined>) {
  return JSON.stringify([
    env.WORKOS_CLIENT_ID,
    env.WORKOS_API_HOSTNAME ?? "api.workos.com",
    env.WORKOS_API_HTTPS ?? "true",
    env.WORKOS_API_PORT ?? "default",
  ]);
}
