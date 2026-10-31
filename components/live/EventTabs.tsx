"use client";

import { createContext, useState, type ReactNode } from "react";
import { ShortcutTooltip } from "@/components/shell/commands";
import { Skeleton } from "@/components/ui/skeleton";
import { ADMIN_VIEW_KEYS, adminViewPath, adminViewsFor, type AdminView } from "@/lib/admin-views";
import { InPageLink } from "@/components/InPageLink";

/** Where a tab's page puts its own actions, at the right of the tabs (Judging's sheet buttons). */
export const EventTabActionsContext = createContext<HTMLElement | null>(null);

export type EventTabCounts = { lineup: number; submissions: number; scores: { complete: number; target: number } | null };

/**
 * The event's tabs under the page header: Overview, Presentations, Judging,
 * Submissions, Settings. Each is a `?view=` link, so G then a key, reloads
 * and shared links all land on the same tab.
 */
export function EventTabs({ slug, eventType, active, counts, children }: { slug: string; eventType: "demo" | "hackathon"; active: AdminView; counts: EventTabCounts | null; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const count = (view: AdminView) => {
    if (!counts) return view === "home" || view === "settings" ? null : <Skeleton className="h-2.5 w-5" />;
    if (view === "queue") return counts.lineup;
    if (view === "submissions") return counts.submissions;
    if (view === "judging" && counts.scores && counts.scores.target > 0) return `${counts.scores.complete} of ${counts.scores.target}`;
    return null;
  };
  return <EventTabActionsContext value={slot}>
    <nav className="dq-event-tabs" aria-label="Event">
      <div className="dq-pill-tabs">
        {adminViewsFor(eventType).map((item) => {
          const value = count(item.view);
          return <ShortcutTooltip key={item.view} label={item.label} keys={["G", ADMIN_VIEW_KEYS[item.view]]} side="bottom">
            <InPageLink href={adminViewPath(slug, item.view)} className="dq-pill-tab" aria-current={item.view === active ? "page" : undefined}>
              {item.label}{value !== null && <span className="dq-count">{value}</span>}
            </InPageLink>
          </ShortcutTooltip>;
        })}
      </div>
      <span ref={setSlot} className="dq-event-tab-actions" />
    </nav>
    {children}
  </EventTabActionsContext>;
}
