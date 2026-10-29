"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { WorkspaceData } from "@/lib/workspace-data";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { EventCreationForm } from "@/components/EventCreationForm";
import { OrganizationStyles } from "@/components/OrganizationStyles";
import { ChevronRight, Presentation, Code2, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GettingStarted } from "@/components/GettingStarted";
import { Button } from "@/components/ui/button";
import { OrganiserShell, PageHeader } from "@/components/shell/OrganiserShell";
import { ShortcutTooltip, useCommands, type Command } from "@/components/shell/commands";
import { WorkspaceOrganizationContext } from "@/components/WorkspaceOrganizationContext";
import { eventCreatedDate } from "@/lib/event-date";
import { eventDetailsPath, isEventDetailsPath, isEventAdminPath } from "@/lib/workspace-routes";
import { selectOrganization } from "./actions";

type Organization = { id: string; name: string };
type View = "events" | "create" | "styles" | "members" | "details" | "admin" | "connections" | "guide";
type EventsList = ReturnType<typeof useOrganizationEventList>;

function viewFor(pathname: string): View {
  if (pathname === "/styles") return "styles";
  if (pathname === "/members") return "members";
  if (pathname === "/events/new") return "create";
  if (pathname === "/events/connections") return "connections";
  if (pathname === "/events/getting-started") return "guide";
  if (isEventDetailsPath(pathname)) return "details";
  if (isEventAdminPath(pathname)) return "admin";
  return "events";
}

const VIEW_TITLES: Record<View, string> = { events: "Events", create: "New event", styles: "Styles", members: "Members", details: "Event", admin: "Event", connections: "Connections", guide: "Getting started" };

/** The org's events, newest first. The first page comes from the server render. */
function useOrganizationEventList(initialData: WorkspaceData | null) {
  const { isAuthenticated } = useConvexAuth();
  const live = usePaginatedQuery(api.events.listOrganizationEvents, isAuthenticated && initialData ? {} : "skip", { initialNumItems: 20 });
  const results = live.status === "LoadingFirstPage" ? initialData?.events.page ?? [] : live.results;
  const status = live.status === "LoadingFirstPage" ? (initialData?.events.isDone ? "Exhausted" : "CanLoadMore") : live.status;
  return { results, status, firstPageLoading: live.status === "LoadingFirstPage", loadMore: live.loadMore };
}

export function EventsWorkspace({ organizations, activeOrganizationId, email, displayName, initialData, children }: {
  organizations: Organization[]; activeOrganizationId?: string; email: string; displayName: string; initialData: WorkspaceData | null; children: ReactNode;
}) {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const signInFailed = searchParams.has("error");
  const router = useRouter();
  const view = viewFor(pathname);
  const eventView = view === "details" || view === "admin";
  // These views render their server page instead of the events list.
  const pageView = eventView || view === "members" || view === "connections";
  // Connections belong to the person, not an organization, so they open without one.
  const personalView = view === "connections";
  const setView = (next: View) => router.push(next === "styles" ? "/styles" : next === "create" ? "/events/new" : "/events");
  const { isAuthenticated, isLoading } = useConvexAuth();
  const unavailable = switching || (!isLoading && !isAuthenticated);
  const active = organizations.find((org) => org.id === activeOrganizationId);
  const events = useOrganizationEventList(active ? initialData : null);
  // Proposed: one live event per org, so the newest event is the current one until events have phases.
  const newest = events.results[0];
  const currentEvent = !active || !initialData ? null : newest ? { name: newest.name, slug: newest.slug, eventType: newest.eventType } : null;
  const eventSlug = eventView ? decodeURIComponent(pathname.split("/")[2] ?? "") : undefined;
  const eventName = eventSlug ? events.results.find((event) => event.slug === eventSlug)?.name ?? eventSlug : undefined;

  const switchOrganization = useCallback(async (id: string) => {
    if (id === activeOrganizationId || switching) return;
    setSwitching(true); setError("");
    try {
      const result = await selectOrganization(id);
      if (result.error) { setError(result.error); setSwitching(false); return; }
      // Full navigation also clears the SDK's shared access-token store.
      window.location.assign(eventView ? "/events" : pathname);
    } catch { setError("Could not switch organizations. Please try again."); setSwitching(false); }
  }, [activeOrganizationId, switching, eventView, pathname]);

  const crumbs = eventView && eventSlug
    ? [{ label: "Events", href: "/events" }, { label: eventName ?? "Event", href: eventDetailsPath(eventSlug) }, { label: view === "details" ? "Summary" : adminCrumb(searchParams.get("view")) }]
    : view === "create" ? [{ label: "Events", href: "/events" }, { label: "New event" }]
    : [{ label: VIEW_TITLES[view] }];

  return <OrganiserShell organizations={organizations} activeOrganizationId={activeOrganizationId} email={email} displayName={displayName} switching={switching} onSelectOrganization={switchOrganization} currentEvent={currentEvent}>
    {(switching || !active || (!isLoading && !isAuthenticated)) && <title>{`${VIEW_TITLES[view]} | Demo Queue`}</title>}
    <PageHeader crumbs={crumbs} actions={view === "events" && active && events.results.length > 0 ? <ShortcutTooltip label="New event" keys={["C"]}><Button size="sm" render={<Link href="/events/new" />} nativeButton={false}><Plus aria-hidden />New event</Button></ShortcutTooltip> : undefined} />
    <div className={view === "admin" ? "dq-page-wide" : "dq-page"}>
      {signInFailed && <Alert variant="destructive" className="mb-4"><AlertDescription>Sign-in could not be completed. Your previous session is still active. <a href="/events/sign-in">Try signing in again</a>.</AlertDescription></Alert>}
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error} <a href="/events">Reload memberships</a></AlertDescription></Alert>}
      {switching ? <p role="status" className="dq-secondary">Switching organization…</p>
        : personalView && (!active || !initialData) ? (!isLoading && !isAuthenticated ? <Alert variant="destructive"><AlertDescription>Your session could not be verified. <a href="/events/connections">Retry connection</a> or <a href="/events/sign-in">sign in again</a>.</AlertDescription></Alert> : children)
        : !organizations.length ? <section className="workspace-heading"><h1>You need an invitation</h1><p>Ask an organizer to invite {email} to their organization, then <a href="/events">reload this page</a>.</p></section>
        : !isLoading && !isAuthenticated ? <Alert variant="destructive"><AlertDescription>Your event session could not be verified. <a href="/events">Retry connection</a> or <a href="/events/sign-in">sign in again</a>.</AlertDescription></Alert>
        : !active || !initialData ? <section className="workspace-heading"><h1>Choose your workspace</h1><p>You already have access to these organizations. Choose one to manage its events.</p><div className="workspace-choices">{organizations.map((org) => <Button variant="outline" key={org.id} onClick={() => void switchOrganization(org.id)}>{org.name}</Button>)}</div></section> : null}
      {active && initialData && <div hidden={unavailable} inert={unavailable}><OrganizationEvents key={active.id} organization={active} view={view} setView={setView} initialData={initialData} events={events} showTitle={!unavailable && !pageView} />{pageView && !unavailable && <WorkspaceOrganizationContext value={active.id}>{children}</WorkspaceOrganizationContext>}</div>}
    </div>
  </OrganiserShell>;
}

