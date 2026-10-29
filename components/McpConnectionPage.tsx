import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { EventsAuthProvider } from "@/app/events/AuthProvider";
import { workspaceReturnPath } from "@/lib/workspace-routes";
import { McpConnectionClient } from "./McpConnectionClient";
import styles from "./McpConnectionPage.module.css";

export async function McpConnectionPage({ requestId, settings = false }: { requestId?: string; settings?: boolean }) {
  const auth = await withAuth();
  const { accessToken, ...initialAuth } = auth;
  const path = settings ? "/events/connections" : requestId ? `/events/connect?request=${encodeURIComponent(requestId)}` : "/events/connect";
  if (!auth.user || !accessToken) redirect(`/events/sign-in?returnTo=${encodeURIComponent(workspaceReturnPath(path))}`);
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/events">Demo Queue</Link><span>{auth.user.email}</span></header>
    <EventsAuthProvider initialAuth={initialAuth}>
      <McpConnectionClient requestId={requestId} settings={settings} />
    </EventsAuthProvider>
  </main>;
}
