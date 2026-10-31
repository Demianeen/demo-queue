import { buildStagePreviewFixture } from "@/lib/stage-preview-fixture";
import type { PreviewParticipant } from "@/lib/devday-preview-fixture";
import type { StagePresentationData } from "@/lib/stage-presentation";
import type { PreviewPage, PreviewStyle } from "@/lib/style-preview";

/**
 * The sample event's slug. No real event can have it (slugs never start with
 * "_"), so the submit form never finds a remembered submission to read.
 */
export const PREVIEW_SLUG = "_style-preview";
export const PREVIEW_TOKEN = "_sample";

export const SAMPLE_EVENT_NAME = "Frontier Hack";

/** What the sample pages say instead of saving. */
export async function sampleRefusal(): Promise<never> {
  throw new Error("This is a sample page, so nothing was sent.");
}

/** The sample event as the stage and the submit form read it, set up for one preview page. */
export function buildStylePreviewStage(style: PreviewStyle, page: PreviewPage): StagePresentationData {
  const stage = buildStagePreviewFixture({ eventName: SAMPLE_EVENT_NAME, eventType: "hackathon", visualStyle: style.visualStyle, meetUrl: "", theme: style.theme });
  if (page === "welcome") {
    // The welcome screen as the room sees it before the lineup: the submit QR, the clock and the count.
    stage.event.stageScreenMode = "qr";
    stage.event.showStageTimerOnStage = true;
    stage.event.showSubmissionCountOnStage = true;
  }
  if (page === "winners" || page === "winners-only") {
    // The finished event: the podium, and the other finalists in pitch order when chosen.
    const [first, second, third, ...rest] = stage.lineup;
    stage.phase = "finished";
    stage.results = {
      winners: [first, second, third].map((item, index) => ({ place: (index + 1) as 1 | 2 | 3, demoTitle: item.demoTitle, teamName: item.teamName ?? item.name })),
      finalists: rest.map((item) => ({ demoTitle: item.demoTitle, teamName: item.teamName ?? item.name })),
      showFinalists: page === "winners",
    };
  }
  return stage;
}

const STATUS: Partial<Record<PreviewPage, { phase: PreviewParticipant["event"]["phase"]; status: string; finalist: boolean; placement: 1 | 2 | 3 | null }>> = {
  "status-submitted": { phase: "submissions", status: "candidate", finalist: false, placement: null },
  "status-finalist": { phase: "stage", status: "queued", finalist: true, placement: null },
  "status-1st": { phase: "finished", status: "done", finalist: true, placement: 1 },
  "status-2nd": { phase: "finished", status: "done", finalist: true, placement: 2 },
  "status-3rd": { phase: "finished", status: "done", finalist: true, placement: 3 },
};

/** One team's status page in the sample event: submitted, a finalist, or placed. */
export function buildStylePreviewParticipant(style: PreviewStyle, page: PreviewPage): PreviewParticipant {
  const stage = buildStylePreviewStage(style, "stage");
  const state = STATUS[page] ?? STATUS["status-submitted"]!;
  const submission = stage.lineup[0];
  return {
    event: {
      name: stage.event.name, slug: PREVIEW_SLUG, eventType: "hackathon", visualStyle: style.visualStyle, theme: style.theme,
      submissionsClosed: state.phase !== "submissions", phase: state.phase, lumaLinked: false,
    },
    submission: {
      ...submission,
      status: state.status,
      phone: "+447700900001",
      email: "maya@example.com",
      twitter: "@example",
      linkedin: undefined,
      githubProfile: undefined,
      githubUrl: "https://github.com/example/signal-relay",
      rulesAcceptedAt: 0,
      finalist: state.finalist,
      placement: state.placement,
      teamMembers: ["Noah Williams"],
      teamMemberSocials: [{ id: "sample-member" as PreviewParticipant["submission"]["teamMemberSocials"][number]["id"], name: "Noah Williams", twitter: undefined, linkedin: undefined, githubProfile: "noahw" }],
      videoUrl: "https://example.com/demo",
      videoDeleteAt: undefined,
      videoDeletedAt: undefined,
      createdAt: 0,
      canWithdraw: state.status === "candidate" || state.status === "queued",
      canSubmitAgain: false,
    },
    meetUrl: null,
  };
}