function adminCrumb(view: string | null) {
  return view === "submissions" ? "Submissions" : view === "judging" ? "Judging" : view === "settings" ? "Settings" : "Queue";
}

function OrganizationEvents({ organization, view, setView, initialData, events, showTitle }: { organization: Organization; view: View; setView: (view: View) => void; initialData: WorkspaceData; events: EventsList; showTitle: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const styleData = useQuery(api.organizationStyles.list, isAuthenticated ? {} : "skip") ?? initialData.styles;
  const { results, status, loadMore, firstPageLoading } = events;
  const pageName = view === "styles" ? "Styles" : view === "guide" ? "Getting started" : view === "create" || (results.length === 0) ? "Create event" : "Events";
  const title = showTitle ? <title>{`${pageName} · ${organization.name} | Demo Queue`}</title> : null;
  const [selected, setSelected] = useState(0);
  const listCommands = useMemo<Command[]>(() => view !== "events" || !results.length ? [] : [
    { id: "events-next", group: "This page", label: "Next event", keys: ["J"], run: () => setSelected((index) => Math.min(index + 1, results.length - 1)) },
    { id: "events-previous", group: "This page", label: "Previous event", keys: ["K"], run: () => setSelected((index) => Math.max(index - 1, 0)) },
    { id: "events-open", group: "This page", label: "Open selected event", keys: ["O"], run: () => { const event = results[selected]; if (event) router.push(eventDetailsPath(event.slug)); } },
  ], [view, results, selected, router]);
  useCommands("events-list", listCommands, view === "events" ? "Events" : undefined);
  if (styleData.organizationId !== organization.id || results.some((event) => event.organizationId !== organization.id)) return <Alert variant="destructive"><AlertDescription>Your organization session changed. <a href="/events">Reload events</a>.</AlertDescription></Alert>;
  const guide = <GettingStarted organizationName={organization.name} events={results.map((event) => ({ name: event.name, slug: event.slug }))} styleCount={styleData.styles.length} onCreateEvent={() => setView("create")} onOpenStyles={() => setView("styles")} />;
  return <>
    {title}
    {view === "guide" && guide}
    {view === "events" && <div className="mb-6">{guide}</div>}
    <div hidden={view !== "styles"}><OrganizationStyles organizationId={organization.id} organizationName={organization.name} styles={styleData.styles} /></div>
    <div hidden={view === "styles" || view === "members" || view === "details" || view === "admin" || view === "connections" || view === "guide" || (view !== "create" && results.length > 0)}><EventCreationForm organizationId={organization.id} organizationName={organization.name} firstEvent={!results.length} styles={styleData.styles} onManageStyles={() => setView("styles")} onCancel={results.length ? () => setView("events") : undefined} /></div>
    {view === "events" && results.length > 0 && <section>
      <div className="workspace-list-heading"><div className="workspace-heading"><h1>Events</h1><p>Your events in {organization.name}, newest first.</p></div></div>
      <ul className="workspace-event-list dq-card" aria-label="Events">{results.map((event, index) => <li key={event.id}><Link className="workspace-event-row dq-row" data-selected={index === selected ? "" : undefined} onMouseEnter={() => setSelected(index)} href={eventDetailsPath(event.slug)}><span className="workspace-event-icon" aria-hidden>{event.eventType === "hackathon" ? <Code2 /> : <Presentation />}</span><span className="workspace-event-summary"><span className="workspace-event-name">{event.name}</span>{index === 0 && <span className="workspace-event-current"><span className="dq-dot" data-tone="accent" aria-hidden />Current event</span>}</span><span className="workspace-event-kind">{event.eventType === "hackathon" ? "Hackathon" : "Demo"}</span><span className="workspace-event-date">Created {eventCreatedDate(event.createdAt)}</span><ChevronRight className="workspace-event-chevron" aria-hidden /></Link></li>)}</ul>
      {status === "CanLoadMore" && <Button variant="outline" size="sm" disabled={firstPageLoading} onClick={() => loadMore(20)}>Load more events</Button>}{status === "LoadingMore" && <p role="status" className="dq-secondary">Loading more events…</p>}
    </section>}
  </>;
}
