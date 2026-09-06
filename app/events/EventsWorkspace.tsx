"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { WorkspaceData } from "@/lib/workspace-data";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { EventCreationForm } from "@/components/EventCreationForm";
import { OrganizationStyles } from "@/components/OrganizationStyles";
import { ChevronRight, Presentation, Code2, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { WorkspaceAccountMenu } from "@/components/WorkspaceAccountMenu";
import { WorkspaceOrganizationContext } from "@/components/WorkspaceOrganizationContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { eventCreatedDate } from "@/lib/event-date";
import { eventDetailsPath, isEventDetailsPath } from "@/lib/workspace-routes";
import { selectOrganization } from "./actions";

type Organization = { id: string; name: string };
type View = "events" | "create" | "styles" | "details";

export function EventsWorkspace({ organizations, activeOrganizationId, email, displayName, initialData, children }: {
  organizations: Organization[]; activeOrganizationId?: string; email: string; displayName: string; initialData: WorkspaceData | null; children: ReactNode;
}) {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const signInFailed = searchParams.has("error");
  const router = useRouter();
  const view: View = pathname === "/styles" ? "styles" : pathname === "/events/new" ? "create" : isEventDetailsPath(pathname) ? "details" : "events";
  const setView = (next: View) => router.push(next === "styles" ? "/styles" : next === "create" ? "/events/new" : "/events");
  const { isAuthenticated, isLoading } = useConvexAuth();
  const unavailable = switching || (!isLoading && !isAuthenticated);
  const active = organizations.find((org) => org.id === activeOrganizationId);

  async function switchOrganization(id: string) {
    if (id === activeOrganizationId || switching) return;
    setSwitching(true); setError("");
    try {
      const result = await selectOrganization(id);
      if (result.error) { setError(result.error); setSwitching(false); return; }
      // Full navigation also clears the SDK's shared access-token store.
      window.location.assign(view === "details" ? "/events" : pathname);
    } catch { setError("Could not switch organizations. Please try again."); setSwitching(false); }
  }

  return <div className="workspace">
    {(switching || !active || (!isLoading && !isAuthenticated)) && <title>{`${view === "styles" ? "Styles" : "Events"} | Demo Queue`}</title>}
    <header className="workspace-header">
      <Link className="workspace-brand" href="/events">Demo Queue</Link>
      <div className="workspace-organization">
        <Select items={organizations.map((org) => ({ value: org.id, label: org.name }))} value={activeOrganizationId ?? null} disabled={switching || !organizations.length} onValueChange={(value) => { if (value) void switchOrganization(value); }}>
          <SelectTrigger className="!border-0" aria-label="Organization"><SelectValue placeholder="Choose workspace" /></SelectTrigger>
          <SelectContent className="workspace-popup">{organizations.map((org) => <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <nav className="workspace-nav" aria-label="Workspace"><Link href="/events" data-slot="button" className={buttonVariants({ variant: "ghost" })} aria-current={view !== "styles" ? "page" : undefined}>Events</Link><Link href="/styles" data-slot="button" className={buttonVariants({ variant: "ghost" })} aria-current={view === "styles" ? "page" : undefined}>Styles</Link></nav>
      <WorkspaceAccountMenu email={email} displayName={displayName} organizations={organizations} activeOrganizationId={activeOrganizationId} switching={switching} onSelectOrganization={switchOrganization} />
    </header>
    <main className="workspace-content">
      {signInFailed && <Alert variant="destructive"><AlertDescription>Sign-in could not be completed. Your previous session is still active. <a href="/events/sign-in">Try signing in again</a>.</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error} <a href="/events">Reload memberships</a></AlertDescription></Alert>}
      {switching ? <p role="status">Switching organization…</p>
        : !organizations.length ? <section className="workspace-heading"><h1>You need an invitation</h1><p>Ask an organizer to invite {email} to their organization, then <a href="/events">reload this page</a>.</p></section>
        : !isLoading && !isAuthenticated ? <Alert variant="destructive"><AlertDescription>Your event session could not be verified. <a href="/events">Retry connection</a> or <a href="/events/sign-in">sign in again</a>.</AlertDescription></Alert>
        : !active || !initialData ? <section className="workspace-heading"><h1>Choose your workspace</h1><p>You already have access to these organizations. Choose one to manage its events.</p><div className="workspace-choices">{organizations.map((org) => <Button variant="outline" key={org.id} onClick={() => void switchOrganization(org.id)}>{org.name}</Button>)}</div></section> : null}
      {active && initialData && <div hidden={unavailable} inert={unavailable}><OrganizationEvents key={active.id} organization={active} view={view} setView={setView} initialData={initialData} showTitle={!unavailable && view !== "details"} />{view === "details" && !unavailable && <WorkspaceOrganizationContext value={active.id}>{children}</WorkspaceOrganizationContext>}</div>}
    </main>
  </div>;
}

function OrganizationEvents({ organization, view, setView, initialData, showTitle }: { organization: Organization; view: View; setView: (view: View) => void; initialData: WorkspaceData; showTitle: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const live = usePaginatedQuery(api.events.listOrganizationEvents, isAuthenticated ? {} : "skip", { initialNumItems: 20 });
  const styleData = useQuery(api.organizationStyles.list, isAuthenticated ? {} : "skip") ?? initialData.styles;
  const results = live.status === "LoadingFirstPage" ? initialData.events.page : live.results;
  const status = live.status === "LoadingFirstPage" ? (initialData.events.isDone ? "Exhausted" : "CanLoadMore") : live.status;
  const loadMore = live.loadMore;
  const pageName = view === "styles" ? "Styles" : view === "create" || (results.length === 0) ? "Create event" : "Events";
  const title = showTitle ? <title>{`${pageName} · ${organization.name} | Demo Queue`}</title> : null;
  if (styleData.organizationId !== organization.id || results.some((event) => event.organizationId !== organization.id)) return <Alert variant="destructive"><AlertDescription>Your organization session changed. <a href="/events">Reload events</a>.</AlertDescription></Alert>;
  return <>
    {title}
    <div hidden={view !== "styles"}><OrganizationStyles organizationId={organization.id} organizationName={organization.name} styles={styleData.styles} /></div>
    <div hidden={view === "styles" || view === "details" || (view !== "create" && results.length > 0)}><EventCreationForm organizationId={organization.id} organizationName={organization.name} firstEvent={!results.length} styles={styleData.styles} onManageStyles={() => setView("styles")} onCancel={results.length ? () => setView("events") : undefined} /></div>
    {view === "events" && results.length > 0 && <section>
      <div className="workspace-list-heading"><div className="workspace-heading"><h1>Events</h1><p>Your events in {organization.name}.</p></div><Button onClick={() => setView("create")}><Plus aria-hidden />Create event</Button></div>
      <ul className="workspace-event-list" aria-label="Events">{results.map((event) => <li key={event.id}><Link className="workspace-event-row" href={eventDetailsPath(event.slug)}><span className="workspace-event-icon" aria-hidden>{event.eventType === "hackathon" ? <Code2 /> : <Presentation />}</span><span className="workspace-event-summary"><span className="workspace-event-name">{event.name}</span><span className="workspace-event-date">Created {eventCreatedDate(event.createdAt)}</span></span><span className="workspace-event-kind">{event.eventType === "hackathon" ? "Hackathon" : "Demo"}</span><ChevronRight className="workspace-event-chevron" aria-hidden /></Link></li>)}</ul>
      {status === "CanLoadMore" && <Button variant="outline" disabled={live.status === "LoadingFirstPage"} onClick={() => loadMore(20)}>Load more events</Button>}{status === "LoadingMore" && <p role="status">Loading more events…</p>}
    </section>}
  </>;
}
