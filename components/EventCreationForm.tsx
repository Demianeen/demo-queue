"use client";

import { useSiteOrigin } from "@/lib/use-site-origin";
import { VISUAL_STYLES, VISUAL_STYLE_LABELS } from "@/lib/visual-style";

import { FormEvent, useRef, useState } from "react";
import { ConvexError } from "convex/values";
import { useMutation } from "convex/react";
import { CodeXml, Link as LinkIcon, Presentation } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { adminPath, submissionPath } from "@/lib/routes";
import { slugify } from "@/lib/tokens";
import { StagePresentationPreview } from "./StagePresentationPreview";
import { buildStagePreviewFixture } from "@/lib/stage-preview-fixture";
import { DEFAULT_EVENT_THEME } from "@/lib/event-theme";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EventWelcome } from "./EventWelcome";
import { EventTracksFields, type DraftTrack } from "./EventTracksFields";
import { EventSponsorsFields, type DraftSponsor } from "./EventSponsorsFields";

/**
 * The new event form: one card, each control sized to what it holds, and the
 * presentation preview beside it. ⌘↵ creates the event.
 */
export function EventCreationForm({ organizationId, organizationName, firstEvent, styles, onManageStyles, onCancel }: {
  organizationId: string; organizationName: string; firstEvent: boolean; styles: Doc<"organizationStyles">[]; onManageStyles: () => void; onCancel?: () => void;
}) {
  const origin = useSiteOrigin();
  const createEvent = useMutation(api.events.createEvent);
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState<"demo" | "hackathon">("demo");
  const [styleChoice, setStyleChoice] = useState("default");
  const [meetUrl, setMeetUrl] = useState("");
  const [tracks, setTracks] = useState<DraftTrack[]>([]);
  const [sponsors, setSponsors] = useState<DraftSponsor[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const selectedStyle = styleChoice === "default" ? styles.find((style) => style.isDefault) : styles.find((style) => style._id === styleChoice);
  const visualStyle = selectedStyle?.preset ?? VISUAL_STYLES.find((style) => style === styleChoice) ?? "neutral";
  const defaultStyle = styles.find((style) => style.isDefault);
  const defaultName = defaultStyle?.preset ? VISUAL_STYLE_LABELS[defaultStyle.preset] : defaultStyle?.name ?? VISUAL_STYLE_LABELS.neutral;
  const presetItems = VISUAL_STYLES.map((style) => ({ value: style, label: VISUAL_STYLE_LABELS[style] }));
  const items = [{ value: "default", label: `${defaultName} (organization default)` }, ...presetItems.filter((style) => style.value === "neutral"), ...styles.filter((style) => !style.preset).map((style) => ({ value: style._id, label: style.name })), ...presetItems.filter((style) => style.value !== "neutral")];
  const slug = slugify(name);
  const hackathon = eventType === "hackathon";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;
    setIsCreating(true); setError("");
    try {
      // Tracks and sponsors are a hackathon's; a demo night is created without them.
      const trackInputs = hackathon ? tracks
        .filter((track) => track.name.trim())
        .map((track) => ({ name: track.name, description: track.description.trim() || undefined })) : [];
      const sponsorInputs = hackathon ? sponsors
        .filter((sponsor) => sponsor.name.trim())
        .map((sponsor) => ({ name: sponsor.name, usage: sponsor.usage.trim() || undefined })) : [];
      await createEvent({ name, slug, eventType, visualStyle, styleId: selectedStyle?._id, meetUrl: meetUrl.trim() || undefined, expectedOrganizationId: organizationId, tracks: trackInputs, sponsors: sponsorInputs });
      window.location.assign(adminPath(slug));
    } catch (error) {
      setError(error instanceof ConvexError && typeof error.data === "string" ? error.data : "Could not create the event. Please try again.");
      setIsCreating(false);
    }
  }

  return <section className="new-event">
    <div className="workspace-heading"><h1>{firstEvent ? "Create your first event" : "Create event"}</h1><p>This event will belong to {organizationName}.</p></div>
    <form ref={formRef} onSubmit={onSubmit} onKeyDown={(event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); formRef.current?.requestSubmit(); }
    }}>
      <fieldset className="new-event-grid" disabled={isCreating}>
        <div className="new-event-card">
          <div className="new-event-field">
            <label htmlFor="name">Event name</label>
            <Input id="name" className="new-event-input" data-size="name" placeholder="Demo Night" maxLength={160} value={name} onChange={(e) => setName(e.target.value)} required aria-describedby="name-link" />
            <p id="name-link" className="new-event-help">Submit link <span className="new-event-link">{origin.replace(/^https?:\/\//, "")}{submissionPath("")}<strong>{slug || "your-event"}</strong></span></p>
          </div>

          <div className="new-event-field">
            <label id="event-type-label">Event type</label>
            <RadioGroup className="new-event-types" aria-labelledby="event-type-label" aria-describedby="event-type-help" value={eventType} onValueChange={(value) => setEventType(value as "demo" | "hackathon")}>
              <label className="workspace-event-type"><RadioGroupItem value="demo" />Demo night<Presentation aria-hidden /></label>
              <label className="workspace-event-type"><RadioGroupItem value="hackathon" />Hackathon<CodeXml aria-hidden /></label>
            </RadioGroup>
            <p id="event-type-help" className="new-event-help">Hackathons add judging, tracks and AI summaries. Demo nights ask for a Google Meet link.</p>
          </div>

          {hackathon ? <EventTracksFields tracks={tracks} onChange={setTracks} /> : null}
          {hackathon ? <EventSponsorsFields sponsors={sponsors} onChange={setSponsors} /> : null}

          <div className="new-event-field">
            <label htmlFor="event-style">Style</label>
            <div className="new-event-inline">
              <Select items={items} value={styleChoice} onValueChange={(value) => { if (value) setStyleChoice(value); }}>
                <SelectTrigger id="event-style" className="new-event-input" data-size="style"><span className="workspace-type-swatch" aria-hidden>Aa</span><SelectValue /></SelectTrigger>
                <SelectContent className="workspace-popup">{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
              <button type="button" className="workspace-text-link" onClick={onManageStyles}>Manage styles</button>
            </div>
          </div>

          {/* Demoers join the call from the meet link; a hackathon may use one in Stage. */}
          <div className="new-event-field">
            <label htmlFor="meetUrl">Google Meet link {hackathon ? <span className="new-event-optional">optional</span> : <span className="new-event-required" aria-hidden>*</span>}</label>
            <div className="workspace-input-icon new-event-input" data-size="meet"><LinkIcon aria-hidden /><Input id="meetUrl" type="url" placeholder="https://meet.google.com/..." value={meetUrl} onChange={(e) => setMeetUrl(e.target.value)} required={!hackathon} aria-describedby="meetUrl-help" /></div>
            <p id="meetUrl-help" className="new-event-help">{hackathon ? "The stage shows it when Meet link is on. You can add it later in Settings." : "Required for a demo night: demoers join the call from it."}</p>
          </div>

          {error && <Alert variant="destructive"><AlertDescription>{error} Everything you typed is still here.</AlertDescription></Alert>}
          <div className="new-event-actions">
            {onCancel && <Button type="button" variant="outline" size="sm" onClick={onCancel}>Back to events</Button>}
            <Button type="submit" size="sm" disabled={isCreating}>{isCreating ? "Creating…" : <>Create event<kbd className="new-event-kbd" aria-label="Command Enter">⌘↵</kbd></>}</Button>
          </div>
        </div>

        <aside className="new-event-card new-event-preview" aria-label="Event presentation preview">
          <h2 className="new-event-preview-title">Event presentation preview</h2>
          <div className="workspace-preview-frame" inert>{visualStyle !== "neutral" ? <StagePresentationPreview stage={buildStagePreviewFixture({ eventName: name, eventType, visualStyle, meetUrl })} submissionUrl={`${origin}${submissionPath("preview")}`} /> : <EventWelcome name={name} eventType={eventType} submissionUrl={`${origin}${submissionPath("preview")}`} theme={selectedStyle?.theme ?? DEFAULT_EVENT_THEME} />}</div>
          <p className="new-event-help">Updates as you type. {styleChoice === "default" ? `This is ${organizationName}'s default style. ` : ""}Judges, timers and what the room sees are set up after, on the event.</p>
        </aside>
      </fieldset>
    </form>
  </section>;
}
