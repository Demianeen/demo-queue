"use client";

import { useSiteOrigin } from "@/lib/use-site-origin";
import { VISUAL_STYLE_LABELS } from "@/lib/visual-style";

import { FormEvent, useState } from "react";
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

export function EventCreationForm({ organizationId, organizationName, firstEvent, styles, onManageStyles, onCancel }: {
  organizationId: string; organizationName: string; firstEvent: boolean; styles: Doc<"organizationStyles">[]; onManageStyles: () => void; onCancel?: () => void;
}) {
  const origin = useSiteOrigin();
  const createEvent = useMutation(api.events.createEvent);
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState<"demo" | "hackathon">("demo");
  const [styleChoice, setStyleChoice] = useState("default");
  const [meetUrl, setMeetUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const selectedStyle = styleChoice === "default" ? styles.find((style) => style.isDefault) : styles.find((style) => style._id === styleChoice);
  const visualStyle = selectedStyle?.preset ?? (styleChoice === "codex" || styleChoice === "outpost" ? styleChoice : "neutral");
  const defaultStyle = styles.find((style) => style.isDefault);
  const defaultName = defaultStyle?.preset ? VISUAL_STYLE_LABELS[defaultStyle.preset] : defaultStyle?.name ?? VISUAL_STYLE_LABELS.neutral;
  const items = [{ value: "default", label: `${defaultName} / Organization default` }, { value: "neutral", label: VISUAL_STYLE_LABELS.neutral }, ...styles.filter((style) => !style.preset).map((style) => ({ value: style._id, label: style.name })), { value: "codex", label: VISUAL_STYLE_LABELS.codex }, { value: "outpost", label: VISUAL_STYLE_LABELS.outpost }];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;
    setIsCreating(true); setError("");
    try {
      const slug = slugify(name);
      const result = await createEvent({ name, slug, eventType, visualStyle, styleId: selectedStyle?._id, meetUrl, expectedOrganizationId: organizationId });
      window.location.assign(adminPath(slug, result.adminToken));
    } catch (error) {
      setError(error instanceof ConvexError && typeof error.data === "string" ? error.data : "Could not create the event. Please try again.");
      setIsCreating(false);
    }
  }

  return <section>
    <div className="workspace-heading"><h1>{firstEvent ? "Create your first event" : "Create event"}</h1><p>This event will belong to {organizationName}.</p></div>
    <form onSubmit={onSubmit}>
      <fieldset className="workspace-create-grid" disabled={isCreating}>
        <div className="workspace-fields">
          <div className="workspace-field"><label htmlFor="name">Event name</label><Input id="name" placeholder="Demo Night" maxLength={160} value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="workspace-field"><label id="event-type-label">Event type</label>
            <RadioGroup className="workspace-event-types" aria-labelledby="event-type-label" value={eventType} onValueChange={(value) => setEventType(value as "demo" | "hackathon")}>
              <label className="workspace-event-type"><RadioGroupItem value="demo" />Demo<Presentation aria-hidden /></label>
              <label className="workspace-event-type"><RadioGroupItem value="hackathon" />Hackathon<CodeXml aria-hidden /></label>
            </RadioGroup>
          </div>
          <div className="workspace-field"><label htmlFor="meetUrl">Google Meet link</label><div className="workspace-input-icon"><LinkIcon aria-hidden /><Input id="meetUrl" type="url" placeholder="https://meet.google.com/..." value={meetUrl} onChange={(e) => setMeetUrl(e.target.value)} required /></div></div>
          <Button className="workspace-submit" disabled={isCreating} type="submit">{isCreating ? "Creating…" : "Create event"}</Button>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {onCancel && <Button variant="ghost" onClick={onCancel}>Back to events</Button>}
        </div>
        <aside className="workspace-preview" aria-label="Event presentation preview">
          <p className="workspace-label">Event presentation preview</p>
          <div className="workspace-preview-frame" inert>{visualStyle !== "neutral" ? <StagePresentationPreview stage={buildStagePreviewFixture({ eventName: name, eventType, visualStyle, meetUrl })} submissionUrl={`${origin}${submissionPath("preview")}`} /> : <EventWelcome name={name} eventType={eventType} submissionUrl={`${origin}${submissionPath("preview")}`} theme={selectedStyle?.theme ?? DEFAULT_EVENT_THEME} />}</div>
          <div className="workspace-field workspace-style-select"><label htmlFor="event-style">Style</label>
            <Select items={items} value={styleChoice} onValueChange={(value) => { if (value) setStyleChoice(value); }}>
              <SelectTrigger id="event-style"><span className="workspace-type-swatch" aria-hidden>Aa</span><SelectValue /></SelectTrigger>
              <SelectContent className="workspace-popup">{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
            <p className="workspace-help">{styleChoice === "default" ? `This is the default style for ${organizationName}. ` : ""}Choose a style for this event or change your organization’s default. <button type="button" className="workspace-text-link" onClick={onManageStyles}>Manage styles</button></p>
          </div>
        </aside>
      </fieldset>
    </form>
  </section>;
}
