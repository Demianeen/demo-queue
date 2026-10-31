"use client";

import { eventRootProps } from "@/lib/event-theme-contract";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { CheckIcon } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useParams } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { Skeleton } from "@/app/Skeleton";
import {
  SUBMISSION_FIELD_LIMITS,
  firstFieldLimitError,
  isValidGithubProfile,
  isValidLinkedin,
  isValidPhone,
  isValidTwitter,
  socialLinksError,
} from "@/lib/validation";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Brand } from "@/app/Brand";
import { shouldShowMeetAvailabilityCopy } from "@/lib/event-state";
import { AstraHero } from "@/components/AstraHero";
import { DevDayHero } from "@/components/DevDayHero";
import { OutpostHero } from "@/components/OutpostHero";
import { cn } from "@/lib/utils";
import { browserClientId } from "@/lib/client-id";
import { isOutpostStyle, normalizeVisualStyle } from "@/lib/visual-style";
import { displayUrl, participantCelebration, participantHeading, participantSteps, type StatusStep } from "@/lib/participant-status";
import { Celebration } from "@/components/results/Celebration";

/** Where the team is, as numbered steps; done steps get a check. */
function StatusSteps({ steps }: { steps: StatusStep[] }) {
  return (
    <ol className="status-steps" aria-label="Progress">
      {steps.map((step, index) => (
        <li key={step.label} data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="status-step-mark" aria-hidden="true">{step.state === "done" ? <CheckIcon size={12} strokeWidth={3} /> : index + 1}</span>
          {step.label}
          {step.state === "done" ? <span className="sr-only"> (done)</span> : null}
        </li>
      ))}
    </ol>
  );
}

function FieldError({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--app-bad)", fontSize: 13, fontWeight: 600 }}>{children}</span>;
}

type MemberSocials = {
  id: Id<"teamMembers">;
  name: string;
  twitter?: string;
  linkedin?: string;
  githubProfile?: string;
};

/** One team member's socials as the team typed them, editable here. */
function MemberSocialsForm({ slug, token, member }: { slug: string; token: string; member: MemberSocials }) {
  const save = useMutation(api.events.editTeamMemberSocials);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? "").trim();
    const values = { twitter: read("twitter"), linkedin: read("linkedin"), githubProfile: read("githubProfile") };
    const problem = socialLinksError(values) || firstFieldLimitError(values);
    setError(problem);
    if (problem) return;
    setState("saving");
    try {
      await save({ slug, participantToken: token, memberId: member.id, ...values });
      setState("saved");
    } catch {
      setState("idle");
      setError("Could not save. Try again.");
    }
  }
  const prefix = `member-${member.id}`;
  return (
    <form className="member-socials" onSubmit={submit}>
      <strong>{member.name}</strong>
      <div className="member-socials-fields">
        <div className="field">
          <label htmlFor={`${prefix}-twitter`}>X</label>
          <input defaultValue={member.twitter ?? ""} id={`${prefix}-twitter`} maxLength={SUBMISSION_FIELD_LIMITS.twitter} name="twitter" placeholder="@handle" />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-linkedin`}>LinkedIn</label>
          <input defaultValue={member.linkedin ?? ""} id={`${prefix}-linkedin`} maxLength={SUBMISSION_FIELD_LIMITS.linkedin} name="linkedin" placeholder="linkedin.com/in/..." />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-github`}>GitHub</label>
          <input defaultValue={member.githubProfile ?? ""} id={`${prefix}-github`} maxLength={SUBMISSION_FIELD_LIMITS.githubProfile} name="githubProfile" placeholder="username" />
        </div>
      </div>
      <div className="member-socials-actions">
        <button className="button secondary" disabled={state === "saving"} type="submit">
          {state === "saving" ? "Saving..." : "Save"}
        </button>
        {state === "saved" ? <span className="muted" role="status">Saved.</span> : null}
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    </form>
  );
}

type ResubmitResult = FunctionReturnType<typeof api.events.resubmitWithdrawnSubmission>;

