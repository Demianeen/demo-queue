// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { adminPath } from "./routes.ts";

/**
 * The sections of an event's admin page, each at `?view=` so links and
 * reloads keep it. "home" is the live event home, the default.
 */
export type AdminView = "home" | "queue" | "submissions" | "judging" | "judges" | "settings";

export const ADMIN_VIEWS: AdminView[] = ["home", "queue", "submissions", "judging", "judges", "settings"];

/** Views that exist only for hackathons; a demo night falls back to its home. */
const HACKATHON_ONLY = new Set<AdminView>(["judging", "judges"]);

export function parseAdminView(value: string | null | undefined, eventType: "demo" | "hackathon" | undefined): AdminView {
  const view = ADMIN_VIEWS.find((item) => item === value) ?? "home";
  return HACKATHON_ONLY.has(view) && eventType === "demo" ? "home" : view;
}

export function adminViewsFor(eventType: "demo" | "hackathon") {
  const hackathon = eventType === "hackathon";
  const views: { view: AdminView; label: string }[] = [
    { view: "home", label: "Overview" },
    { view: "queue", label: hackathon ? "Presentations" : "Queue" },
  ];
  if (hackathon) views.push({ view: "judging", label: "Judging" });
  views.push({ view: "submissions", label: hackathon ? "Submissions" : "People" });
  if (hackathon) views.push({ view: "judges", label: "Judges" });
  views.push({ view: "settings", label: "Settings" });
  return views;
}

/** The "G then …" key for each view. */
export const ADMIN_VIEW_KEYS: Record<AdminView, string> = { home: "O", queue: "Q", submissions: "U", judging: "J", judges: "D", settings: "T" };

export function adminViewPath(slug: string, view: AdminView) {
  return view === "home" ? adminPath(slug) : `${adminPath(slug)}?view=${view}`;
}
