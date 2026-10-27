import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { fetchQuery } from "convex/nextjs";
import { unstable_rethrow } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { getWorkspaceMemberships } from "@/lib/workos-memberships";
import { WorkspaceEventDetails } from "@/components/WorkspaceEventDetails";

export default async function EventDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const auth = await withAuth();
    if (!auth.user || !auth.organizationId) return <section className="workspace-heading"><h1>Sign in to view this event</h1><a href={`/events/sign-in?returnTo=${encodeURIComponent(`/events/${slug}/overview`)}`}>Sign in</a></section>;
    const organizations = await getWorkspaceMemberships(auth.user.id);
    if (!organizations.some((organization) => organization.id === auth.organizationId)) return <section className="workspace-heading"><h1>Organization access unavailable</h1><p>You need an invitation to access this organization.</p><a href="/events">Reload your workspaces</a></section>;
    const initial = await fetchQuery(api.events.getOrganizationEventDetails, { slug }, { token: auth.accessToken, url: process.env.NEXT_PUBLIC_CONVEX_URL });
    if (initial && initial.organizationId !== auth.organizationId) throw new Error("Event organization mismatch");
    return <WorkspaceEventDetails key={`${auth.organizationId}:${slug}`} slug={slug} organizationId={auth.organizationId} initial={initial} />;
  } catch (error) {
    unstable_rethrow(error);
    return <section className="workspace-heading"><title>Event unavailable | Demo Queue</title><h1>Could not load this event</h1><p>Please reload to try again, or return to your events.</p><Link href="/events">Back to events</Link></section>;
  }
}
