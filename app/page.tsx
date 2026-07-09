"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { absoluteUrl, adminPath, stagePath, submissionPath } from "@/lib/routes";
import { randomToken, slugify } from "@/lib/tokens";
import { Brand } from "./Brand";

type SavedEvent = {
  name: string;
  slug: string;
  adminToken: string;
  createdAt: number;
};

const STORAGE_KEY = "demo-queue:events";

function loadSavedEvents(): SavedEvent[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedEvent[]) : [];
  } catch {
    return [];
  }
}

export default function HomePage() {
  const createEvent = useMutation(api.events.createEvent);
  const [name, setName] = useState("");
  const [meetUrl, setMeetUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [savedEvents, setSavedEvents] = useState<SavedEvent[]>([]);

  // Read localStorage only after mount so server and client HTML match.
  useEffect(() => {
    setSavedEvents(loadSavedEvents());
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    const slug = slugify(name);
    const adminToken = randomToken(32);

    try {
      await createEvent({ name, slug, meetUrl, adminToken });
      // Only persist after the mutation succeeds, so a failed create (e.g.
      // duplicate slug) never leaves a phantom event in localStorage.
      const entry: SavedEvent = { name, slug, adminToken, createdAt: Date.now() };
      setSavedEvents((prev) => {
        const next = [entry, ...prev.filter((e) => e.slug !== slug)].slice(0, 10);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    } finally {
      setIsCreating(false);
    }
  }

  function forgetEvent(slug: string) {
    setSavedEvents((prev) => {
      const next = prev.filter((e) => e.slug !== slug);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <main className="narrow-page">
      <section className="panel panel-pad" style={{ width: "min(760px, 100%)" }}>
        <Brand label="Demo Queue" />
        <h1>Run a fair demo queue without exposing private details.</h1>
        <p className="lead">
          Create an event, share the QR code in the presentation view, and control the live queue
          from a private admin link.
        </p>

        <form className="form" onSubmit={onSubmit} style={{ marginTop: 22 }}>
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

        {savedEvents.length > 0 ? (
          <div className="link-stack">
            <h2>Your events</h2>
            <p className="muted saved-events-note">
              Saved on this device only. Keep these links private; the admin link controls the event.
            </p>
            {savedEvents.map((event) => (
              <div key={event.slug} className="event-item">
                <div className="event-item-head">
                  <span className="event-item-title">{event.name}</span>
                  <button
                    className="button ghost event-remove"
                    type="button"
                    onClick={() => forgetEvent(event.slug)}
                    aria-label={`Remove saved link for ${event.name}`}
                  >
                    Remove
                  </button>
                </div>
                <EventLink label="Admin" href={absoluteUrl(adminPath(event.slug, event.adminToken))} />
                <EventLink label="Presentation view" href={absoluteUrl(stagePath(event.slug))} />
                <EventLink label="Submission form" href={absoluteUrl(submissionPath(event.slug))} />
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function EventLink({ label, href }: { label: string; href: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable - the link is still openable
    }
  }

  return (
    <div className="event-link">
      <div className="event-link-text">
        <span className="event-link-label">{label}</span>
        <a className="event-link-url" href={href} target="_blank" rel="noreferrer">
          {href}
        </a>
      </div>
      <button type="button" className="event-copy" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
