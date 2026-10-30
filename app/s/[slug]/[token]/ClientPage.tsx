"use client";

import { eventRootProps } from "@/lib/event-theme-contract";
import { FormEvent, ReactNode, useState } from "react";
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

const statusLabels: Record<string, string> = {
  candidate: "Submitted, waiting to be added as a demoer",
  queued: "You are listed as a demoer",
  hidden: "Hidden by event team",
  up_next: "You are up next",
  current: "You are presenting now",
  done: "Demo complete",
  no_show: "Marked as no-show",
  withdrawn: "Withdrawn",
};

const hackathonStatusLabels: Record<string, string> = {
  ...statusLabels,
  candidate: "Submitted, waiting for judging",
  queued: "Scheduled to present",
  done: "Presentation complete",
};

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
function WithdrawPanel({ slug, token, participant, withdraw, resubmit }: Pick<ParticipantPageProps, "slug" | "token" | "withdraw" | "resubmit"> & { participant: NonNullable<ParticipantPageProps["participant"]> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; statusPath?: string | null } | null>(null);
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
      setError({ message: errorMessage(failure, "Could not withdraw. Try again.") });
    } finally {
      setBusy(false);
    }
  }

  async function submitAgain() {
    setBusy(true);
    setError(null);
    try {
      const result = await resubmit({ slug, participantToken: token, clientId: browserClientId() });
      if (!result.restored && result.reason === "email_taken") setError({ message: result.message, statusPath: result.statusPath });
    } catch (failure) {
      setError({ message: errorMessage(failure, "Could not submit again. Try again.") });
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error ? (
    <p role="alert" className="withdraw-error">
      {error.message}
      {error.statusPath ? <> <a href={error.statusPath}>Open that entry&apos;s status page</a></> : null}
    </p>
  ) : null;

  if (participant.submission.status === "withdrawn") {
    if (closed) {
      return <div className="copy-line withdraw-panel" role="status"><strong>Submissions have closed.</strong> {demoTitle} stays withdrawn.</div>;
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
  if (closed) return null;
  if (!confirming) {
    return (
      <div className="actions">
        <button className="button danger" type="button" onClick={() => { setError(null); setConfirming(true); }}>Withdraw</button>
      </div>
    );
  }
  return (
    <div className="copy-line withdraw-panel" role="region" aria-label="Withdraw">
      <p>
        <strong>Withdraw {demoTitle}?</strong>{" "}
        {hackathon ? "It leaves the lineup and judging, and judges stop seeing it." : "It leaves the lineup, and the event team stop seeing it in the queue."}{" "}
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

  if (!participant) {
    return (
      <main className="narrow-page">
        <section className="panel panel-pad" style={{ width: "min(760px, 100%)" }}>
          <Skeleton w={110} h={12} radius={6} style={{ marginBottom: 18 }} />
          <Skeleton w="60%" h={34} radius={10} style={{ marginBottom: 18 }} />
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

    await editContact({
      slug,
      participantToken: token,
      phone,
      email: read("email") || undefined,
      twitter: twitter || undefined,
      linkedin: linkedin || undefined,
      githubProfile,
    });
    setMessage("Contact info updated.");
  }

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
        {isOutpost || isAstra || isDevDay ? null : visualStyle === "neutral" ? <p className="neutral-event-name">{participant.event.name}</p> : <Brand label={participant.event.name} />}
        {isAstra ? <p className="astra-eyebrow">{participant.event.name}</p> : null}
        {isDevDay ? (
          <p className="devday-eyebrow">{participant.event.eventType === "hackathon" ? "Community hackathon" : "Demo queue"} / Your submission</p>
        ) : null}
        {isOutpost ? (
          <p className="outpost-event-kicker">
            {participant.event.eventType === "hackathon" ? "Project status" : "Demo status"} · {participant.event.name}
          </p>
        ) : null}
        <h1>
          {(participant.event.eventType === "hackathon" ? hackathonStatusLabels : statusLabels)[
            participant.submission.status
          ] ?? participant.submission.status}
        </h1>

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

        {participant.submission.status === "withdrawn" ? (
          <WithdrawPanel slug={slug} token={token} participant={participant} withdraw={withdraw} resubmit={resubmit} />
        ) : null}

        {participant.submission.finalist ? (
          <div className="copy-line">Your team was selected as a finalist.</div>
        ) : null}

        {participant.event.eventType === "hackathon" ? (
          <div className="hackathon-status-details">
            <div>
              <strong>Team</strong>
              <span>
                {[participant.submission.name, ...participant.submission.teamMembers].join(", ")}
              </span>
            </div>
            <div>
              <strong>Demo video</strong>
              {participant.submission.videoUrl ? (
                <a href={participant.submission.videoUrl} target="_blank" rel="noreferrer">
                  Open video
                </a>
              ) : (
                <span>Video retention period ended</span>
              )}
            </div>
            <div>
              <strong>GitHub repository</strong>
              {participant.submission.githubUrl ? (
                <a href={participant.submission.githubUrl} target="_blank" rel="noreferrer">
                  Open repository
                </a>
              ) : (
                <span>Not provided</span>
              )}
            </div>
          </div>
        ) : null}

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

        <h2 id="contact" style={{ marginTop: 24 }}>Contact info</h2>
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
          </div>
        </form>

        {message ? <p className="muted" style={{ marginTop: 14 }}>{message}</p> : null}

        {participant.submission.status !== "withdrawn" ? (
          <WithdrawPanel slug={slug} token={token} participant={participant} withdraw={withdraw} resubmit={resubmit} />
        ) : null}

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
      </section>
    </main>
  );
}
