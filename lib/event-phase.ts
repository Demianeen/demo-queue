/**
 * The four phases an organiser moves an event between, in order. A demo night
 * has no judging phase. Any phase can be reached from any other, in either
 * direction; each step in between runs the behaviour that already exists for
 * it (closing submissions, closing or reopening judging).
 */
export const EVENT_PHASES = ["submissions", "judging", "stage", "finished"] as const;
export type EventPhase = (typeof EVENT_PHASES)[number];

type PhaseState = {
  eventType?: "demo" | "hackathon";
  phase?: EventPhase;
  submissionsClosedAt?: number;
  judgingStatus?: "setup" | "preparing_assignments" | "ready" | "open" | "closed";
  queuePublished?: boolean;
  finishedAt?: number;
};

export function phasesFor(eventType: "demo" | "hackathon" | undefined): EventPhase[] {
  return eventType === "hackathon" ? [...EVENT_PHASES] : ["submissions", "stage", "finished"];
}

/**
 * The event's phase. Events from before the phase was stored derive it from
 * the state they already have.
 */
export function eventPhase(event: PhaseState): EventPhase {
  const allowed = phasesFor(event.eventType);
  if (event.phase && allowed.includes(event.phase)) return event.phase;
  if (event.finishedAt !== undefined) return "finished";
  if (event.eventType === "hackathon") {
    if (event.submissionsClosedAt === undefined) return "submissions";
    return event.judgingStatus === "closed" ? "stage" : "judging";
  }
  return event.queuePublished ? "stage" : "submissions";
}

/** Each single step from one phase to another, in order. */
export function phaseSteps(eventType: "demo" | "hackathon" | undefined, from: EventPhase, to: EventPhase) {
  const order = phasesFor(eventType);
  const start = order.indexOf(from);
  const end = order.indexOf(to);
  if (start < 0 || end < 0) throw new Error("This event has no such phase.");
  const steps: { from: EventPhase; to: EventPhase }[] = [];
  const direction = end > start ? 1 : -1;
  for (let index = start; index !== end; index += direction) {
    steps.push({ from: order[index], to: order[index + direction] });
  }
  return steps;
}

export type PhaseEffect =
  | "submissions_close"
  | "submissions_reopen"
  | "ai_summaries_queue"
  | "judging_timer_pause"
  | "judging_timer_resume"
  | "scores_kept"
  | "new_projects_assigned"
  | "judging_close"
  | "judging_reopen"
  | "judging_skipped"
  | "finalists_lineup"
  | "queue_publish"
  | "lineup_stays_published"
  | "finish"
  | "unfinish";

export const PHASE_EFFECT_TEXT: Record<PhaseEffect, string> = {
  submissions_close: "The submit link closes.",
  submissions_reopen: "The submit link opens again.",
  ai_summaries_queue: "AI summaries are written for projects that need one.",
  judging_timer_pause: "The judging timer pauses.",
  judging_timer_resume: "The judging timer carries on from where it paused.",
  scores_kept: "Every score is kept, so you can come straight back.",
  new_projects_assigned: "New projects get two judges each.",
  judging_close: "Judging closes and judges can no longer change scores.",
  judging_reopen: "Judging opens again and the timer carries on.",
  judging_skipped: "Judging has not started, so it is skipped.",
  finalists_lineup: "The submitted finalists become the stage lineup, in pitch order.",
  queue_publish: "The lineup is published to participants.",
  lineup_stays_published: "The lineup stays published.",
  finish: "The event is marked finished.",
  unfinish: "The event is no longer marked finished.",
};

export const PHASE_LABELS: Record<EventPhase, string> = {
  submissions: "Submissions",
  judging: "Judging",
  stage: "Stage",
  finished: "Finished",
};
