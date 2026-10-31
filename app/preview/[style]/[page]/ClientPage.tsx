"use client";

import { StagePresentation } from "@/components/StagePresentation";
import { EmailCheckOverride } from "@/components/SubmissionEmailField";
import { SubmissionPage } from "@/app/e/[slug]/ClientPage";
import { buildStylePreviewStage, PREVIEW_SLUG, sampleSubmitRefusal } from "@/lib/style-preview-fixture";
import { stylePreviewPath, type PreviewPage, type PreviewStyle } from "@/lib/style-preview";
import { useSiteOrigin } from "@/lib/use-site-origin";

// The sample form never reaches an event: no email is taken, and submitting says so.
const noEmailTaken = async () => ({ taken: false });

/**
 * One page of an event in a style, with sample data. Each page is the real
 * component the event uses, so this is what the room and the participants see.
 */
export default function StylePreviewClientPage({ style, page }: { style: PreviewStyle; page: PreviewPage }) {
  const origin = useSiteOrigin();
  // The stage QR opens this style's sample submit form, so scanning it from the preview works too.
  const submitUrl = `${origin}${stylePreviewPath(style, "submit")}`;
  const stage = buildStylePreviewStage(style, page);

  if (page === "submit") {
    return <EmailCheckOverride value={noEmailTaken}>
      <SubmissionPage slug={PREVIEW_SLUG} stage={stage} submitDemo={sampleSubmitRefusal} submitHackathon={sampleSubmitRefusal} onSubmitted={() => undefined} />
    </EmailCheckOverride>;
  }
  return <StagePresentation stage={stage} submissionUrl={submitUrl} />;
}
