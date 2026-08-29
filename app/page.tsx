"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { absoluteUrl, adminPath, stagePath, submissionPath } from "@/lib/routes";
import { randomToken, slugify } from "@/lib/tokens";
import { Brand } from "./Brand";
import { EventTypeSelect } from "@/components/EventTypeSelect";
import {
  VISUAL_STYLES,
  VISUAL_STYLE_LABELS,
  normalizeVisualStyle,
  type VisualStyle,
} from "@/lib/visual-style";

type SavedEvent = {
  name: string;
  slug: string;
  adminToken: string;
  eventType?: "demo" | "hackathon";
  visualStyle?: VisualStyle;
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
  const [eventType, setEventType] = useState<"demo" | "hackathon">("demo");
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("codex");
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
      await createEvent({ name, slug, eventType, visualStyle, meetUrl, adminToken });
      // Only persist after the mutation succeeds, so a failed create (e.g.
      // duplicate slug) never leaves a phantom event in localStorage.
      const entry: SavedEvent = {
        name,
        slug,
        adminToken,
        eventType,
        visualStyle,
        createdAt: Date.now(),
      };
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
    <main className="narrow-page creator-page" data-visual-style={visualStyle}>
      <section className="panel panel-pad creator-shell">
        <header className="creator-intro">
          {visualStyle === "outpost" ? (
            <div className="creator-outpost-lockup">
              <Image src="/outpost/logo-white.png" alt="Outpost" width={220} height={72} priority />
              <span>Create event</span>
            </div>
          ) : (
            <Brand label="Demo Queue" />
          )}
          <h1>Run a fair demo queue without exposing private details.</h1>
          <p className="lead">
            Create an event, share the QR code in the presentation view, and control the live queue
            from a private admin link.
          </p>
        </header>

        <form className="form creator-layout" onSubmit={onSubmit}>
          <div className="creator-controls">
            <div className="field">
            <label htmlFor="name">Event name</label>
            <input id="name" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>

            <div className="field">
            <label htmlFor="eventType">Event type</label>
            <EventTypeSelect
              id="eventType"
              value={eventType}
              onValueChange={setEventType}
              visualStyle={visualStyle}
            />
            <span className="muted form-help">
              {eventType === "hackathon"
                ? "Teams submit a project and video for judging before the finalists present."
                : "People make quick personal submissions for the live demo queue."}
            </span>
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

            <fieldset className="visual-style-fieldset">
            <legend>Visual style</legend>
            <p className="muted form-help">
              This branding appears on the public submission, status, and presentation views.
            </p>
            <div className="visual-style-options">
              {VISUAL_STYLES.map((style) => (
                <label
                  key={style}
                  className={`visual-style-option visual-style-option-${style}${
                    visualStyle === style ? " is-selected" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="visualStyle"
                    value={style}
                    checked={visualStyle === style}
                    onChange={() => setVisualStyle(style)}
                  />
                  <span className="visual-style-preview" aria-hidden>
                    <span className="visual-style-preview-brand">
                      {VISUAL_STYLE_LABELS[style].toUpperCase()}
                    </span>
                    <span className="visual-style-preview-lines" />
                  </span>
                  <span className="visual-style-option-label">{VISUAL_STYLE_LABELS[style]}</span>
                  <span className="visual-style-check" aria-hidden>
                    {visualStyle === style ? "✓" : ""}
                  </span>
                </label>
              ))}
            </div>
            </fieldset>

            <div className="actions">
              <button className="button" disabled={isCreating} type="submit">
                {isCreating ? "Creating..." : "Create event"}
              </button>
              <span className="muted creator-action-note">You can change these settings anytime.</span>
            </div>
          </div>

          <aside className="creator-preview-column" aria-label="Live presentation preview">
            <div className="creator-preview-heading">
              <strong>Live preview</strong>
              <span>This is what your audience will see.</span>
            </div>
            <section
              className={`event-style-live-preview visual-${visualStyle}`}
              aria-label={`${VISUAL_STYLE_LABELS[visualStyle]} presentation preview`}
            >
              <div className="event-style-live-preview-head">
                <strong>{VISUAL_STYLE_LABELS[visualStyle].toUpperCase()}</strong>
                <span>{name.trim() || "Frontier Hack"}</span>
              </div>
              <div className="event-style-live-preview-body">
                <div>
                  <span>Now presenting</span>
                  <h3>Signal Relay</h3>
                  <p>Low-latency telemetry for off-grid teams and devices.</p>
                </div>
                <ol>
                  <li><b>2</b><span>Trailhead</span></li>
                  <li><b>3</b><span>Basecamp</span></li>
                  <li><b>4</b><span>Northline</span></li>
                </ol>
              </div>
              <div className="event-style-live-preview-foot">12 in the queue</div>
            </section>
          </aside>
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
                  <span className="event-item-title">
                    {event.name}
                    <span className="pill">{event.eventType === "hackathon" ? "Hackathon" : "Demo"}</span>
                    <span className="pill">
                      {VISUAL_STYLE_LABELS[normalizeVisualStyle(event.visualStyle)]}
                    </span>
                  </span>
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
