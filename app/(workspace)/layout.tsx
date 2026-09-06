import Link from "next/link";
import { WorkspaceSignInLink, WorkspaceSignInNotice } from "@/components/WorkspaceSignInLink";
import { Suspense } from "react";
import { WorkspaceSkeleton } from "@/components/WorkspaceSkeleton";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { fetchQuery } from "convex/nextjs";
import { unstable_rethrow } from "next/navigation";
import { isAuthConfigured } from "@/lib/auth-config";
import { getWorkspaceMemberships } from "@/lib/workos-memberships";
import { api } from "@/convex/_generated/api";
import { EventsAuthProvider } from "@/app/events/AuthProvider";
import { EventsWorkspace } from "@/app/events/EventsWorkspace";
import { WorkspaceErrorBoundary } from "@/components/WorkspaceErrorBoundary";
import type { WorkspaceData } from "@/lib/workspace-data";

export const dynamic = "force-dynamic";
export const metadata = { title: null };

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<WorkspaceSkeleton />}><WorkspaceContent>{children}</WorkspaceContent></Suspense>;
}

async function WorkspaceContent({ children }: { children: React.ReactNode }) {
  if (!isAuthConfigured()) return <WorkspaceMessage title="Event login is not configured yet"><p>Event creation will be available once authentication setup is complete.</p><Link href="/saved">Back to saved event links</Link></WorkspaceMessage>;
  try {
    const startedAt = performance.now();
    const auth = await withAuth();
    const authMs = performance.now() - startedAt;
    if (!auth.user) return <WorkspaceMessage title="Sign in to manage events"><WorkspaceSignInNotice /><p>Use your invited Google account to see and create your organization’s events.</p><WorkspaceSignInLink className="button">Sign in with Google</WorkspaceSignInLink><Link href="/saved">Back to saved event links</Link></WorkspaceMessage>;
    const { accessToken, ...initialAuth } = auth;
    const dataStart = performance.now();
    const membershipsPromise = getWorkspaceMemberships(auth.user.id);
    const dataPromise: Promise<WorkspaceData | null> = auth.organizationId
      ? Promise.all([
          fetchQuery(api.events.listOrganizationEvents, { paginationOpts: { numItems: 20, cursor: null } }, { token: accessToken, url: process.env.NEXT_PUBLIC_CONVEX_URL }),
          fetchQuery(api.organizationStyles.list, {}, { token: accessToken, url: process.env.NEXT_PUBLIC_CONVEX_URL }),
        ]).then(([events, styles]) => ({ events, styles }))
      : Promise.resolve(null);
    const [organizations, data] = await Promise.all([membershipsPromise, dataPromise]);
    const active = organizations.find((org) => org.id === auth.organizationId);
    // Validate even empty event pages before crossing the server/client boundary.
    if (active && (!data || data.events.organizationId !== active.id || data.styles.organizationId !== active.id || data.events.page.some((event) => event.organizationId !== active.id))) throw new Error("Workspace organization mismatch");
    if (process.env.NODE_ENV === "development") console.info("workspace-load", { authMs: Math.round(authMs), dataMs: Math.round(performance.now() - dataStart), totalMs: Math.round(performance.now() - startedAt) });
    return <EventsAuthProvider key={`${auth.user.id}:${auth.sessionId}:${auth.organizationId}`} initialAuth={initialAuth}>
      <WorkspaceErrorBoundary><EventsWorkspace organizations={organizations} activeOrganizationId={active?.id} email={auth.user.email} displayName={[auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ")} initialData={active ? data : null}>{children}</EventsWorkspace></WorkspaceErrorBoundary>
    </EventsAuthProvider>;
  } catch (error) {
    unstable_rethrow(error);
    return <WorkspaceMessage title="Could not load your workspace"><p>We couldn’t verify your access or load your events and styles. Please try again.</p><a className="button" href="">Try again</a><WorkspaceSignInLink>Sign in again</WorkspaceSignInLink></WorkspaceMessage>;
  }
}

function WorkspaceMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="workspace workspace-sign-in"><section className="workspace-login-content"><title>{`${title} | Demo Queue`}</title><Link href="/events" className="workspace-brand">Demo Queue</Link><h1>{title}</h1>{children}</section></main>;
}
