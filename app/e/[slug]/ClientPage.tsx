"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { InfoIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { participantPath } from "@/lib/routes";
import { randomQueueOrder, randomToken } from "@/lib/tokens";
import {
  SUBMISSION_FIELD_LIMITS,
  FieldLimitIssue,
  firstFieldLimitIssue,
  firstInvalidFieldName,
  isValidLinkedin,
  isValidPhone,
  isValidTwitter,
} from "@/lib/validation";
import { Brand } from "@/app/Brand";
import { Skeleton } from "@/app/Skeleton";
import {
  MAX_ADDITIONAL_TEAM_MEMBERS,
  MAX_HACKATHON_VIDEO_BYTES,
  MAX_HACKATHON_VIDEO_LABEL,
  MAX_GITHUB_REPOSITORY_URL_LENGTH,
  MAX_TEAM_MEMBER_NAME_LENGTH,
  MAX_TEAM_NAME_LENGTH,
  isSupportedVideo,
  normalizeGithubRepositoryUrl,
  parseAdditionalTeamMembers,
  videoContentType,
} from "@/lib/hackathon";

function Req() {
  return <span style={{ color: "var(--app-bad)" }}> *</span>;
}

function describedBy(...ids: Array<string | false | undefined>) {
  return ids.filter(Boolean).join(" ") || undefined;
}

function FieldLimitError({ field, issue }: { field: keyof typeof SUBMISSION_FIELD_LIMITS; issue: FieldLimitIssue | null }) {
  if (issue?.field !== field) return null;

  return <span id={`${field}-limit-error`} className="form-error">{issue.message}</span>;
}

function focusFirstInvalidField(form: HTMLFormElement, invalidFieldNames: Set<string>) {
  const fields = Array.from(form.elements).filter(
    (element): element is HTMLElement & { name: string } =>
      element instanceof HTMLElement &&
      "name" in element &&
      typeof element.name === "string",
  );
  const firstFieldName = firstInvalidFieldName(
    fields.map((element) => String(element.name)),
    invalidFieldNames,
  );
  const field = fields.find((element) => String(element.name) === firstFieldName);

  if (!(field instanceof HTMLElement)) return;
  requestAnimationFrame(() => field.focus());
}

