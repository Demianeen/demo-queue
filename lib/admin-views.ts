// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { adminPath } from "./routes.ts";

/**
 * The tabs of an event's admin page, each at `?view=` so links and reloads
 * keep it. "home" is the Overview, the default.
 */
export type AdminView = "home" | "queue" | "submissions" | "judging" | "settings";

export const ADMIN_VIEWS: AdminView[] = ["home", "queue", "submissions", "judging", "settings"];

/** Views that exist only for hackathons; a demo night falls back to its home. */
const HACKATHON_ONLY = new Set<AdminView>(["judging"]);

/** Old `?view=` values that moved: the Judges page is part of Judging now. */
const MOVED_VIEWS: Record<string, AdminView> = { judges: "judging" };

export function parseAdminView(value: string | null | undefined, eventType: "demo" | "hackathon" | undefined): AdminView {
  const view = ADMIN_VIEWS.find((item) => item === value) ?? (value ? MOVED_VIEWS[value] : undefined) ?? "home";
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
  views.push({ view: "settings", label: "Settings" });
  return views;
}

/** The "G then …" key for each view. G D, the old Judges page, opens Judging. */
export const ADMIN_VIEW_KEYS: Record<AdminView, string> = { home: "O", queue: "Q", submissions: "U", judging: "J", settings: "T" };
export const JUDGES_KEY = "D";

export function adminViewPath(slug: string, view: AdminView) {
  return view === "home" ? adminPath(slug) : `${adminPath(slug)}?view=${view}`;
}

/** Judging's own views, at `&judging=`: who still needs scores, the live ranking, and the decision. */
export type JudgingView = "progress" | "ranking" | "finalists";

export const JUDGING_VIEWS: { view: JudgingView; label: string }[] = [
  { view: "progress", label: "Progress" },
  { view: "ranking", label: "Ranking" },
  { view: "finalists", label: "Finalists" },
];

export function parseJudgingView(value: string | null | undefined): JudgingView {
  return JUDGING_VIEWS.find((item) => item.view === value)?.view ?? "progress";
}

/** A Judging link, keeping only the state that is set: `?view=judging&judging=ranking&project=…`. */
export function judgingPath(slug: string, state: { judging?: JudgingView; project?: string | null; track?: string | null; group?: string | null; judge?: string | null } = {}) {
  const params = new URLSearchParams({ view: "judging" });
  if (state.judging && state.judging !== "progress") params.set("judging", state.judging);
  for (const key of ["project", "track", "group", "judge"] as const) {
    const value = state[key];
    if (value) params.set(key, value);
  }
  return `${adminPath(slug)}?${params}`;
}
