"use client";

import { ReactNode, useCallback, useState, type ComponentProps } from "react";
import { AuthKitProvider, useAccessToken, useAuth } from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { env } from "../env";

function useWorkOSAuth() {
  const { user, loading } = useAuth();
  const { getAccessToken, refresh, error } = useAccessToken();
  const fetchAccessToken = useCallback(async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    if (!user) return null;
    try {
      return (await (forceRefreshToken ? refresh() : getAccessToken())) ?? null;
    } catch {
      return null;
    }
  }, [user, getAccessToken, refresh]);
  // A failed refresh must make a real auth transition. When AuthKit retries and
  // clears its error, Convex reattaches auth instead of remaining in noAuth.
  // Healthy background refreshes keep this flag and the callback unchanged.
  return { isLoading: loading, isAuthenticated: Boolean(user) && !error, fetchAccessToken };
}

let browserClient: ConvexReactClient | undefined;
function workspaceClient() {
  // Browser ownership lasts for this document. Full org switches reset it.
  // Never share authenticated client instances across server requests.
  if (typeof window === "undefined") return new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL);
  return browserClient ??= new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL);
}

function AuthenticatedConvex({ children }: { children: ReactNode }) {
  const [client] = useState(workspaceClient);
  return <ConvexProviderWithAuth client={client} useAuth={useWorkOSAuth}>{children}</ConvexProviderWithAuth>;
}

export function EventsAuthProvider({ children, initialAuth }: { children: ReactNode; initialAuth: ComponentProps<typeof AuthKitProvider>["initialAuth"] }) {
  return <AuthKitProvider initialAuth={initialAuth}><AuthenticatedConvex>{children}</AuthenticatedConvex></AuthKitProvider>;
}
