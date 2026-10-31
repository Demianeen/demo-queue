import type { EventPhase } from "./event-phase";

export type ParticipantStatus = "candidate" | "queued" | "hidden" | "up_next" | "current" | "done" | "no_show" | "withdrawn";
export type StepState = "done" | "current" | "todo";
export type StatusStep = { label: string; state: StepState };

const demoLabels: Record<string, string> = {
  candidate: "Submitted, waiting to be added as a demoer",
  queued: "You are listed as a demoer",
  hidden: "Hidden by event team",
  up_next: "You are up next",
  current: "You are presenting now",
  done: "Demo complete",
  no_show: "Marked as no-show",
  withdrawn: "Withdrawn",
};

const hackathonLabels: Record<string, string> = {
  ...demoLabels,
  candidate: "Submitted, waiting for judging",
  queued: "Scheduled to present",
  done: "Presentation complete",
};

/**
 * The status page's heading. A hackathon finalist still waiting to be
 * scheduled reads "Selected as a finalist" (Proposed) once judging is over.
 */
export function participantHeading(input: { eventType: "demo" | "hackathon"; status: string; finalist: boolean; phase: EventPhase }) {
  if (input.eventType === "hackathon" && input.finalist && input.status === "candidate" && (input.phase === "stage" || input.phase === "finished")) {
    return "Selected as a finalist";
  }
  return (input.eventType === "hackathon" ? hackathonLabels : demoLabels)[input.status] ?? input.status;
}

function steps(labels: string[], done: number, current: number | null): StatusStep[] {
  return labels.map((label, index) => ({ label, state: index < done ? "done" : index === current ? "current" : "todo" }));
}

/**
 * Where the team is: Submitted, Judging, Finalists, Results on a hackathon,
 * from the event's phase; Submitted, Lineup, Demoing, Done on a demo night,
 * from the team's own status. A withdrawn entry has no step done.
 */
export function participantSteps(input: { eventType: "demo" | "hackathon"; status: string; finalist: boolean; phase: EventPhase }): StatusStep[] {
  if (input.eventType === "hackathon") {
    const labels = ["Submitted", "Judging", "Finalists", "Results"];
    if (input.status === "withdrawn") return steps(labels, 0, null);
    switch (input.phase) {
      case "judging": return steps(labels, 1, 1);
      case "stage": return steps(labels, 2, 2);
      case "finished": return steps(labels, 4, null);
      default: return steps(labels, 1, null);
    }
  }
  const labels = ["Submitted", "Lineup", "Demoing", "Done"];
  switch (input.status) {
    case "withdrawn": return steps(labels, 0, null);
    case "queued":
    case "up_next":
    case "no_show": return steps(labels, 2, null);
    case "current": return steps(labels, 2, 2);
    case "done": return steps(labels, 4, null);
    default: return steps(labels, 1, null);
  }
}

/** "github.com/tomo/guardrail" for a link shown as text. */
export function displayUrl(value: string) {
  return value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}
