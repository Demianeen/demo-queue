"use client";

import { createContext, Fragment, useState, type ReactNode } from "react";
import { ShortcutTooltip } from "@/components/shell/commands";
import { Skeleton } from "@/components/ui/skeleton";
import { ADMIN_VIEW_KEYS, adminViewPath, adminViewsFor, liveView, type AdminView } from "@/lib/admin-views";
import type { EventPhase } from "@/lib/event-phase";
import { InPageLink } from "@/components/InPageLink";

/** Where a tab's page puts its own actions, at the right of the tabs (Judging's sheet buttons). */
export const EventTabActionsContext = createContext<HTMLElement | null>(null);

export type EventTabCounts = { lineup: number; submissions: number; scores: { complete: number; target: number } | null };

/**
 * The event's tabs under the page header, one per phase in order, then
 * Settings: Submissions, Judging, Stage, Results on a hackathon; Submissions,
 * Queue, Results on a demo night. The live phase's tab has a dot. Each is a
 * `?view=` link, so G then a key, reloads and shared links all land on it.
 */
export function EventTabs({ slug, eventType, phase, active, counts, children }: { slug: string; eventType: "demo" | "hackathon"; phase: EventPhase; active: AdminView; counts: EventTabCounts | null; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const live = liveView(eventType, phase);
  const count = (view: AdminView) => {
    if (view !== "queue" && view !== "stage" && view !== "submissions" && view !== "judging") return null;
    if (!counts) return <Skeleton className="h-2.5 w-5" />;
    if (view === "queue" || view === "stage") return counts.lineup;
    if (view === "submissions") return counts.submissions;
    if (view === "judging" && counts.scores && counts.scores.target > 0) return `${counts.scores.complete} of ${counts.scores.target}`;
    return null;
  };
  return <EventTabActionsContext value={slot}>
    <nav className="dq-event-tabs" aria-label="Event">
      <div className="dq-pill-tabs">
        {adminViewsFor(eventType).map((item) => {
          const value = count(item.view);
          const isLive = item.view === live;
          return <Fragment key={item.view}>
            {item.view === "settings" && <span className="dq-tab-divider" aria-hidden />}
            <ShortcutTooltip label={isLive ? `${item.label}, the live phase` : item.label} keys={["G", ADMIN_VIEW_KEYS[item.view]]} side="bottom">
              <InPageLink href={adminViewPath(slug, item.view)} className="dq-pill-tab" aria-current={item.view === active ? "page" : undefined}>
                {isLive && <span className="dq-dot" data-tone="success" role="img" aria-label="live phase" />}{item.label}{value !== null && <span className="dq-count">{value}</span>}
              </InPageLink>
            </ShortcutTooltip>
          </Fragment>;
        })}
      </div>
      <span ref={setSlot} className="dq-event-tab-actions" />
    </nav>
    {children}
  </EventTabActionsContext>;
}
