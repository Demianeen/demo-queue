"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "../../../../convex/_generated/api";

const statusLabels: Record<string, string> = {
  candidate: "Submitted, waiting to be added to the lineup",
  queued: "You are in the lineup",
  hidden: "Hidden by event team",
  up_next: "You are up next",
  current: "You are presenting now",
  done: "Demo complete",
  no_show: "Marked as no-show",
  withdrawn: "Withdrawn",
};

export default function ParticipantStatusPage() {
  const params = useParams<{ slug: string; token: string }>();
  const participant = useQuery(api.events.getParticipant, {
    slug: params.slug,
    participantToken: params.token,
  });
  const editContact = useMutation(api.events.editParticipantContact);
  const withdraw = useMutation(api.events.withdrawSubmission);
  const [message, setMessage] = useState("");

  if (!participant) {
    return (
      <main className="narrow-page">
        <section className="panel panel-pad">Loading...</section>
      </main>
    );
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await editContact({
      slug: params.slug,
      participantToken: params.token,
      phone: String(form.get("phone") || ""),
      email: String(form.get("email") || "") || undefined,
      twitter: String(form.get("twitter") || "") || undefined,
      linkedin: String(form.get("linkedin") || "") || undefined,
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
        <p className="eyebrow">{participant.event.name}</p>
        <h1>{statusLabels[participant.submission.status] ?? participant.submission.status}</h1>

        <div className="status-strip">
          <span className="pill green">{participant.submission.demoTitle}</span>
          {participant.submission.category ? (
            <span className="pill">{participant.submission.category}</span>
          ) : null}
        </div>

        <p className="lead">{participant.submission.description}</p>

        {participant.meetUrl ? (
          <div className="copy-line">
            Join now: <a href={participant.meetUrl}>{participant.meetUrl}</a>
          </div>
        ) : (
          <div className="copy-line">
            The Meet link is hidden until you are up next or presenting.
          </div>
        )}

        <h2 style={{ marginTop: 24 }}>Contact info</h2>
        <form className="form" onSubmit={saveContact}>
          <div className="field">
            <label htmlFor="phone">Phone</label>
            <input id="phone" name="phone" defaultValue={participant.submission.phone} required />
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" defaultValue={participant.submission.email ?? ""} />
          </div>

          <div className="field">
            <label htmlFor="twitter">Twitter/X</label>
            <input id="twitter" name="twitter" defaultValue={participant.submission.twitter ?? ""} />
          </div>

          <div className="field">
            <label htmlFor="linkedin">LinkedIn</label>
            <input id="linkedin" name="linkedin" defaultValue={participant.submission.linkedin ?? ""} />
          </div>

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
