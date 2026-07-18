export type EventType = "demo" | "hackathon";

export function lineupPositionLabel(
  index: number,
  eventType: EventType,
  queuePublished: boolean,
) {
  if (!queuePublished) return `#${index + 1}`;
  if (index === 0) return eventType === "hackathon" ? "Now presenting" : "Now demoing";
  if (index === 1) return "Up next";
  return `#${index + 1}`;
}

export function participantLineupStatus(
  storedStatus: string,
  lineupIndex: number,
  queuePublished: boolean,
) {
  if (!queuePublished) return storedStatus;
  if (lineupIndex === 0) return "current";
  if (lineupIndex === 1) return "up_next";
  if (lineupIndex > 1) return "queued";
  return storedStatus;
}

export function completedQueueLabel(eventType: EventType) {
  return eventType === "hackathon" ? "Presentations complete" : "Queue complete";
}

export function stageSubmissionPrompt(eventType: EventType) {
  return eventType === "hackathon" ? "Submit your project" : "Submit your demo";
}

export function shouldShowMeetAvailabilityCopy(status: string) {
  return status !== "done";
}
