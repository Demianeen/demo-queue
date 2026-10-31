"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { WorkspaceData } from "@/lib/workspace-data";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { EventCreationForm } from "@/components/EventCreationForm";
import { OrganizationStyles } from "@/components/OrganizationStyles";
import { InvitePeopleAction } from "@/components/OrganizationMembers";
import { ChevronRight, Presentation, Code2, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GettingStarted } from "@/components/GettingStarted";
import { Button } from "@/components/ui/button";
import { OrganiserShell, PageHeader } from "@/components/shell/OrganiserShell";
import { ShortcutTooltip, useCommands, type Command } from "@/components/shell/commands";
import { WorkspaceOrganizationContext } from "@/components/WorkspaceOrganizationContext";
import { eventCreatedDate } from "@/lib/event-date";
import { eventDetailsPath, isEventDetailsPath, isEventAdminPath } from "@/lib/workspace-routes";
import { adminViewsFor, parseAdminView } from "@/lib/admin-views";
import { adminPath } from "@/lib/routes";
import { RoomPanel } from "@/components/live/RoomPanel";
import liveStyles from "@/components/live/live.module.css";
import { EventHeaderActions } from "@/components/live/EventHeaderActions";
import { PracticeBar } from "@/components/live/PracticeTools";
import { EventTabs } from "@/components/live/EventTabs";
import { AiUsageHeaderActions } from "@/components/usage/AiUsage";
import { selectOrganization } from "./actions";

type Organization = { id: string; name: string };
type View = "events" | "create" | "styles" | "members" | "details" | "admin" | "connections" | "guide" | "practice" | "usage";
type EventsList = ReturnType<typeof useOrganizationEventList>;

function viewFor(pathname: string): View {
  if (pathname === "/styles") return "styles";
  if (pathname === "/members") return "members";
  if (pathname === "/ai-usage") return "usage";
  if (pathname === "/events/new") return "create";
  if (pathname === "/events/connections") return "connections";
  if (pathname === "/events/practice") return "practice";
  if (pathname === "/events/getting-started") return "guide";
  if (isEventDetailsPath(pathname)) return "details";
  if (isEventAdminPath(pathname)) return "admin";
  return "events";
}

