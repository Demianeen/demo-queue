"use client";

import { useSiteOrigin } from "@/lib/use-site-origin";
import { groupStyles, styleEntries } from "@/lib/style-library";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ConvexError } from "convex/values";
import { useMutation } from "convex/react";
import { CodeXml, Link as LinkIcon, Presentation } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { adminPath, submissionPath } from "@/lib/routes";
import { randomToken, slugify } from "@/lib/tokens";
import { StagePresentationPreview } from "./StagePresentationPreview";
import { buildStagePreviewFixture } from "@/lib/stage-preview-fixture";
import { DEFAULT_EVENT_THEME } from "@/lib/event-theme";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EventWelcome } from "./EventWelcome";
import { EventTracksFields, type DraftTrack } from "./EventTracksFields";
import { EventSponsorsFields, type DraftSponsor } from "./EventSponsorsFields";

/**
 * The new event form: one card, each control sized to what it holds, and the
 * presentation preview beside it. ⌘↵ creates the event.
 */
export function EventCreationForm({ organizationId, organizationName, firstEvent, styles, brands, onManageStyles, onCancel }: {
  organizationId: string; organizationName: string; firstEvent: boolean; styles: Doc<"organizationStyles">[]; brands: Doc<"styleBrands">[]; onManageStyles: () => void; onCancel?: () => void;
}) {
  const origin = useSiteOrigin();
  const createEvent = useMutation(api.events.createEvent);
  const formRef = useRef<HTMLFormElement>(null);
  const styleRef = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState<"demo" | "hackathon">("demo");
  // The organizer's pick; until then the organization default, if it has one.
  const [pickedStyle, setPickedStyle] = useState<string | null>(null);
  const [meetUrl, setMeetUrl] = useState("");
  const [tracks, setTracks] = useState<DraftTrack[]>([]);
  const [sponsors, setSponsors] = useState<DraftSponsor[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  // The link suffix is random, so it is drawn once on the client: drawn during
  // render, the server and the browser would show different links.
  const [slugSuffix, setSlugSuffix] = useState("");
  useEffect(() => setSlugSuffix(randomToken(3)), []);
  const entries = styleEntries(styles);
  const groups = groupStyles(entries, brands);
  const defaultEntry = entries.find((entry) => entry.isDefault);
  const styleChoice = pickedStyle ?? defaultEntry?.key ?? null;
  const selected = entries.find((entry) => entry.key === styleChoice);
  const visualStyle = selected?.preset ?? "neutral";
  const items = entries.map((entry) => ({ value: entry.key, label: entry.isDefault ? `${entry.name} (default)` : entry.name }));
  const slug = slugSuffix ? slugify(name, slugSuffix) : "";
  const hackathon = eventType === "hackathon";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating || !slug) return;
    // With no organization default there is no preselected style: the organizer picks one.
    if (!selected) { setError("Choose a style for this event."); styleRef.current?.focus(); return; }
    setIsCreating(true); setError("");
    try {
      // Tracks and sponsors are a hackathon's; a demo night is created without them.
      const trackInputs = hackathon ? tracks
        .filter((track) => track.name.trim())
        .map((track) => ({ name: track.name, description: track.description.trim() || undefined })) : [];
      const sponsorInputs = hackathon ? sponsors
        .filter((sponsor) => sponsor.name.trim())
        .map((sponsor) => ({ name: sponsor.name, usage: sponsor.usage.trim() || undefined })) : [];
      const style = selected.savedId ? { styleId: selected.savedId as Doc<"organizationStyles">["_id"] } : { visualStyle };
      await createEvent({ name, slug, eventType, ...style, meetUrl: meetUrl.trim() || undefined, expectedOrganizationId: organizationId, tracks: trackInputs, sponsors: sponsorInputs });
      window.location.assign(adminPath(slug));
    } catch (error) {
      setError(error instanceof ConvexError && typeof error.data === "string" ? error.data : "Could not create the event. Please try again.");
      // A fresh suffix, so trying again does not hit a taken link.
      setSlugSuffix(randomToken(3));
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
              <Select items={items} value={styleChoice} onValueChange={(value) => { if (value) { setPickedStyle(value); setError(""); } }}>
                <SelectTrigger ref={styleRef} id="event-style" className="new-event-input" data-size="style" aria-describedby={defaultEntry ? undefined : "event-style-help"}><span className="workspace-type-swatch" aria-hidden>Aa</span><SelectValue placeholder="Choose a style" /></SelectTrigger>
                <SelectContent className="workspace-popup">{groups.map((group) => <SelectGroup key={group.brand?._id ?? "none"}>
                  {/* Grouped like the Styles page: each brand's styles together, then the rest. */}
                  <SelectLabel>{group.brand?.name ?? (brands.length ? "No brand" : "Styles")}</SelectLabel>
                  {group.styles.map((entry) => <SelectItem key={entry.key} value={entry.key}>{entry.isDefault ? `${entry.name} (default)` : entry.name}</SelectItem>)}
                </SelectGroup>)}</SelectContent>
              </Select>
              <button type="button" className="workspace-text-link" onClick={onManageStyles}>Manage styles</button>
            </div>
            {!defaultEntry && <p id="event-style-help" className="new-event-help">{organizationName} has no default style, so pick one for this event.</p>}
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
          <div className="workspace-preview-frame" inert>{!selected ? <p className="new-event-preview-empty">Choose a style to see the presentation.</p>
            : visualStyle !== "neutral" ? <StagePresentationPreview stage={buildStagePreviewFixture({ eventName: name, eventType, visualStyle, meetUrl })} submissionUrl={`${origin}${submissionPath("preview")}`} />
            : <EventWelcome name={name} eventType={eventType} submissionUrl={`${origin}${submissionPath("preview")}`} theme={selected.theme ?? DEFAULT_EVENT_THEME} />}</div>
          <p className="new-event-help">Updates as you type. {selected?.isDefault ? `This is ${organizationName}'s default style. ` : ""}Judges, timers and what the room sees are set up after, on the event.</p>
        </aside>
      </fieldset>
    </form>
  </section>;
}
