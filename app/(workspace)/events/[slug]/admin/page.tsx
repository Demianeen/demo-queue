import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { reportCaughtServerError } from "@/lib/posthog-server";
import ClientPage from "./ClientPage";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const auth = await withAuth();
    const event = auth.user && auth.organizationId
      ? await fetchQuery(api.events.getOrganizationEventDetails, { slug }, {
          token: auth.accessToken,
          url: process.env.NEXT_PUBLIC_CONVEX_URL,
        })
      : null;
    if (event && event.organizationId === auth.organizationId) return <ClientPage />;
  } catch (error) {
    unstable_rethrow(error);
    await reportCaughtServerError(error, "event-admin");
  }
  return <section className="workspace-heading">
    <title>Event unavailable | Demo Queue</title>
    <h1>Event unavailable in this organization</h1>
    <p>Switch to the event’s organization or return to your events.</p>
    <Link href="/events">Back to events</Link>
  </section>;
}
