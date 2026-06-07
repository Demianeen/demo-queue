"use client";

import { FormEvent, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { absoluteUrl, adminPath, stagePath, submissionPath } from "@/lib/routes";
import { randomToken, slugify } from "@/lib/tokens";

export default function HomePage() {
  const createEvent = useMutation(api.events.createEvent);
  const [name, setName] = useState("Demo Night");
  const [meetUrl, setMeetUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [created, setCreated] = useState<null | { slug: string; adminToken: string }>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    const slug = slugify(name);
    const adminToken = randomToken(32);

    await createEvent({
      name,
      slug,
      meetUrl,
      adminToken,
    });

    setCreated({ slug, adminToken });
    setIsCreating(false);
  }

  return (
    <main className="narrow-page">
      <section className="panel panel-pad" style={{ width: "min(760px, 100%)" }}>
        <p className="eyebrow">Demo Queue</p>
        <h1>Run a fair demo queue without exposing private details.</h1>
        <p className="lead">
          Create an event, share the QR code on the stage screen, and control the live queue from a
          private admin link.
        </p>

        <form className="form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="name">Event name</label>
            <input id="name" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>

          <div className="field">
            <label htmlFor="meetUrl">Google Meet link</label>
            <input
              id="meetUrl"
              placeholder="https://meet.google.com/..."
              type="url"
              value={meetUrl}
              onChange={(event) => setMeetUrl(event.target.value)}
              required
            />
          </div>

          <div className="actions">
            <button className="button" disabled={isCreating} type="submit">
              {isCreating ? "Creating..." : "Create event"}
            </button>
          </div>
        </form>

        {created ? (
          <div className="link-stack">
            <h2>Event links</h2>
            <div className="copy-line">Admin: {absoluteUrl(adminPath(created.slug, created.adminToken))}</div>
            <div className="copy-line">Stage: {absoluteUrl(stagePath(created.slug))}</div>
            <div className="copy-line">Submission form: {absoluteUrl(submissionPath(created.slug))}</div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
