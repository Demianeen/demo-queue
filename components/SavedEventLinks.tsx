"use client";
import { useEffect, useState } from "react";
import { absoluteUrl, adminPath, stagePath, submissionPath } from "@/lib/routes";
import { VISUAL_STYLE_LABELS, normalizeVisualStyle, type VisualStyle } from "@/lib/visual-style";
import { EventLink } from "./EventLink";

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

export function SavedEventLinks() {
  const [savedEvents, setSavedEvents] = useState<SavedEvent[]>([]);
  const [storageError, setStorageError] = useState("");
  useEffect(() => { setSavedEvents(loadSavedEvents()); }, []);
  function forgetEvent(slug: string) {
    const next = savedEvents.filter((event) => event.slug !== slug);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSavedEvents(next);
      setStorageError("");
    } catch {
      setStorageError("Could not remove the saved link. Check that browser storage is available and try again.");
    }
  }
  return <>
        {savedEvents.length > 0 ? (
          <div className="link-stack">
            <h2>Your events</h2>
            <p className="muted saved-events-note">
              Saved on this device only. Keep these links private; the admin link controls the event.
            </p>
            {storageError && <p role="alert">{storageError}</p>}
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
                  <button className="button ghost" onClick={() => forgetEvent(event.slug)}>Remove</button>
                </div>
                <EventLink label="Admin" href={absoluteUrl(adminPath(event.slug, event.adminToken))} />
                <EventLink label="Presentation view" href={absoluteUrl(stagePath(event.slug))} />
                <EventLink label="Submission form" href={absoluteUrl(submissionPath(event.slug))} />
              </div>
            ))}
          </div>
        ) : null}
  </>;
}