const VIEW_TITLES: Record<View, string> = { practice: "Practice", events: "Events", create: "New event", styles: "Styles", members: "Members", details: "Event", admin: "Event", connections: "Connections", guide: "Getting started", usage: "AI usage" };

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
  const pageView = eventView || view === "members" || view === "connections" || view === "practice" || view === "usage";
  // Connections belong to the person, not an organization, so they open without one.
  const personalView = view === "connections";
  const setView = (next: View) => router.push(next === "styles" ? "/styles" : next === "create" ? "/events/new" : "/events");
  const { isAuthenticated, isLoading } = useConvexAuth();
  const unavailable = switching || (!isLoading && !isAuthenticated);
  const active = organizations.find((org) => org.id === activeOrganizationId);
  const events = useOrganizationEventList(active ? initialData : null);
  // One live event per org: the newest real event that is not finished. Never a practice event.
  const live = useQuery(api.events.getLiveEvent, active && initialData && isAuthenticated ? {} : "skip");
  const liveEvent = !active || !initialData ? null : live === undefined ? undefined : live && { name: live.name, slug: live.slug, eventType: live.eventType, phase: live.phase };
  const eventSlug = eventView ? decodeURIComponent(pathname.split("/")[2] ?? "") : undefined;
  // Null rather than an error for an event outside the org, so the page's own error state shows.
  const openDetails = useQuery(api.events.getOrganizationEventDetails, view === "admin" && eventSlug && active && isAuthenticated ? { slug: eventSlug } : "skip");
  const openEvent = openDetails ? { name: openDetails.name, slug: openDetails.slug, eventType: openDetails.eventType, practice: openDetails.practice !== null, phase: openDetails.phase } : null;
  const eventName = eventSlug ? openEvent?.name ?? events.results.find((event) => event.slug === eventSlug)?.name ?? eventSlug : undefined;

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

  const adminView = openEvent ? parseAdminView(searchParams.get("view"), openEvent.eventType, openEvent.phase) : null;
  const adminLabel = openEvent && adminViewsFor(openEvent.eventType).find((item) => item.view === adminView)?.label;
  // The Room panel stays open as you move between an event's tabs, and closes when you leave the event.
  const [roomFor, setRoomFor] = useState<string | null>(null);
  const roomOpen = view === "admin" && !!eventSlug && roomFor === eventSlug;
  const toggleRoom = useCallback(() => setRoomFor((current) => current === eventSlug ? null : eventSlug ?? null), [eventSlug]);
  const closeRoom = useCallback(() => setRoomFor(null), []);
  const crumbs = view === "admin" && eventSlug
    ? [...(openEvent?.practice ? [{ label: "Practice", href: "/events/practice" }] : []), { label: eventName ?? "Event", href: adminPath(eventSlug) }, ...(adminLabel ? [{ label: adminLabel }] : [])]
    : view === "details" && eventSlug
    ? [{ label: "Events", href: "/events" }, { label: eventName ?? "Event", href: eventDetailsPath(eventSlug) }, { label: "Summary" }]
    : view === "create" ? [{ label: "Events", href: "/events" }, { label: "New event" }]
    : [{ label: VIEW_TITLES[view] }];

  // An event's admin page gets its tabs under the header, with their counts.
  const withTabs = (body: ReactNode) => view === "admin" && openDetails && eventSlug && adminView
    ? <EventTabs slug={eventSlug} eventType={openDetails.eventType} phase={openDetails.phase} active={adminView} counts={{ lineup: openDetails.lineupCount, submissions: openDetails.submissionCount, scores: openDetails.scores }}>
      <div className={liveStyles.roomLayout}>{body}{roomOpen && <RoomPanel slug={eventSlug} onClose={closeRoom} />}</div>
    </EventTabs>
    : body;

  return <OrganiserShell organizations={organizations} activeOrganizationId={activeOrganizationId} email={email} displayName={displayName} switching={switching} onSelectOrganization={switchOrganization} liveEvent={liveEvent} openEvent={openEvent}>
    {(switching || !active || (!isLoading && !isAuthenticated)) && <title>{`${VIEW_TITLES[view]} | Demo Queue`}</title>}
    {openEvent?.practice && eventSlug && <div className="px-4 pt-3"><PracticeBar slug={eventSlug} /></div>}
    <PageHeader crumbs={crumbs} actions={view === "events" && active && events.results.length > 0 ? <ShortcutTooltip label="New event" keys={["C"]}><Button size="sm" render={<Link href="/events/new" />} nativeButton={false}><Plus aria-hidden />New event</Button></ShortcutTooltip>
      : view === "admin" && openEvent && eventSlug ? <EventHeaderActions slug={eventSlug} eventName={openEvent.name} eventType={openEvent.eventType} phase={openEvent.phase} roomOpen={roomOpen} onToggleRoom={toggleRoom} />
      : view === "members" && active && initialData ? <InvitePeopleAction />
      : view === "usage" && active && initialData ? <AiUsageHeaderActions /> : undefined} />
    {withTabs(<div className={view === "admin" ? "dq-page-wide" : "dq-page"}>
      {signInFailed && <Alert variant="destructive" className="mb-4"><AlertDescription>Sign-in could not be completed. Your previous session is still active. <a href="/events/sign-in">Try signing in again</a>.</AlertDescription></Alert>}
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error} <a href="/events">Reload memberships</a></AlertDescription></Alert>}
      {switching ? <p role="status" className="dq-secondary">Switching organization…</p>
        : personalView && (!active || !initialData) ? (!isLoading && !isAuthenticated ? <Alert variant="destructive"><AlertDescription>Your session could not be verified. <a href="/events/connections">Retry connection</a> or <a href="/events/sign-in">sign in again</a>.</AlertDescription></Alert> : children)
        : !organizations.length ? <section className="workspace-heading"><h1>You need an invitation</h1><p>Ask an organizer to invite {email} to their organization, then <a href="/events">reload this page</a>.</p></section>
        : !isLoading && !isAuthenticated ? <Alert variant="destructive"><AlertDescription>Your event session could not be verified. <a href="/events">Retry connection</a> or <a href="/events/sign-in">sign in again</a>.</AlertDescription></Alert>
        : !active || !initialData ? <section className="workspace-heading"><h1>Choose your workspace</h1><p>You already have access to these organizations. Choose one to manage its events.</p><div className="workspace-choices">{organizations.map((org) => <Button variant="outline" key={org.id} onClick={() => void switchOrganization(org.id)}>{org.name}</Button>)}</div></section> : null}
      {active && initialData && <div hidden={unavailable} inert={unavailable}><OrganizationEvents key={active.id} organization={active} view={view} setView={setView} initialData={initialData} events={events} showTitle={!unavailable && !pageView} />{pageView && !unavailable && <WorkspaceOrganizationContext value={active.id}>{children}</WorkspaceOrganizationContext>}</div>}
    </div>)}
  </OrganiserShell>;
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
  const guideProps = { organizationName: organization.name, events: results.map((event) => ({ name: event.name, slug: event.slug })), styleCount: styleData.styles.length, onCreateEvent: () => setView("create"), onOpenStyles: () => setView("styles") };
  return <>
    {title}
    {view === "guide" && <div className="ws-column"><h1 className="sr-only">Getting started</h1><GettingStarted {...guideProps} alwaysOpen /></div>}
    {view === "events" && <div className="mb-6"><GettingStarted {...guideProps} /></div>}
    <div hidden={view !== "styles"}><OrganizationStyles organizationId={organization.id} organizationName={organization.name} styles={styleData.styles} /></div>
    <div hidden={view === "styles" || view === "members" || view === "details" || view === "admin" || view === "connections" || view === "guide" || view === "practice" || view === "usage" || (view !== "create" && results.length > 0)}><EventCreationForm organizationId={organization.id} organizationName={organization.name} firstEvent={!results.length} styles={styleData.styles} onManageStyles={() => setView("styles")} onCancel={results.length ? () => setView("events") : undefined} /></div>
    {view === "events" && results.length > 0 && <section>
      <div className="workspace-list-heading"><div className="workspace-heading"><h1>Events</h1><p>Your events in {organization.name}, newest first.</p></div></div>
      <ul className="workspace-event-list dq-card" aria-label="Events">{results.map((event, index) => <li key={event.id}><Link className="workspace-event-row dq-row" data-selected={index === selected ? "" : undefined} onMouseEnter={() => setSelected(index)} href={eventDetailsPath(event.slug)}><span className="workspace-event-icon" aria-hidden>{event.eventType === "hackathon" ? <Code2 /> : <Presentation />}</span><span className="workspace-event-summary"><span className="workspace-event-name">{event.name}</span>{index === 0 && <span className="workspace-event-current"><span className="dq-dot" data-tone="accent" aria-hidden />Current event</span>}</span><span className="workspace-event-kind">{event.eventType === "hackathon" ? "Hackathon" : "Demo"}</span><span className="workspace-event-date">Created {eventCreatedDate(event.createdAt)}</span><ChevronRight className="workspace-event-chevron" aria-hidden /></Link></li>)}</ul>
      {status === "CanLoadMore" && <Button variant="outline" size="sm" disabled={firstPageLoading} onClick={() => loadMore(20)}>Load more events</Button>}{status === "LoadingMore" && <p role="status" className="dq-secondary">Loading more events…</p>}
    </section>}
  </>;
}
