import { buildStagePreviewFixture } from "@/lib/stage-preview-fixture";
import type { StagePresentationData } from "@/lib/stage-presentation";
import type { PreviewPage, PreviewStyle } from "@/lib/style-preview";

/**
 * The sample event's slug. No real event can have it (slugs never start with
 * "_"), so the submit form never finds a remembered submission to read.
 */
export const PREVIEW_SLUG = "_style-preview";

export const SAMPLE_EVENT_NAME = "Frontier Hack";

/** What the sample submit form says instead of submitting. */
export async function sampleSubmitRefusal(): Promise<never> {
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
  return stage;
}
