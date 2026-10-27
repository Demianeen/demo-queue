"use client";

import { eventThemeProperties } from "@/lib/event-theme";
import { FormEvent, useCallback, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { TrackPicker } from "@/components/TrackPicker";
import { SubmissionEmailField } from "@/components/SubmissionEmailField";
import { LockKeyholeIcon, Plus, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "../../../convex/_generated/api";
import { participantPath } from "@/lib/routes";
import { randomQueueOrder, randomToken } from "@/lib/tokens";
import {
  SUBMISSION_FIELD_LIMITS,
  FieldLimitIssue,
  emailKey,
  firstFieldLimitIssue,
  firstInvalidFieldName,
  isValidPhone,
  socialLinksError,
} from "@/lib/validation";
import { Brand } from "@/app/Brand";
import { Skeleton } from "@/app/Skeleton";
import { AstraHero } from "@/components/AstraHero";
import { DevDayHero } from "@/components/DevDayHero";
import { OutpostHero } from "@/components/OutpostHero";
import { cn } from "@/lib/utils";
import { isOutpostStyle, normalizeVisualStyle } from "@/lib/visual-style";
import {
  MAX_ADDITIONAL_TEAM_MEMBERS,
  MAX_GITHUB_REPOSITORY_URL_LENGTH,
  MAX_HACKATHON_VIDEO_URL_LENGTH,
  MAX_TEAM_NAME_LENGTH,
  normalizeHackathonVideoUrl,
  normalizeGithubRepositoryUrl,
} from "@/lib/hackathon";
import {
  TEAM_CONTACT_FIELD_LIMITS,
  teamContactSchema,
  type TeamContact,
  type TeamContactInput,
} from "@/lib/team-contacts";

type PersonField = "name" | "email" | "whatsappPhone" | "socials";
type PersonErrors = Record<number, Partial<Record<PersonField, string>>>;
type Socials = { twitter?: string; linkedin?: string; githubProfile?: string };

// The single demoer uses row 0 too, so both forms share the email and social state.
const DEMOER_ROW = 0;

function Req() {
  return <span style={{ color: "var(--app-bad)" }}> *</span>;
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

function SocialFields({ rowId, label, error }: { rowId: number; label: string; error?: string }) {
  const errorId = `socials-${rowId}-error`;
  const describedBy = error ? errorId : undefined;
  return (
    <div className="person-socials" role="group" aria-label={`${label} socials`}>
      <input
        aria-describedby={describedBy}
        aria-invalid={Boolean(error) || undefined}
        aria-label={`${label} X handle`}
        maxLength={SUBMISSION_FIELD_LIMITS.twitter}
        name={`twitter-${rowId}`}
        placeholder="X @handle"
      />
      <input
        aria-describedby={describedBy}
        aria-invalid={Boolean(error) || undefined}
        aria-label={`${label} LinkedIn`}
        maxLength={SUBMISSION_FIELD_LIMITS.linkedin}
        name={`linkedin-${rowId}`}
        placeholder="LinkedIn URL"
      />
      <input
        aria-describedby={describedBy}
        aria-invalid={Boolean(error) || undefined}
        aria-label={`${label} GitHub`}
        maxLength={SUBMISSION_FIELD_LIMITS.githubProfile}
        name={`githubProfile-${rowId}`}
        placeholder="GitHub username"
      />
      {error ? <span className="form-error person-socials-error" id={errorId}>{error}</span> : null}
    </div>
  );
}

export type SubmissionPageProps = {
  slug: string;
  stage: FunctionReturnType<typeof api.events.getStage> | undefined;
  submitDemo: (args: FunctionArgs<typeof api.events.submitDemo>) => Promise<unknown>;
  submitHackathon: (args: FunctionArgs<typeof api.events.submitHackathon>) => Promise<unknown>;
  onSubmitted: (participantToken: string) => void;
};

export default function ConnectedSubmissionPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const stage = useQuery(api.events.getStage, { slug: params.slug });
  const submitDemo = useMutation(api.events.submitDemo);
  const submitHackathon = useMutation(api.events.submitHackathon);

  return (
    <SubmissionPage
      slug={params.slug}
      stage={stage}
      submitDemo={submitDemo}
      submitHackathon={submitHackathon}
      onSubmitted={(participantToken) => router.push(participantPath(params.slug, participantToken))}
    />
  );
}

export function SubmissionPage({
  slug,
  stage,
  submitDemo,
  submitHackathon,
  onSubmitted,
}: SubmissionPageProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [teamNameError, setTeamNameError] = useState("");
  const [personErrors, setPersonErrors] = useState<PersonErrors>({});
  const [personRowIds, setPersonRowIds] = useState([0]);
  const nextPersonRowId = useRef(1);
  const [emails, setEmails] = useState<Record<number, string>>({});
  const [takenRows, setTakenRows] = useState<ReadonlySet<number>>(new Set());
  const [videoError, setVideoError] = useState("");
  const [githubError, setGithubError] = useState("");
  const [rulesError, setRulesError] = useState("");
  const [fieldLimitIssue, setFieldLimitIssue] = useState<FieldLimitIssue | null>(null);
  const [submissionError, setSubmissionError] = useState("");
  const [trackIds, setTrackIds] = useState<Id<"eventTracks">[]>([]);
  const isHackathon = stage?.event.eventType === "hackathon";
  const visualStyle = normalizeVisualStyle(stage?.event.visualStyle);
  const isOutpost = isOutpostStyle(visualStyle);
  const isAstra = visualStyle === "astra";
  const isDevDay = visualStyle === "devday";

  const setRowTaken = useCallback((rowId: number, taken: boolean) => {
    setTakenRows((current) => {
      if (current.has(rowId) === taken) return current;
      const next = new Set(current);
      if (taken) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }, []);
  const takenHandlers = useRef(new Map<number, (taken: boolean) => void>());
  const takenHandler = (rowId: number) => {
    let handler = takenHandlers.current.get(rowId);
    if (!handler) {
      handler = (taken: boolean) => setRowTaken(rowId, taken);
      takenHandlers.current.set(rowId, handler);
    }
    return handler;
  };

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

  function removePerson(rowId: number) {
    setPersonRowIds((rows) => rows.filter((id) => id !== rowId));
    setPersonErrors((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
    setEmails((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
    setRowTaken(rowId, false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const read = (key: string) => String(form.get(key) ?? "").trim();
    const socialsFor = (rowId: number): Socials => ({
      twitter: read(`twitter-${rowId}`) || undefined,
      linkedin: read(`linkedin-${rowId}`) || undefined,
      githubProfile: read(`githubProfile-${rowId}`) || undefined,
    });

    const rowIds = isHackathon ? personRowIds : [DEMOER_ROW];
    const phone = read("phone");
    const teamName = read("teamName");
    const githubUrl = read("githubUrl");
    const rulesAccepted = form.get("rulesAccepted") === "on";
    const videoUrl = read("videoUrl");
    const presenterSocials = socialsFor(rowIds[0]);
    const lengthIssue = firstFieldLimitIssue({
      ...(isHackathon ? {} : { name: read("name"), phone, email: read(`email-${DEMOER_ROW}`) }),
      demoTitle: read("demoTitle"),
      description: read("description"),
    });

    setPhoneError("");
    setTeamNameError("");
    setPersonErrors({});
    setVideoError("");
    setGithubError("");
    setRulesError("");
    setFieldLimitIssue(lengthIssue);
    setSubmissionError("");

    let valid = true;
    const invalidFieldNames = new Set<string>();
    const nextPersonErrors: PersonErrors = {};
    const personError = (rowId: number, field: PersonField, message: string, fieldName: string) => {
      nextPersonErrors[rowId] ??= {};
      nextPersonErrors[rowId][field] ??= message;
      invalidFieldNames.add(fieldName);
      valid = false;
    };
    if (lengthIssue) {
      invalidFieldNames.add(lengthIssue.field);
      valid = false;
    }
    if (!isHackathon && !isValidPhone(phone)) {
      setPhoneError("Enter a valid phone number (7-15 digits).");
      invalidFieldNames.add("phone");
      valid = false;
    }

    // At least one social for the presenter, so the event team can connect after.
    if (!presenterSocials.twitter && !presenterSocials.linkedin && !presenterSocials.githubProfile) {
      personError(rowIds[0], "socials", "Add at least one of X, LinkedIn or GitHub so the team can connect with you after.", `twitter-${rowIds[0]}`);
    }
    for (const rowId of rowIds) {
      const message = socialLinksError(socialsFor(rowId));
      if (message) personError(rowId, "socials", message, `twitter-${rowId}`);
    }

    // Emails: each person needs their own, and none may already be in the event.
    const seenEmails = new Map<string, number>();
    for (const rowId of rowIds) {
      const key = emailKey(emails[rowId] ?? "");
      if (!key) continue;
      if (seenEmails.has(key)) personError(rowId, "email", "Each person needs a different email.", `email-${rowId}`);
      seenEmails.set(key, rowId);
      if (takenRows.has(rowId)) {
        invalidFieldNames.add(`email-${rowId}`);
        valid = false;
      }
    }

    const parsedContacts: Array<TeamContact | null> = [];
    if (isHackathon) {
      rowIds.forEach((rowId, index) => {
        const contact: TeamContactInput = {
          name: read(`name-${rowId}`),
          email: emails[rowId] ?? "",
          whatsappPhone: read(`whatsapp-${rowId}`),
          ...(index === 0 ? {} : socialsFor(rowId)),
        };
        const result = teamContactSchema.safeParse(contact);
        if (result.success) {
          parsedContacts.push(result.data);
          return;
        }
        parsedContacts.push(null);
        for (const issue of result.error.issues) {
          const field = issue.path[0];
          if (field === "name") personError(rowId, "name", issue.message, `name-${rowId}`);
          else if (field === "email") personError(rowId, "email", issue.message, `email-${rowId}`);
          else if (field === "whatsappPhone") personError(rowId, "whatsappPhone", issue.message, `whatsapp-${rowId}`);
          else personError(rowId, "socials", issue.message, `twitter-${rowId}`);
        }
      });

      if (!teamName || teamName.length > MAX_TEAM_NAME_LENGTH) {
        setTeamNameError(`Enter a team name up to ${MAX_TEAM_NAME_LENGTH} characters.`);
        invalidFieldNames.add("teamName");
        valid = false;
      }
      if (!normalizeGithubRepositoryUrl(githubUrl)) {
        setGithubError("Enter a valid public GitHub repository URL.");
        invalidFieldNames.add("githubUrl");
        valid = false;
      }
      if (!normalizeHackathonVideoUrl(videoUrl)) {
        setVideoError("Enter a valid HTTPS video link.");
        invalidFieldNames.add("videoUrl");
        valid = false;
      }
      if (!rulesAccepted) {
        setRulesError("Confirm that your submission meets the event rules.");
        invalidFieldNames.add("rulesAccepted");
        valid = false;
      }
    }
    setPersonErrors(nextPersonErrors);
    if (!valid) {
      focusFirstInvalidField(formElement, invalidFieldNames);
      return;
    }

    setIsSubmitting(true);

    const participantToken = randomToken(32);
    try {
      const presenter = isHackathon ? parsedContacts[0] : null;
      const additionalContacts = isHackathon ? (parsedContacts.slice(1) as TeamContact[]) : [];
      const sharedFields = {
        slug,
        participantToken,
        name: presenter?.name ?? read("name"),
        demoTitle: read("demoTitle"),
        description: read("description"),
        phone: presenter?.whatsappPhone ?? phone,
        email: presenter?.email ?? (emails[DEMOER_ROW]?.trim() || undefined),
        trackIds,
        ...presenterSocials,
      };

      if (isHackathon) {
        await submitHackathon({
          ...sharedFields,
          teamName,
          teamMembers: additionalContacts.map((member) => member.name),
          teamMemberContacts: additionalContacts,
          githubUrl,
          rulesAccepted,
          videoUrl,
        });
      } else {
        await submitDemo({ ...sharedFields, queueOrder: randomQueueOrder() });
      }
      onSubmitted(participantToken);
    } catch (error) {
      setIsSubmitting(false);
      const message = error instanceof Error ? error.message : "Something went wrong submitting.";
      setSubmissionError(message.includes("ConvexError") ? message.split("ConvexError: ").pop() ?? message : message);
    }
  }

  const emailField = (rowId: number, label: string, autoComplete?: string) => (
    <SubmissionEmailField
      autoComplete={autoComplete}
      error={personErrors[rowId]?.email}
      id={`email-${rowId}`}
      label={label}
      maxLength={TEAM_CONTACT_FIELD_LIMITS.email}
      name={`email-${rowId}`}
      onChange={(value) => setEmails((current) => ({ ...current, [rowId]: value }))}
      onTakenChange={takenHandler(rowId)}
      placeholder="you@example.com"
      slug={slug}
      value={emails[rowId] ?? ""}
    />
  );

  return (
    <main data-event-style={visualStyle} style={visualStyle === "neutral" ? eventThemeProperties(stage.event.theme) : undefined} className={isDevDay ? "devday-public-page" : isAstra ? "astra-public-page" : isOutpost ? "outpost-public-page" : "narrow-page"} data-visual-style={visualStyle}>
      {isDevDay ? (
        <DevDayHero eventName={stage.event.name} eventType={stage.event.eventType} mode="submission" />
      ) : null}
      {isAstra ? (
        <AstraHero eventName={stage.event.name} eventType={stage.event.eventType} mode="submission" />
      ) : null}
      {isOutpost ? (
        <OutpostHero
          eventName={stage.event.name}
          eventType={stage.event.eventType}
          mode="submission"
        />
      ) : null}
      <section
        className={cn("panel panel-pad", isOutpost && "outpost-content", isAstra && "astra-content", isDevDay && "devday-content")}
        style={isOutpost || isAstra || isDevDay ? undefined : { width: "min(760px, 100%)" }}
      >
        {isOutpost || isAstra || isDevDay ? null : visualStyle === "neutral" ? <p className="neutral-event-name">{stage.event.name}</p> : <Brand label={stage.event.name} />}
        {isAstra ? <p className="astra-eyebrow">{stage.event.name}</p> : null}
        {isDevDay ? (
          <p className="devday-eyebrow">{isHackathon ? "Community hackathon" : "Demo queue"} / Submission</p>
        ) : null}
        <div>
          {isOutpost ? (
            <p className="outpost-event-kicker">
              {isHackathon ? "Hackathon submission" : "Demo queue submission"} · {stage.event.name}
            </p>
          ) : null}
          <h1>
            {isOutpost && isHackathon
              ? "Tell us what you built"
              : isHackathon
                ? "Submit your hackathon project."
                : "Submit your demo."}
          </h1>
        </div>
        <p className="lead">
          {isHackathon
            ? "Submit once for your team. You will get a private status link, and the Meet link will appear there if you are scheduled to present."
            : "You will get a private status link after submitting. The Meet link appears there once you are listed as a demoer."}
        </p>

        {stage.event.submissionsClosed ? (
          <Alert className="mt-6" role="status">
            <LockKeyholeIcon />
            <AlertTitle>Submissions are closed</AlertTitle>
            <AlertDescription>
              This event is no longer accepting new {isHackathon ? "projects" : "demos"}.
            </AlertDescription>
          </Alert>
        ) : (
        <form className="form form-compact" onSubmit={onSubmit} style={{ marginTop: 24 }}>
          <div className="form-section">
            <h2>{isHackathon ? "Project" : "Your demo"}</h2>

            {isHackathon ? (
              <div className="form-row form-row-2">
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
                  <label htmlFor="demoTitle">Project name<Req /></label>
                  <input
                    id="demoTitle"
                    name="demoTitle"
                    placeholder="What did your team build?"
                    maxLength={SUBMISSION_FIELD_LIMITS.demoTitle}
                    required
                    aria-invalid={fieldLimitIssue?.field === "demoTitle" || undefined}
                    aria-describedby={fieldLimitIssue?.field === "demoTitle" ? "demoTitle-limit-error" : undefined}
                  />
                  <FieldLimitError field="demoTitle" issue={fieldLimitIssue} />
                </div>
              </div>
            ) : (
              <>
                <div className="form-row form-row-2">
                  <div className="field">
                    <label htmlFor="name">Your name<Req /></label>
                    <input
                      id="name"
                      name="name"
                      placeholder="Your full name"
                      autoComplete="name"
                      maxLength={SUBMISSION_FIELD_LIMITS.name}
                      required
                      aria-invalid={fieldLimitIssue?.field === "name" || undefined}
                      aria-describedby={fieldLimitIssue?.field === "name" ? "name-limit-error" : undefined}
                    />
                    <FieldLimitError field="name" issue={fieldLimitIssue} />
                  </div>
                  <div className="field">
                    <label htmlFor="phone">Phone number<Req /></label>
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+1 555 123 4567"
                      maxLength={SUBMISSION_FIELD_LIMITS.phone}
                      required
                      aria-invalid={Boolean(phoneError || fieldLimitIssue?.field === "phone") || undefined}
                      aria-describedby={phoneError ? "phone-error" : fieldLimitIssue?.field === "phone" ? "phone-limit-error" : undefined}
                    />
                    <FieldLimitError field="phone" issue={fieldLimitIssue} />
                    {phoneError ? <span id="phone-error" className="form-error">{phoneError}</span> : null}
                  </div>
                </div>
                <div className="form-row">
                  {emailField(DEMOER_ROW, "Email *", "email")}
                </div>
                <div className="form-row">
                  <div className="field">
                    <label htmlFor="demoTitle">Demo title<Req /></label>
                    <input
                      id="demoTitle"
                      name="demoTitle"
                      placeholder="What are you demoing?"
                      maxLength={SUBMISSION_FIELD_LIMITS.demoTitle}
                      required
                      aria-invalid={fieldLimitIssue?.field === "demoTitle" || undefined}
                      aria-describedby={fieldLimitIssue?.field === "demoTitle" ? "demoTitle-limit-error" : undefined}
                    />
                    <FieldLimitError field="demoTitle" issue={fieldLimitIssue} />
                  </div>
                </div>
              </>
            )}

            <div className="form-row">
              <div className="field">
                <label htmlFor="description">{isHackathon ? "Project description" : "Short description"}<Req /></label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  placeholder={
                    isHackathon
                      ? "One or two lines: what it does, the problem it solves, what makes it different"
                      : "One or two lines about what you will show"
                  }
                  maxLength={SUBMISSION_FIELD_LIMITS.description}
                  required
                  aria-invalid={fieldLimitIssue?.field === "description" || undefined}
                  aria-describedby={fieldLimitIssue?.field === "description" ? "description-limit-error" : undefined}
                />
                <FieldLimitError field="description" issue={fieldLimitIssue} />
              </div>
            </div>

            <div className="form-row">
              <TrackPicker tracks={stage.event.tracks} value={trackIds} onChange={setTrackIds} disabled={isSubmitting} />
            </div>

            {isHackathon ? (
              <div className="form-row form-row-2">
                <div className="field">
                  <label htmlFor="githubUrl">Public GitHub repository<Req /></label>
                  <input
                    id="githubUrl"
                    name="githubUrl"
                    type="url"
                    inputMode="url"
                    placeholder="https://github.com/team/project"
                    maxLength={MAX_GITHUB_REPOSITORY_URL_LENGTH}
                    required
                    aria-invalid={Boolean(githubError) || undefined}
                    aria-describedby={describedByIds("github-help", githubError && "github-error")}
                  />
                  <span id="github-help" className="muted form-help">
                    Everything judges need to understand and run it must be in the README.
                  </span>
                  {githubError ? <span id="github-error" className="form-error">{githubError}</span> : null}
                </div>
                <div className="field">
                  <label htmlFor="videoUrl">Demo video link<Req /></label>
                  <input
                    id="videoUrl"
                    name="videoUrl"
                    type="url"
                    inputMode="url"
                    placeholder="YouTube, Loom or Google Drive link"
                    maxLength={MAX_HACKATHON_VIDEO_URL_LENGTH}
                    required
                    aria-invalid={Boolean(videoError) || undefined}
                    aria-describedby={describedByIds("video-help", videoError && "video-error")}
                  />
                  <span id="video-help" className="muted form-help">
                    Up to 90 seconds of the working product, no slides. Judges must be able to open it without asking for access.
                  </span>
                  {videoError ? <span id="video-error" className="form-error">{videoError}</span> : null}
                </div>
              </div>
            ) : (
              <div className="form-row">
                <div className="field">
                  <span className="field-label" id="demoer-socials-label">Socials</span>
                  <SocialFields error={personErrors[DEMOER_ROW]?.socials} label="Your" rowId={DEMOER_ROW} />
                  <span className="muted form-help">Add at least one so the event team can connect with you after.</span>
                </div>
              </div>
            )}
          </div>

          {isHackathon ? (
            <div className="form-section">
              <div className="form-section-heading">
                <h2 id="team-members-label">Team members<Req /></h2>
                <span className="muted form-help">
                  The first person presents. Up to {MAX_ADDITIONAL_TEAM_MEMBERS + 1} people.
                </span>
              </div>
              <div className="person-list" role="group" aria-labelledby="team-members-label">
                {personRowIds.map((rowId, index) => {
                  const errors = personErrors[rowId] ?? {};
                  const isPresenter = index === 0;
                  const label = isPresenter ? "Presenter" : `Member ${index + 1}`;
                  return (
                    <div className="person-card" key={rowId}>
                      <div className="person-card-header">
                        <strong>{label}</strong>
                        {!isPresenter ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${label.toLowerCase()}`}
                            onClick={() => removePerson(rowId)}
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </div>
                      <div className="form-row form-row-3">
                        <div className="field">
                          <label htmlFor={`name-${rowId}`}>Name</label>
                          <input
                            id={`name-${rowId}`}
                            name={`name-${rowId}`}
                            placeholder="Sam Lee"
                            autoComplete={isPresenter ? "name" : "off"}
                            maxLength={TEAM_CONTACT_FIELD_LIMITS.name}
                            required
                            aria-invalid={Boolean(errors.name) || undefined}
                            aria-describedby={errors.name ? `name-${rowId}-error` : undefined}
                          />
                          {errors.name ? <span id={`name-${rowId}-error`} className="form-error">{errors.name}</span> : null}
                        </div>
                        {emailField(rowId, "Email", isPresenter ? "email" : "off")}
                        <div className="field">
                          <label htmlFor={`whatsapp-${rowId}`}>WhatsApp number</label>
                          <input
                            id={`whatsapp-${rowId}`}
                            name={`whatsapp-${rowId}`}
                            type="tel"
                            inputMode="tel"
                            placeholder="+44 7700 900123"
                            autoComplete={isPresenter ? "tel" : "off"}
                            maxLength={TEAM_CONTACT_FIELD_LIMITS.whatsappPhone}
                            required
                            aria-invalid={Boolean(errors.whatsappPhone) || undefined}
                            aria-describedby={errors.whatsappPhone ? `whatsapp-${rowId}-error` : undefined}
                          />
                          {errors.whatsappPhone ? <span id={`whatsapp-${rowId}-error`} className="form-error">{errors.whatsappPhone}</span> : null}
                        </div>
                      </div>
                      <SocialFields error={errors.socials} label={label} rowId={rowId} />
                    </div>
                  );
                })}
                <div className="person-list-footer">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={personRowIds.length >= MAX_ADDITIONAL_TEAM_MEMBERS + 1}
                    onClick={() => {
                      const nextId = nextPersonRowId.current;
                      nextPersonRowId.current += 1;
                      setPersonRowIds((rows) => [...rows, nextId]);
                    }}
                  >
                    <Plus />
                    Add team member
                  </Button>
                  <span className="muted form-help">The presenter needs at least one social link.</span>
                </div>
              </div>
            </div>
          ) : null}

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
                ? "Submitting..."
                : isHackathon
                  ? "Submit project"
                  : "Join the queue"}
            </button>
          </div>
        </form>
        )}
      </section>
    </main>
  );
}

function describedByIds(...ids: Array<string | false | undefined>) {
  return ids.filter(Boolean).join(" ") || undefined;
}
