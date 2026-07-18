"use client";

import { FormEvent, ReactNode, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { Skeleton } from "@/app/Skeleton";
import {
  SUBMISSION_FIELD_LIMITS,
  firstFieldLimitError,
  isValidLinkedin,
  isValidPhone,
  isValidTwitter,
} from "@/lib/validation";
import { Brand } from "@/app/Brand";
import { shouldShowMeetAvailabilityCopy } from "@/lib/event-state";

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
  candidate: "Submitted, waiting for finalist selection",
  queued: "Your team is listed as a finalist",
  done: "Presentation complete",
};

function FieldError({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--app-bad)", fontSize: 13, fontWeight: 600 }}>{children}</span>;
}

export default function ParticipantStatusPage() {
  const params = useParams<{ slug: string; token: string }>();
  const participant = useQuery(api.events.getParticipant, {
    slug: params.slug,
    participantToken: params.token,
  });
  const editContact = useMutation(api.events.editParticipantContact);
  const withdraw = useMutation(api.events.withdrawSubmission);
  const [message, setMessage] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [twitterError, setTwitterError] = useState("");
  const [linkedinError, setLinkedinError] = useState("");
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

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? "").trim();
    const phone = read("phone");
    const twitter = read("twitter");
    const linkedin = read("linkedin");
    const lengthError = firstFieldLimitError({
      phone,
      email: read("email"),
      twitter,
      linkedin,
    });

    setMessage("");
    setPhoneError("");
    setTwitterError("");
    setLinkedinError("");
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
    if (!twitter && !linkedin) {
      setSocialError("Keep at least one of Twitter/X or LinkedIn so the team can reach you.");
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
      slug: params.slug,
      participantToken: params.token,
      phone,
      email: read("email") || undefined,
      twitter: twitter || undefined,
      linkedin: linkedin || undefined,
    });
    setMessage("Contact info updated.");
  }

  async function withdrawDemo() {
    await withdraw({ slug: params.slug, participantToken: params.token });
    setMessage("Your submission has been withdrawn.");
  }

  return (
    <main className="narrow-page">
      <section className="panel panel-pad" style={{ width: "min(760px, 100%)" }}>
        <Brand label={participant.event.name} />
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
          {participant.submission.category ? (
            <span className="pill">{participant.submission.category}</span>
          ) : null}
        </div>

        <p className="lead">{participant.submission.description}</p>

        {participant.event.eventType === "hackathon" ? (
          <div className="hackathon-status-details">
            <div>
              <strong>Team</strong>
              <span>
                {[participant.submission.name, ...participant.submission.teamMembers].join(", ")}
              </span>
            </div>
            <div>
              <strong>Project video</strong>
              {participant.submission.videoUrl ? (
                <a href={participant.submission.videoUrl} target="_blank" rel="noreferrer">
                  Open video
                </a>
              ) : (
                <span>Video retention period ended</span>
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

        <h2 style={{ marginTop: 24 }}>Contact info</h2>
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

          {socialError ? <FieldError>{socialError}</FieldError> : null}

          <div className="actions">
            <button className="button" type="submit">
              Save contact
            </button>
            <button className="button danger" type="button" onClick={withdrawDemo}>
              Withdraw
            </button>
          </div>
        </form>

        {message ? <p className="muted" style={{ marginTop: 14 }}>{message}</p> : null}
      </section>
    </main>
  );
}
