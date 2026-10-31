// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { adminPath } from "./routes.ts";
import type { EventPhase } from "./event-phase.ts";

type EventType = "demo" | "hackathon";

/**
 * The tabs of an event's admin page, one per phase plus Settings, each at
 * `?view=` so links and reloads keep it. Every tab opens in any phase; the
 * event's own address, with no `?view=`, opens the live phase's tab.
 */
export type AdminView = "submissions" | "judging" | "stage" | "queue" | "results" | "settings";

/** A hackathon's tabs in phase order; a demo night has no judging, and its stage is the Queue. */
const VIEWS: Record<EventType, AdminView[]> = {
  hackathon: ["submissions", "judging", "stage", "results", "settings"],
  demo: ["submissions", "queue", "results", "settings"],
};

const LABELS: Record<AdminView, string> = {
  submissions: "Submissions", judging: "Judging", stage: "Stage", queue: "Queue", results: "Results", settings: "Settings",
};

export function adminViewsFor(eventType: EventType) {
  return VIEWS[eventType].map((view) => ({ view, label: LABELS[view] }));
}

/** The tab for the phase the event is in: where opening the event lands, and the tab with the dot. */
export function liveView(eventType: EventType, phase: EventPhase | undefined): AdminView {
  if (phase === "judging" && eventType === "hackathon") return "judging";
  if (phase === "stage") return eventType === "hackathon" ? "stage" : "queue";
  if (phase === "finished") return "results";
  return "submissions";
}

/** The phase's name as its tab says it: a demo night's stage is its Queue, and Finished shows as Results. */
export function phaseTabLabel(eventType: EventType, phase: EventPhase) {
  return LABELS[liveView(eventType, phase)];
}

/**
 * Old `?view=` values and what they open now. "home" was the Overview, which
 * the phase tabs replaced: it opens the live tab, like the bare address.
 * Presentations and Queue were one view; the Judges page is part of Judging.
 */
const MOVED: Record<string, Partial<Record<EventType, AdminView>>> = {
  queue: { hackathon: "stage" },
  stage: { demo: "queue" },
  judges: { hackathon: "judging" },
};

/**
 * What `?view=` should say for this event: a tab it has, or null to open the
 * live tab. A link from before the phase tabs, or one for the other event
 * type, never breaks.
 */
export function canonicalViewParam(value: string | null | undefined, eventType: EventType): AdminView | null {
  if (!value) return null;
  const moved = MOVED[value]?.[eventType];
  if (moved) return moved;
  return VIEWS[eventType].find((view) => view === value) ?? null;
}

/** The tab to show: the one in the address, or the live phase's. */
export function parseAdminView(value: string | null | undefined, eventType: EventType, phase: EventPhase | undefined): AdminView {
  return canonicalViewParam(value, eventType) ?? liveView(eventType, phase);
}

/** The "G then …" key for each tab. G D, the old Judges page, opens Judging; G O opens the live tab. */
export const ADMIN_VIEW_KEYS: Record<AdminView, string> = { submissions: "U", judging: "J", stage: "A", queue: "Q", results: "R", settings: "T" };
export const JUDGES_KEY = "D";
export const LIVE_KEY = "O";

/** A tab's address. The event's own address (`adminPath`) opens the live tab. */
export function adminViewPath(slug: string, view: AdminView) {
  return `${adminPath(slug)}?view=${view}`;
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
