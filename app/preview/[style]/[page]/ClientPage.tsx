"use client";

import { StagePresentation } from "@/components/StagePresentation";
import { EmailCheckOverride } from "@/components/SubmissionEmailField";
import { SubmissionPage } from "@/app/e/[slug]/ClientPage";
import { ParticipantPage } from "@/app/s/[slug]/[token]/ClientPage";
import { buildStylePreviewParticipant, buildStylePreviewStage, PREVIEW_SLUG, PREVIEW_TOKEN, sampleRefusal } from "@/lib/style-preview-fixture";
import { stylePreviewPath, type PreviewPage, type PreviewStyle } from "@/lib/style-preview";
import { useSiteOrigin } from "@/lib/use-site-origin";

// The sample pages never reach an event: no email is taken, and saving says so.
const noEmailTaken = async () => ({ taken: false });

/**
 * One page of an event in a style, with sample data. Each page is the real
 * component the event uses, so this is what the room and the participants see.
 */
export default function StylePreviewClientPage({ style, page }: { style: PreviewStyle; page: PreviewPage }) {
  const origin = useSiteOrigin();
  // The stage QR opens this style's sample submit form, so scanning it from the preview works too.
  const submitUrl = `${origin}${stylePreviewPath(style, "submit")}`;

  if (page === "submit") {
    return <EmailCheckOverride value={noEmailTaken}>
      <SubmissionPage slug={PREVIEW_SLUG} stage={buildStylePreviewStage(style, page)} submitDemo={sampleRefusal} submitHackathon={sampleRefusal} onSubmitted={() => undefined} />
    </EmailCheckOverride>;
  }
  if (page.startsWith("status-")) {
    return <ParticipantPage slug={PREVIEW_SLUG} token={PREVIEW_TOKEN} participant={buildStylePreviewParticipant(style, page)}
      editContact={sampleRefusal} withdraw={sampleRefusal} resubmit={sampleRefusal} editTeamMemberSocials={sampleRefusal} />;
  }
  return <StagePresentation stage={buildStylePreviewStage(style, page)} submissionUrl={submitUrl} />;
}
