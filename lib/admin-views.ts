// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { adminPath } from "./routes.ts";

/** The sections of an event's admin page, each at `?view=` so links and reloads keep it. */
export type AdminView = "queue" | "submissions" | "judging" | "settings";

export const ADMIN_VIEWS: AdminView[] = ["queue", "submissions", "judging", "settings"];

export function parseAdminView(value: string | null | undefined, eventType: "demo" | "hackathon" | undefined): AdminView {
  const view = ADMIN_VIEWS.find((item) => item === value) ?? "queue";
  // Judging exists only for hackathons; a demo event falls back to the queue.
  return view === "judging" && eventType === "demo" ? "queue" : view;
}

export function adminViewsFor(eventType: "demo" | "hackathon") {
  const views: { view: AdminView; label: string }[] = [
    { view: "queue", label: eventType === "hackathon" ? "Presentations" : "Queue" },
    { view: "submissions", label: eventType === "hackathon" ? "Submissions" : "People" },
  ];
  if (eventType === "hackathon") views.push({ view: "judging", label: "Judging" });
  views.push({ view: "settings", label: "Settings" });
  return views;
}

export function adminViewPath(slug: string, view: AdminView) {
  return view === "queue" ? adminPath(slug) : `${adminPath(slug)}?view=${view}`;
}