export type ParticipantPageProps = {
  slug: string;
  token: string;
  participant: FunctionReturnType<typeof api.events.getParticipant> | undefined;
  editContact: (args: FunctionArgs<typeof api.events.editParticipantContact>) => Promise<unknown>;
  withdraw: (args: FunctionArgs<typeof api.events.withdrawSubmission>) => Promise<unknown>;
  resubmit: (args: FunctionArgs<typeof api.events.resubmitWithdrawnSubmission>) => Promise<ResubmitResult>;
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  const message = error instanceof Error ? error.message : "";
  return message.includes("ConvexError: ") ? message.split("ConvexError: ").pop()!.split("\n")[0] : fallback;
}

/**
 * Withdraw, asked first inline, and Submit again (Proposed) while
 * submissions are open: the same entry comes back with the same status link.
 */
function WithdrawPanel({ slug, token, participant, withdraw, resubmit, confirming, setConfirming, place }: Pick<ParticipantPageProps, "slug" | "token" | "withdraw" | "resubmit"> & {
  participant: NonNullable<ParticipantPageProps["participant"]>;
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  /** "top" under the description: the withdrawn state and the question. "bottom": the Withdraw button. */
  place: "top" | "bottom";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { demoTitle } = participant.submission;
  const hackathon = participant.event.eventType === "hackathon";
  const closed = participant.event.submissionsClosed;

  async function confirmWithdraw() {
    setBusy(true);
    setError(null);
    try {
      await withdraw({ slug, participantToken: token });
      setConfirming(false);
    } catch (failure) {
      setError(errorMessage(failure, "Could not withdraw. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function submitAgain() {
    setBusy(true);
    setError(null);
    try {
      const result = await resubmit({ slug, participantToken: token, clientId: browserClientId() });
      if (!result.restored && result.reason === "email_taken") setError(result.message);
    } catch (failure) {
      setError(errorMessage(failure, "Could not submit again. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error ? <p role="alert" className="withdraw-error">{error}</p> : null;

  if (participant.submission.status === "withdrawn") {
    if (place !== "top") return null;
    if (closed) {
      return <div className="copy-line withdraw-panel" role="status"><strong>Submissions have closed.</strong> {demoTitle} stays withdrawn.</div>;
    }
    if (!participant.submission.canSubmitAgain) {
      return <div className="copy-line withdraw-panel" role="status"><strong>{demoTitle} was withdrawn.</strong> Ask the event team if it should come back.</div>;
    }
    return (
      <div className="copy-line withdraw-panel" role="region" aria-label="Withdrawn">
        <p><strong>You withdrew {demoTitle}.</strong> Submissions are still open, so you can submit it again with everything as it was, on this same status link.</p>
        {errorLine}
        <div className="actions">
          <button className="button" type="button" disabled={busy} onClick={() => void submitAgain()}>{busy ? "Submitting again…" : "Submit again"}</button>
        </div>
      </div>
    );
  }
  if (closed || !participant.submission.canWithdraw) return null;
  if (!confirming) {
    if (place !== "bottom") return null;
    return (
      <div className="actions">
        <button className="button danger" type="button" onClick={() => { setError(null); setConfirming(true); }}>Withdraw</button>
      </div>
    );
  }
  if (place !== "top") return null;
  return (
    <div className="copy-line withdraw-panel" role="region" aria-label="Withdraw">
      <p>
        <strong>Withdraw {demoTitle}?</strong>{" "}
        {hackathon ? "It leaves judging, and judges stop seeing it." : "It leaves the lineup, and the event team stop seeing it in the queue."}{" "}
        You can submit it again while submissions are open.
      </p>
      {errorLine}
      <div className="actions">
        <button className="button danger" type="button" disabled={busy} onClick={() => void confirmWithdraw()}>{busy ? "Withdrawing…" : `Withdraw ${demoTitle}`}</button>
        <button className="button ghost" type="button" disabled={busy} autoFocus onClick={() => setConfirming(false)}>Keep it</button>
      </div>
    </div>
  );
}

export default function ConnectedParticipantStatusPage() {
  const params = useParams<{ slug: string; token: string }>();
  const participant = useQuery(api.events.getParticipant, {
    slug: params.slug,
    participantToken: params.token,
  });
  const editContact = useMutation(api.events.editParticipantContact);
  const withdraw = useMutation(api.events.withdrawSubmission);
  const resubmit = useMutation(api.events.resubmitWithdrawnSubmission);

  return (
    <ParticipantPage
      slug={params.slug}
      token={params.token}
      participant={participant}
      editContact={editContact}
      withdraw={withdraw}
      resubmit={resubmit}
    />
  );
}

export function ParticipantPage({
  slug,
  token,
  participant,
  editContact,
  withdraw,
  resubmit,
}: ParticipantPageProps) {
  const [message, setMessage] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [twitterError, setTwitterError] = useState("");
  const [linkedinError, setLinkedinError] = useState("");
  const [githubError, setGithubError] = useState("");
  const [socialError, setSocialError] = useState("");
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  // The contact form opens from Edit, or straight away from a "#contact" link.
  const [editingContact, setEditingContact] = useState(false);
  useEffect(() => {
    if (window.location.hash === "#contact") setEditingContact(true);
  }, []);

  if (!participant) {
    return (
      <main className="narrow-page">
        <section className="panel panel-pad" style={{ width: "min(760px, 100%)" }}>
          <Skeleton w={110} h={12} radius={6} style={{ marginBottom: 18 }} />
          <Skeleton w="60%" h={34} radius={10} style={{ marginBottom: 18 }} />
          <Skeleton w={300} h={22} radius={999} style={{ marginBottom: 18 }} />
          <Skeleton w={180} h={26} radius={999} style={{ marginBottom: 22 }} />
          <Skeleton h={16} style={{ marginBottom: 10 }} />
          <Skeleton w="80%" h={16} style={{ marginBottom: 28 }} />
          <Skeleton h={46} radius={12} style={{ marginBottom: 12 }} />
          <Skeleton h={46} radius={12} />
        </section>
      </main>
    );
  }

  const visualStyle = normalizeVisualStyle(participant.event.visualStyle);
  const isOutpost = isOutpostStyle(visualStyle);
  const isAstra = visualStyle === "astra";
  const isDevDay = visualStyle === "devday";

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? "").trim();
    const phone = read("phone");
    const twitter = read("twitter");
    const linkedin = read("linkedin");
    const githubProfile = read("githubProfile");
    const lengthError = firstFieldLimitError({
      phone,
      email: read("email"),
      twitter,
      linkedin,
      githubProfile,
    });

    setMessage("");
    setPhoneError("");
    setTwitterError("");
    setLinkedinError("");
    setGithubError("");
    setSocialError("");

    let valid = true;
    if (lengthError) {
      setSocialError(lengthError);
      valid = false;
    }
    if (!isValidPhone(phone)) {
      setPhoneError("Enter a valid phone number (7-15 digits).");
      valid = false;
    }
    if (!twitter && !linkedin && !githubProfile) {
      setSocialError("Keep at least one of Twitter/X, LinkedIn or GitHub so the team can reach you.");
      valid = false;
    }
    if (githubProfile && !isValidGithubProfile(githubProfile)) {
      setGithubError("Enter a GitHub username or github.com link.");
      valid = false;
    }
    if (twitter && !isValidTwitter(twitter)) {
      setTwitterError("Enter an @handle or an x.com / twitter.com link.");
      valid = false;
    }
    if (linkedin && !isValidLinkedin(linkedin)) {
      setLinkedinError("Enter a linkedin.com/in/... link.");
      valid = false;
    }
    if (!valid) {
      return;
    }

    try {
      await editContact({
        slug,
        participantToken: token,
        phone,
        email: read("email") || undefined,
        twitter: twitter || undefined,
        linkedin: linkedin || undefined,
        githubProfile,
      });
    } catch {
      setSocialError("Could not save. Try again.");
      return;
    }
    setMessage("Contact info updated.");
    setEditingContact(false);
  }

  const hackathon = participant.event.eventType === "hackathon";
  const statusInput = { eventType: participant.event.eventType, status: participant.submission.status, finalist: participant.submission.finalist, phase: participant.event.phase };
  const celebration = participantCelebration({ ...statusInput, placement: participant.submission.placement, demoTitle: participant.submission.demoTitle });
  const withdrawProps = { slug, token, participant, withdraw, resubmit, confirming: confirmingWithdraw, setConfirming: setConfirmingWithdraw };
  const contactLine = [participant.submission.email, participant.submission.phone].filter(Boolean).join(" · ");

  return (
    <main data-event-style={visualStyle} {...eventRootProps(visualStyle, participant.event.theme)} className={isDevDay ? "devday-public-page" : isAstra ? "astra-public-page" : isOutpost ? "outpost-public-page" : "narrow-page"} data-visual-style={visualStyle}>
      {isDevDay ? (
        <DevDayHero eventName={participant.event.name} eventType={participant.event.eventType} mode="status" />
      ) : null}
      {isAstra ? (
        <AstraHero eventName={participant.event.name} eventType={participant.event.eventType} mode="status" />
      ) : null}
      {isOutpost ? (
        <OutpostHero
          eventName={participant.event.name}
          eventType={participant.event.eventType}
          mode="status"
        />
      ) : null}
      <section
        className={cn("panel panel-pad", isOutpost && "outpost-content", isAstra && "astra-content", isDevDay && "devday-content")}
        style={isOutpost || isAstra || isDevDay ? undefined : { width: "min(760px, 100%)" }}
      >
        {isOutpost || isAstra || isDevDay ? null : visualStyle === "neutral" ? null : <Brand label={participant.event.name} />}
        {isOutpost || isAstra || isDevDay ? null : (
          <p className="status-kicker">{hackathon ? "Project status" : "Demo status"} · {participant.event.name}</p>
        )}
        {isAstra ? <p className="astra-eyebrow">{participant.event.name}</p> : null}
        {isDevDay ? (
          <p className="devday-eyebrow">{participant.event.eventType === "hackathon" ? "Community hackathon" : "Demo queue"} / Your submission</p>
        ) : null}
        {isOutpost ? (
          <p className="outpost-event-kicker">
            {participant.event.eventType === "hackathon" ? "Project status" : "Demo status"} · {participant.event.name}
          </p>
        ) : null}
        <h1>{participantHeading(statusInput)}</h1>

        {celebration ? <Celebration celebration={celebration} /> : null}

        <StatusSteps steps={participantSteps(statusInput)} />

        <div className="status-strip">
          <span className="pill green">{participant.submission.demoTitle}</span>
          {participant.submission.teamName ? (
            <span className="pill">{participant.submission.teamName}</span>
          ) : null}
          {participant.submission.tracks.map((track) => (
            <span className="pill" key={track}>{track}</span>
          ))}
        </div>

        <p className="lead">{participant.submission.description}</p>

        <WithdrawPanel {...withdrawProps} place="top" />

        <dl className="status-details">
          {hackathon ? (
            <div>
              <dt>Team</dt>
              <dd>{[participant.submission.name, ...participant.submission.teamMembers].join(", ")}</dd>
            </div>
          ) : null}
          {hackathon ? (
            <div>
              <dt>Demo video</dt>
              <dd>
                {participant.submission.videoUrl ? (
                  <a href={participant.submission.videoUrl} target="_blank" rel="noreferrer">Open video</a>
                ) : (
                  "Video retention period ended"
                )}
              </dd>
            </div>
          ) : null}
          {hackathon ? (
            <div>
              <dt>Repository</dt>
              <dd>
                {participant.submission.githubUrl ? (
                  <a href={participant.submission.githubUrl} target="_blank" rel="noreferrer">{displayUrl(participant.submission.githubUrl)}</a>
                ) : (
                  "Not provided"
                )}
              </dd>
            </div>
          ) : null}
          <div id="contact">
            <dt>Contact</dt>
            <dd>
              <span>{contactLine || "Not provided"}</span>
              {editingContact ? null : (
                <button className="status-edit" type="button" onClick={() => { setMessage(""); setEditingContact(true); }} aria-label="Edit contact info">Edit</button>
              )}
            </dd>
          </div>
        </dl>
        {message ? <p className="muted" role="status">{message}</p> : null}

        {participant.meetUrl ? (
          <a
            className="button"
            href={participant.meetUrl}
            target="_blank"
            rel="noreferrer"
            style={{ marginTop: 4 }}
          >
            Join now
          </a>
        ) : shouldShowMeetAvailabilityCopy(participant.submission.status) ? (
          <div className="copy-line">
            The Meet link appears here once you&apos;re listed as a live presenter.
          </div>
        ) : null}

        {editingContact ? <>
        <h2 style={{ marginTop: 8 }}>Contact info</h2>
        <form className="form" onSubmit={saveContact}>
          <div className="field">
            <label htmlFor="phone">Phone</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              placeholder="+1 555 123 4567"
              defaultValue={participant.submission.phone}
              maxLength={SUBMISSION_FIELD_LIMITS.phone}
              required
            />
            {phoneError ? <FieldError>{phoneError}</FieldError> : null}
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              defaultValue={participant.submission.email ?? ""}
              maxLength={SUBMISSION_FIELD_LIMITS.email}
            />
          </div>

          <div className="field">
            <label htmlFor="twitter">Twitter/X</label>
            <input
              id="twitter"
              name="twitter"
              placeholder="@handle or x.com/handle"
              defaultValue={participant.submission.twitter ?? ""}
              maxLength={SUBMISSION_FIELD_LIMITS.twitter}
            />
            {twitterError ? <FieldError>{twitterError}</FieldError> : null}
          </div>

          <div className="field">
            <label htmlFor="linkedin">LinkedIn</label>
            <input
              id="linkedin"
              name="linkedin"
              placeholder="linkedin.com/in/you"
              defaultValue={participant.submission.linkedin ?? ""}
              maxLength={SUBMISSION_FIELD_LIMITS.linkedin}
            />
            {linkedinError ? <FieldError>{linkedinError}</FieldError> : null}
          </div>

          <div className="field">
            <label htmlFor="githubProfile">GitHub</label>
            <input
              id="githubProfile"
              name="githubProfile"
              placeholder="username or github.com/username"
              defaultValue={participant.submission.githubProfile ?? ""}
              maxLength={SUBMISSION_FIELD_LIMITS.githubProfile}
            />
            {githubError ? <FieldError>{githubError}</FieldError> : null}
          </div>

          {socialError ? <FieldError>{socialError}</FieldError> : null}

          <div className="actions">
            <button className="button" type="submit">
              Save contact
            </button>
            <button className="button ghost" type="button" onClick={() => setEditingContact(false)}>
              Cancel
            </button>
          </div>
        </form>
        </> : null}

        {participant.submission.teamMemberSocials.length > 0 ? (
          <>
            <h2 id="team-socials" style={{ marginTop: 24 }}>Team socials</h2>
            <p className="muted form-help">Add or correct each team member&apos;s X, LinkedIn and GitHub.</p>
            <div className="member-socials-list">
              {participant.submission.teamMemberSocials.map((member) => (
                <MemberSocialsForm key={member.id} member={member} slug={slug} token={token} />
              ))}
            </div>
            {participant.event.lumaLinked ? (
              <p className="muted form-help" style={{ marginTop: 10 }}>Socials left blank may be filled from Luma registrations for the organisers.</p>
            ) : null}
          </>
        ) : null}

        <WithdrawPanel {...withdrawProps} place="bottom" />
      </section>
    </main>
  );
}
