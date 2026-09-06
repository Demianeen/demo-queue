"use client";

import Link from "next/link";
import { useContext } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, ArrowUpRight, ClipboardList, Monitor, Shield, Trophy } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EventAccessLink } from "@/components/EventAccessLink";
import { WorkspaceOrganizationContext } from "@/components/WorkspaceOrganizationContext";
import { buttonVariants } from "@/components/ui/button";
import { adminPath, stagePath, submissionPath } from "@/lib/routes";
import { eventCreatedDate } from "@/lib/event-date";
import { DEFAULT_EVENT_THEME } from "@/lib/event-theme";
import { VISUAL_STYLE_LABELS } from "@/lib/visual-style";

type Details = FunctionReturnType<typeof api.events.getOrganizationEventDetails>;
const judgingLabels = { setup: "Not started", preparing_assignments: "Preparing", ready: "Ready to open", open: "Open", closed: "Closed" };

export function WorkspaceEventDetails({ slug, organizationId, initial }: { slug: string; organizationId: string; initial: Details }) {
  const { isAuthenticated } = useConvexAuth();
  const workspaceOrganizationId = useContext(WorkspaceOrganizationContext);
  const live = useQuery(api.events.getOrganizationEventDetails, isAuthenticated && workspaceOrganizationId === organizationId ? { slug } : "skip");
  // A null live result revokes access; only an unresolved query can use server data.
  const event = live === undefined ? initial : live;
  if (workspaceOrganizationId !== organizationId) return <section className="workspace-heading"><title>Workspace changed | Demo Queue</title><h1>Your workspace changed</h1><p>Reload to continue with your current organization.</p><a href="/events">Reload events</a></section>;
  if (!event || event.organizationId !== organizationId || event.slug !== slug) return <section className="workspace-heading"><title>Event unavailable | Demo Queue</title><h1>Event unavailable</h1><p>This event may have been removed or belong to another organization.</p><Link className="workspace-back-link" href="/events"><ArrowLeft aria-hidden />Back to events</Link></section>;
  const managePath = adminPath(event.slug, event.adminToken);
  const customTheme = event.theme && (Object.keys(DEFAULT_EVENT_THEME) as (keyof typeof DEFAULT_EVENT_THEME)[]).some((key) => event.theme?.[key] !== DEFAULT_EVENT_THEME[key]);
  return <section className="workspace-event-details">
    <title>{`${event.name} | Demo Queue`}</title>
    <Link className="workspace-back-link" href="/events"><ArrowLeft aria-hidden />All events</Link>
    <div className="workspace-detail-heading">
      <div><h1>{event.name}</h1><p><span className="workspace-event-kind">{event.eventType === "hackathon" ? "Hackathon" : "Demo"}</span><span>Created {eventCreatedDate(event.createdAt)}</span></p></div>
      <a href={managePath} className={buttonVariants()} data-slot="button">Manage event<ArrowUpRight aria-hidden /></a>
    </div>
    <div className="workspace-event-stats" aria-label="Event activity">
      <div><span>Submissions</span><strong>{event.submissionCount}{event.submissionCountCapped ? "+" : ""}</strong><small>{event.submissionsClosed ? "Submissions closed" : "Accepting submissions"}</small></div>
      <div><span>Presentation queue</span><strong>{event.queuePublished ? "Published" : "Not published"}</strong><small>{event.queuePublished ? "Visible on the presentation view" : "Publish from event controls"}</small></div>
      <div><span>{event.judgingStatus ? "Judging" : "Event style"}</span><strong>{event.judgingStatus ? judgingLabels[event.judgingStatus] : customTheme ? "Custom" : VISUAL_STYLE_LABELS[event.visualStyle]}</strong><small>{event.judgingStatus ? "Manage rounds in event controls" : "Used on public event pages"}</small></div>
    </div>
    <div className="workspace-detail-grid">
      <section className="workspace-detail-panel" aria-labelledby="event-links-title">
        <div className="workspace-panel-heading"><h2 id="event-links-title">Event links</h2><p>Everything you need to run and share your event.</p></div>
        <EventAccessLink name="Presentation" description="Open on the big screen or share with viewers." path={stagePath(event.slug)} icon={<Monitor />} />
        <EventAccessLink name="Submission form" description="Invite people to submit their demos." path={submissionPath(event.slug)} icon={<ClipboardList />} />
        <EventAccessLink name="Admin" description="Private. Anyone with this link can manage the event." path={managePath} icon={<Shield />} />
      </section>
      {event.eventType === "hackathon" ? <section className="workspace-detail-panel" aria-labelledby="event-results-title">
        <div className="workspace-panel-heading"><h2 id="event-results-title">Winners</h2><p>Confirmed final placements.</p></div>
        {event.resultsStatus === "confirmed" ? <ol className="workspace-winners">{event.winners.map((winner) => <li key={winner.place}><span className="workspace-winner-place">{winner.place}</span><div><h3>{winner.demoTitle}</h3><p>{winner.teamName}</p></div>{winner.place === 1 && <Trophy aria-label="First place" />}</li>)}</ol> : <div className="workspace-results-empty"><Trophy aria-hidden /><h3>{event.resultsStatus === "needs_review" ? "Results need review" : "Winners to come"}</h3><p>{event.resultsStatus === "needs_review" ? "Review and confirm the final placements in event controls." : "Winners appear here once judging closes and final placements are confirmed."}</p></div>}
      </section> : <section className="workspace-detail-panel" aria-labelledby="event-controls-title"><div className="workspace-panel-heading"><h2 id="event-controls-title">Run your event</h2><p>Keep the demos moving.</p></div><div className="workspace-event-guide"><p>Review submissions, arrange the queue, and control the live presentation from event controls.</p><a href={managePath} className="workspace-inline-link">Open event controls<ArrowUpRight aria-hidden /></a></div></section>}
    </div>
  </section>;
}
