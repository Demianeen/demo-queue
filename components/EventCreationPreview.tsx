"use client";

import { FormEvent, useMemo, useState } from "react";
import Image from "next/image";
import { absoluteUrl, submissionPath } from "@/lib/routes";
import { Brand } from "@/app/Brand";
import { DevDayBrand } from "@/components/DevDayBrand";
import { DevDayCharacter } from "@/components/DevDayCharacter";
import { AstraBrand } from "@/components/AstraBrand";
import { EventTypeSelect } from "@/components/EventTypeSelect";
import { StagePresentationPreview } from "@/components/StagePresentationPreview";
import { buildStagePreviewFixture } from "@/lib/stage-preview-fixture";
import {
  VISUAL_STYLES,
  VISUAL_STYLE_LABELS,
  type VisualStyle,
} from "@/lib/visual-style";

type PreviewEventInput = Pick<Parameters<typeof buildStagePreviewFixture>[0], "eventType" | "visualStyle" | "meetUrl"> & {
  name: string;
};

export function EventCreationPreview({ onCreate, initialStyle = "codex" }: {
  onCreate: (args: PreviewEventInput) => Promise<unknown>;
  initialStyle?: VisualStyle;
}) {
  const [name, setName] = useState("");
  const [eventType, setEventType] = useState<"demo" | "hackathon">("demo");
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(initialStyle);
  const [meetUrl, setMeetUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const previewStage = useMemo(
    () => buildStagePreviewFixture({ eventName: name, eventType, visualStyle, meetUrl }),
    [eventType, meetUrl, name, visualStyle],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    try {
      await onCreate({ name, eventType, visualStyle, meetUrl });
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="narrow-page creator-page" data-visual-style={visualStyle}>
      <section className="panel panel-pad creator-shell">
        <header className="creator-intro">
          {visualStyle === "devday" ? <DevDayBrand /> : visualStyle === "astra" ? (
            <AstraBrand />
          ) : visualStyle === "outpost" ? (
            <div className="creator-outpost-lockup">
              <Image src="/outpost/logo-white.png" alt="Outpost" width={220} height={72} priority />
              <span>Create event</span>
            </div>
          ) : (
            <Brand label="Demo Queue" />
          )}
          {visualStyle === "devday" ? <div className="devday-creator-heading">
            <h1>Built something?<br />Give it a stage.</h1>
            <DevDayCharacter variant="orange" className="devday-creator-dot" />
          </div> : <h1>Run a fair demo queue without exposing private details.</h1>}
          <p className="lead">
            Preview the event branding, submission form, and presentation view.
            This sample does not create or save an event.
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
                    {style === "devday" ? <span className="devday-picker-dot"><DevDayCharacter variant="purple" interactive={false} /></span> : <span className="visual-style-preview-lines" />}
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
            <StagePresentationPreview
              stage={previewStage}
              submissionUrl={absoluteUrl(submissionPath("preview"))}
            />
          </aside>
        </form>

      </section>
    </main>
  );
}