export default function SubmissionPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const stage = useQuery(api.events.getStage, { slug: params.slug });
  const submitDemo = useMutation(api.events.submitDemo);
  const submitHackathon = useMutation(api.events.submitHackathon);
  const generateVideoUploadUrl = useMutation(api.events.generateHackathonVideoUploadUrl);
  const discardHackathonVideo = useMutation(api.events.discardHackathonVideo);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [socialError, setSocialError] = useState("");
  const [twitterError, setTwitterError] = useState("");
  const [linkedinError, setLinkedinError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [teamNameError, setTeamNameError] = useState("");
  const [teamMembersError, setTeamMembersError] = useState("");
  const [videoError, setVideoError] = useState("");
  const [githubError, setGithubError] = useState("");
  const [rulesError, setRulesError] = useState("");
  const [fieldLimitIssue, setFieldLimitIssue] = useState<FieldLimitIssue | null>(null);
  const [submissionError, setSubmissionError] = useState("");
  const isHackathon = stage?.event.eventType === "hackathon";

  if (!stage) {
    return (
      <main className="narrow-page">
        <section className="panel panel-pad" style={{ width: "min(760px, 100%)" }}>
          <Skeleton w={120} h={12} radius={6} style={{ marginBottom: 18 }} />
          <Skeleton w="70%" h={38} radius={10} style={{ marginBottom: 18 }} />
          <Skeleton w="90%" h={18} radius={8} style={{ marginBottom: 26 }} />
          <Skeleton h={46} radius={12} style={{ marginBottom: 14 }} />
          <Skeleton h={112} radius={12} />
        </section>
      </main>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const read = (key: string) => String(form.get(key) ?? "").trim();

    const phone = read("phone");
    const twitter = read("twitter");
    const linkedin = read("linkedin");
    const teamName = read("teamName");
    const teamMembers = parseAdditionalTeamMembers(read("teamMembers"));
    const githubUrl = read("githubUrl");
    const rulesAccepted = form.get("rulesAccepted") === "on";
    const video = form.get("video");
    const lengthIssue = firstFieldLimitIssue({
      name: read("name"),
      demoTitle: read("demoTitle"),
      description: read("description"),
      phone,
      email: read("email"),
      category: read("category"),
      twitter,
      linkedin,
    });

    setSocialError("");
    setTwitterError("");
    setLinkedinError("");
    setPhoneError("");
    setTeamNameError("");
    setTeamMembersError("");
    setVideoError("");
    setGithubError("");
    setRulesError("");
    setFieldLimitIssue(lengthIssue);
    setSubmissionError("");

    let valid = true;
    const invalidFieldNames = new Set<string>();
    if (lengthIssue) {
      invalidFieldNames.add(lengthIssue.field);
      valid = false;
    }
    if (!isValidPhone(phone)) {
      setPhoneError("Enter a valid phone number (7-15 digits).");
      invalidFieldNames.add("phone");
      valid = false;
    }
    // Cross-field rule: at least one social is required (native `required`
    // only validates a single field, not "one of this group").
    if (!twitter && !linkedin) {
      setSocialError("Add at least one of Twitter/X or LinkedIn so the team can connect with you after.");
      invalidFieldNames.add("twitter");
      valid = false;
    }
    // Format checks so a stray paste (e.g. the helper text) can't slip through.
    if (twitter && !isValidTwitter(twitter)) {
      setTwitterError("Enter an @handle or an x.com / twitter.com link.");
      invalidFieldNames.add("twitter");
      valid = false;
    }
    if (linkedin && !isValidLinkedin(linkedin)) {
      setLinkedinError("Enter a linkedin.com/in/... link.");
      invalidFieldNames.add("linkedin");
      valid = false;
    }

    if (isHackathon) {
      if (!teamName || teamName.length > MAX_TEAM_NAME_LENGTH) {
        setTeamNameError(`Enter a team name up to ${MAX_TEAM_NAME_LENGTH} characters.`);
        invalidFieldNames.add("teamName");
        valid = false;
      }
      if (
        teamMembers.length > MAX_ADDITIONAL_TEAM_MEMBERS ||
        teamMembers.some((member) => member.length > MAX_TEAM_MEMBER_NAME_LENGTH)
      ) {
        setTeamMembersError(
          `Add up to ${MAX_ADDITIONAL_TEAM_MEMBERS} additional members, one per line, with names up to ${MAX_TEAM_MEMBER_NAME_LENGTH} characters.`,
        );
        invalidFieldNames.add("teamMembers");
        valid = false;
      }
      if (!(video instanceof File) || video.size === 0) {
        setVideoError("Choose a video to upload.");
        invalidFieldNames.add("video");
        valid = false;
      } else if (video.size > MAX_HACKATHON_VIDEO_BYTES) {
        setVideoError(`Video must be ${MAX_HACKATHON_VIDEO_LABEL} or smaller.`);
        invalidFieldNames.add("video");
        valid = false;
      } else if (!isSupportedVideo(video)) {
        setVideoError("Upload an MP4, WebM, or MOV video.");
        invalidFieldNames.add("video");
        valid = false;
      }
      if (!normalizeGithubRepositoryUrl(githubUrl)) {
        setGithubError("Enter a valid public GitHub repository URL.");
        invalidFieldNames.add("githubUrl");
        valid = false;
      }
      if (!rulesAccepted) {
        setRulesError("Confirm that your submission meets the event rules.");
        invalidFieldNames.add("rulesAccepted");
        valid = false;
      }
    }
    if (!valid) {
      focusFirstInvalidField(formElement, invalidFieldNames);
      return;
    }

    setIsSubmitting(true);

    const participantToken = randomToken(32);
    let uploadedStorageId: string | null = null;
    try {
      const sharedFields = {
        slug: params.slug,
        participantToken,
        name: read("name"),
        demoTitle: read("demoTitle"),
        description: read("description"),
        phone: read("phone"),
        email: read("email") || undefined,
        category: read("category") || undefined,
        twitter: twitter || undefined,
        linkedin: linkedin || undefined,
      };

      if (isHackathon && video instanceof File) {
        const uploadUrl = await generateVideoUploadUrl({ slug: params.slug });
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": videoContentType(video) },
          body: video,
        });
        if (!uploadResponse.ok) throw new Error("Video upload failed. Please try again.");
        const uploadResult = (await uploadResponse.json()) as { storageId?: string };
        if (!uploadResult.storageId) throw new Error("Video upload did not return a file ID.");
        uploadedStorageId = uploadResult.storageId;

        await submitHackathon({
          ...sharedFields,
          teamName,
          teamMembers,
          githubUrl,
          rulesAccepted,
          videoStorageId: uploadResult.storageId as Id<"_storage">,
        });
      } else {
        await submitDemo({ ...sharedFields, queueOrder: randomQueueOrder() });
      }
      router.push(participantPath(params.slug, participantToken));
    } catch (error) {
      if (uploadedStorageId) {
        await discardHackathonVideo({
          slug: params.slug,
          storageId: uploadedStorageId as Id<"_storage">,
        }).catch(() => undefined);
      }
      setIsSubmitting(false);
      const message = error instanceof Error ? error.message : "Something went wrong submitting.";
      setSubmissionError(message.includes("ConvexError") ? message.split("ConvexError: ").pop() ?? message : message);
    }
  }

  return (
    <main className="narrow-page">
      <section className="panel panel-pad" style={{ width: "min(760px, 100%)" }}>
        <Brand label={stage.event.name} />
        <h1>{isHackathon ? "Submit your hackathon project." : "Submit your demo."}</h1>
        <p className="lead">
          {isHackathon
            ? "Submit once for your team. You will get a private status link, and finalists will use the Meet link to present."
            : "You will get a private status link after submitting. The Meet link appears there once you are listed as a demoer."}
        </p>

        <form className="form" onSubmit={onSubmit} style={{ marginTop: 24 }}>
          <div style={{ display: "grid", gap: 14 }}>
            <h2 style={{ fontSize: 18, marginBottom: 0 }}>
              {isHackathon ? "Team and project" : "Demo info"}
            </h2>
            {isHackathon ? (
              <>
                <div className="field">
                  <label htmlFor="teamName">Team name<Req /></label>
                  <input
                    id="teamName"
                    name="teamName"
                    placeholder="Your team name"
                    maxLength={MAX_TEAM_NAME_LENGTH}
                    required
                    aria-invalid={Boolean(teamNameError) || undefined}
                    aria-describedby={teamNameError ? "team-name-error" : undefined}
                  />
                  {teamNameError ? <span id="team-name-error" className="form-error">{teamNameError}</span> : null}
                </div>
                <div className="field">
                  <label htmlFor="teamMembers">Other team members, one per line</label>
                  <textarea
                    id="teamMembers"
                    name="teamMembers"
                    placeholder={"Sam Lee\nAlex Morgan"}
                    rows={3}
                    aria-invalid={Boolean(teamMembersError) || undefined}
                    aria-describedby={teamMembersError ? "team-members-error" : undefined}
                  />
                  <span className="muted form-help">
                    The presenter below is included automatically. Add up to {MAX_ADDITIONAL_TEAM_MEMBERS} others.
                  </span>
                  {teamMembersError ? (
                    <span id="team-members-error" className="form-error">{teamMembersError}</span>
                  ) : null}
                </div>
              </>
            ) : null}
            <div className="field">
              <label htmlFor="name">{isHackathon ? "Presenter and primary contact" : "Your name"}<Req /></label>
              <input
                id="name"
                name="name"
                placeholder="Your full name"
                maxLength={SUBMISSION_FIELD_LIMITS.name}
                required
                aria-invalid={fieldLimitIssue?.field === "name" || undefined}
                aria-describedby={fieldLimitIssue?.field === "name" ? "name-limit-error" : undefined}
              />
              <FieldLimitError field="name" issue={fieldLimitIssue} />
            </div>

            <div className="field">
              <label htmlFor="demoTitle">{isHackathon ? "Project name" : "Demo title"}<Req /></label>
              <input
                id="demoTitle"
                name="demoTitle"
                placeholder={isHackathon ? "What did your team build?" : "What are you demoing?"}
                maxLength={SUBMISSION_FIELD_LIMITS.demoTitle}
                required
                aria-invalid={fieldLimitIssue?.field === "demoTitle" || undefined}
                aria-describedby={fieldLimitIssue?.field === "demoTitle" ? "demoTitle-limit-error" : undefined}
              />
              <FieldLimitError field="demoTitle" issue={fieldLimitIssue} />
            </div>

            <div className="field">
              <label htmlFor="description">{isHackathon ? "Project description" : "Short description"}<Req /></label>
              <textarea
                id="description"
                name="description"
                placeholder="One or two lines about your demo"
                maxLength={SUBMISSION_FIELD_LIMITS.description}
                required
                aria-invalid={fieldLimitIssue?.field === "description" || undefined}
                aria-describedby={fieldLimitIssue?.field === "description" ? "description-limit-error" : undefined}
              />
              <FieldLimitError field="description" issue={fieldLimitIssue} />
            </div>

            {isHackathon ? (
              <div className="field">
                <label htmlFor="githubUrl">Public GitHub repository<Req /></label>
                <Alert>
                  <InfoIcon />
                  <AlertTitle className="font-semibold">Public repository required</AlertTitle>
                  <AlertDescription className="text-foreground">
                    Everything judges need to understand and run your project must be in the README.
                  </AlertDescription>
                </Alert>
                <input
                  id="githubUrl"
                  name="githubUrl"
                  type="url"
                  inputMode="url"
                  placeholder="https://github.com/your-org/your-project"
                  maxLength={MAX_GITHUB_REPOSITORY_URL_LENGTH}
                  required
                  aria-invalid={Boolean(githubError) || undefined}
                  aria-describedby={githubError ? "github-error" : undefined}
                />
                {githubError ? <span id="github-error" className="form-error">{githubError}</span> : null}
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="phone">Phone number<Req /></label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                placeholder="+1 555 123 4567"
                maxLength={SUBMISSION_FIELD_LIMITS.phone}
                required
                aria-invalid={Boolean(phoneError || fieldLimitIssue?.field === "phone") || undefined}
                aria-describedby={describedBy(
                  fieldLimitIssue?.field === "phone" && "phone-limit-error",
                  phoneError && "phone-error",
                )}
              />
              <FieldLimitError field="phone" issue={fieldLimitIssue} />
              {phoneError ? (
                <span id="phone-error" style={{ color: "var(--app-bad)", fontSize: 13, fontWeight: 600 }}>{phoneError}</span>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="email">Email<Req /></label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                maxLength={SUBMISSION_FIELD_LIMITS.email}
                required
                aria-invalid={fieldLimitIssue?.field === "email" || undefined}
                aria-describedby={fieldLimitIssue?.field === "email" ? "email-limit-error" : undefined}
              />
              <FieldLimitError field="email" issue={fieldLimitIssue} />
            </div>

            <div className="field">
              <label htmlFor="category">Category, optional</label>
              <input
                id="category"
                name="category"
                placeholder="AI, devtools, consumer, hardware..."
                maxLength={SUBMISSION_FIELD_LIMITS.category}
                aria-invalid={fieldLimitIssue?.field === "category" || undefined}
                aria-describedby={fieldLimitIssue?.field === "category" ? "category-limit-error" : undefined}
              />
              <FieldLimitError field="category" issue={fieldLimitIssue} />
            </div>

            {isHackathon ? (
              <div className="field">
                <label htmlFor="video">Demo video<Req /></label>
                <Alert>
                  <InfoIcon />
                  <AlertTitle className="font-semibold">Maximum 90 seconds. No slides.</AlertTitle>
                  <AlertDescription className="text-foreground">
                    Show the working product. MP4, WebM, or MOV, up to {MAX_HACKATHON_VIDEO_LABEL}. Stored for six months.
                  </AlertDescription>
                </Alert>
                <input
                  id="video"
                  name="video"
                  type="file"
                  accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
                  required
                  aria-invalid={Boolean(videoError) || undefined}
                  aria-describedby={videoError ? "video-error" : undefined}
                />
                {videoError ? <span id="video-error" className="form-error">{videoError}</span> : null}
              </div>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 14, marginTop: 10 }}>
            <h2 style={{ fontSize: 18, marginBottom: 0 }}>Socials</h2>
            <p className="muted" style={{ marginTop: -4 }}>
              Add at least one so the event team can connect with you after.
            </p>

            <div className="field">
              <label htmlFor="twitter">Twitter/X</label>
              <input
                id="twitter"
                name="twitter"
                placeholder="@handle or x.com/handle"
                maxLength={SUBMISSION_FIELD_LIMITS.twitter}
                aria-invalid={Boolean(twitterError || socialError || fieldLimitIssue?.field === "twitter") || undefined}
                aria-describedby={describedBy(
                  fieldLimitIssue?.field === "twitter" && "twitter-limit-error",
                  twitterError && "twitter-error",
                  socialError && "social-error",
                )}
              />
              <FieldLimitError field="twitter" issue={fieldLimitIssue} />
              {twitterError ? (
                <span id="twitter-error" style={{ color: "var(--app-bad)", fontSize: 13, fontWeight: 600 }}>{twitterError}</span>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="linkedin">LinkedIn</label>
              <input
                id="linkedin"
                name="linkedin"
                placeholder="linkedin.com/in/you"
                maxLength={SUBMISSION_FIELD_LIMITS.linkedin}
                aria-invalid={Boolean(linkedinError || fieldLimitIssue?.field === "linkedin") || undefined}
                aria-describedby={describedBy(
                  fieldLimitIssue?.field === "linkedin" && "linkedin-limit-error",
                  linkedinError && "linkedin-error",
                )}
              />
              <FieldLimitError field="linkedin" issue={fieldLimitIssue} />
              {linkedinError ? (
                <span id="linkedin-error" style={{ color: "var(--app-bad)", fontSize: 13, fontWeight: 600 }}>{linkedinError}</span>
              ) : null}
            </div>

            {socialError ? (
              <p id="social-error" style={{ color: "var(--app-bad)", fontWeight: 600, marginTop: 2 }}>{socialError}</p>
            ) : null}
          </div>

          {isHackathon ? (
            <div className="submission-confirmation">
              <input
                id="rulesAccepted"
                name="rulesAccepted"
                type="checkbox"
                aria-invalid={Boolean(rulesError) || undefined}
                aria-describedby={rulesError ? "rules-error" : undefined}
              />
              <label htmlFor="rulesAccepted">
                I confirm that our team and project meet the event rules, that this submission is accurate, and that the organisers may judge and present it as a hackathon entry.
              </label>
              {rulesError ? <span id="rules-error" className="form-error">{rulesError}</span> : null}
            </div>
          ) : null}

          {submissionError ? <p role="alert" className="form-error">{submissionError}</p> : null}

          <div className="actions">
            <button className="button" disabled={isSubmitting} type="submit">
              {isSubmitting
                ? isHackathon
                  ? "Uploading and submitting..."
                  : "Submitting..."
                : isHackathon
                  ? "Submit project"
                  : "Join the queue"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
