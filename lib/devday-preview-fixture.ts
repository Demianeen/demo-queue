import { DEVDAY_THEME_NAME } from "@/lib/visual-style";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { buildStagePreviewFixture } from "@/lib/stage-preview-fixture";

export type PreviewParticipant = NonNullable<FunctionReturnType<typeof api.events.getParticipant>>;

/** Synthetic contact details for the development-only, memory-backed theme preview. */
export function buildDevDayParticipantFixture(eventType: "demo" | "hackathon"): PreviewParticipant {
  const stage = buildStagePreviewFixture({
    eventName: `${DEVDAY_THEME_NAME} · London`,
    eventType,
    visualStyle: "devday",
    meetUrl: "",
  });
  const submission = stage.lineup[0];

  return {
    event: {
      name: stage.event.name,
      slug: "preview",
      eventType,
      visualStyle: "devday",
      theme: stage.event.theme,
      submissionsClosed: false,
    },
    submission: {
      ...submission,
      status: "candidate",
      phone: "+447700900001",
      email: "maya@example.com",
      twitter: "@example",
      linkedin: undefined,
      githubUrl: "https://github.com/example/signal-relay",
      rulesAcceptedAt: undefined,
      finalist: false,
      teamMembers: eventType === "hackathon" ? ["Noah Williams"] : [],
      videoUrl: "https://example.com/demo",
      videoDeleteAt: undefined,
      videoDeletedAt: undefined,
      createdAt: 0,
    },
    meetUrl: null,
  };
}
