"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EventCreationPreview } from "@/components/EventCreationPreview";
import { SubmissionPage, type SubmissionPageProps } from "@/app/e/[slug]/ClientPage";
import { ParticipantPage } from "@/app/s/[slug]/[token]/ClientPage";
import { EventTypeSelect, type EventType } from "@/components/EventTypeSelect";
import { StagePresentation } from "@/components/StagePresentation";
import { Button } from "@/components/ui/button";
import { buildDevDayParticipantFixture } from "@/lib/devday-preview-fixture";
import { buildStagePreviewFixture } from "@/lib/stage-preview-fixture";
import { DEVDAY_THEME_NAME, type VisualStyle } from "@/lib/visual-style";

const VIEWS = [
  { value: "submit", label: "Submit" },
  { value: "status", label: "Your status" },
  { value: "stage", label: "Stage" },
  { value: "qr", label: "QR screen" },
  { value: "create", label: "Create event" },
] as const;
type PreviewView = (typeof VIEWS)[number]["value"];

export function DevDayPreview() {
  const [view, setView] = useState<PreviewView>("submit");
  const [eventType, setEventType] = useState<EventType>("hackathon");
  const [eventName, setEventName] = useState(`${DEVDAY_THEME_NAME} · London`);
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("devday");
  const [participant, setParticipant] = useState(() => buildDevDayParticipantFixture("hackathon"));
  const [presenterIndex, setPresenterIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [notice, setNotice] = useState("");
  const [previewUrl, setPreviewUrl] = useState("/theme-preview/devday");
  const [barHeight, setBarHeight] = useState(56);
  const toolbarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setPreviewUrl(`${window.location.origin}/theme-preview/devday`);
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const observer = new ResizeObserver(() => setBarHeight(toolbar.getBoundingClientRect().height));
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  const stage = buildStagePreviewFixture({ eventName, eventType, visualStyle, meetUrl: "" });
  stage.event.submissionsClosed = closed;
  stage.event.stageScreenMode = view === "qr" ? "qr" : "demo";
  stage.event.showDemoTimerOnStage = true;
  stage.event.showStageTimerOnStage = view === "qr";
  stage.event.showSubmissionCountOnStage = view === "qr";
  stage.demoTimer.status = "paused";
  stage.stageTimer.status = "paused";
  stage.lineup = empty ? [] : stage.lineup.slice(presenterIndex);
  stage.current = stage.lineup[0] ?? null;
  stage.upNext = stage.lineup[1] ?? null;
  stage.remainingCount = stage.lineup.length;

  const currentParticipant = {
    ...participant,
    event: { ...participant.event, name: eventName, eventType, visualStyle, submissionsClosed: closed },
  };

  function changeView(nextView: PreviewView) {
    setView(nextView);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function changeEventType(nextType: EventType) {
    setEventType(nextType);
    setParticipant(buildDevDayParticipantFixture(nextType));
    setPresenterIndex(0);
    setNotice("");
  }

  const submitDemo: SubmissionPageProps["submitDemo"] = async (args) => {
    setParticipant((current) => ({
      ...current,
      submission: {
        ...current.submission,
        name: args.name,
        demoTitle: args.demoTitle,
        description: args.description,
        phone: args.phone,
        email: args.email,
        twitter: args.twitter,
        linkedin: args.linkedin,
        category: args.category,
        teamName: undefined,
        teamMembers: [],
        status: "candidate",
      },
    }));
  };

  const submitHackathon: SubmissionPageProps["submitHackathon"] = async (args) => {
    setParticipant((current) => ({
      ...current,
      submission: {
        ...current.submission,
        name: args.name,
        demoTitle: args.demoTitle,
        description: args.description,
        phone: args.phone,
        email: args.email,
        twitter: args.twitter,
        linkedin: args.linkedin,
        category: args.category,
        teamName: args.teamName,
        teamMembers: args.teamMembers,
        githubUrl: args.githubUrl,
        videoUrl: args.videoUrl,
        rulesAcceptedAt: 0,
        status: "candidate",
      },
    }));
  };

  return (
    <div className="devday-preview" style={{ "--preview-bar-height": `${barHeight}px` } as CSSProperties}>
      <header className="devday-preview-toolbar" ref={toolbarRef}>
        <span className="devday-preview-label">LOCAL PREVIEW · sample data</span>
        <nav aria-label="Preview screens">
          {VIEWS.map((item) => (
            <Button
              key={item.value}
              variant="ghost"
              data-active={view === item.value}
              aria-pressed={view === item.value}
              onClick={() => changeView(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </nav>
        <div className="devday-preview-event-type">
          <label htmlFor="preview-event-type" className="sr-only">Preview event type</label>
          <EventTypeSelect id="preview-event-type" value={eventType} onValueChange={changeEventType} visualStyle="devday" />
        </div>
        {view === "submit" ? (
          <Button variant="outline" aria-pressed={closed} onClick={() => setClosed(!closed)}>
            {closed ? "Reopen submissions" : "Show closed"}
          </Button>
        ) : null}
        {view === "stage" ? (
          <>
            <Button variant="outline" disabled={empty || stage.remainingCount === 0} onClick={() => setPresenterIndex((index) => index + 1)}>Next presenter →</Button>
            <Button variant="ghost" aria-pressed={empty} onClick={() => setEmpty(!empty)}>{empty ? "Show lineup" : "Show empty"}</Button>
            <Button variant="ghost" onClick={() => { setEmpty(false); setPresenterIndex(0); }}>Reset</Button>
          </>
        ) : null}
        {notice ? <span className="devday-preview-notice" role="status">{notice}</span> : null}
      </header>

      {view === "submit" ? (
        <SubmissionPage
          key={eventType}
          slug="preview"
          stage={stage}
          submitDemo={submitDemo}
          submitHackathon={submitHackathon}
          onSubmitted={() => {
            setView("status");
            setNotice("Saved in this preview only. Nothing was submitted to an event.");
            window.scrollTo({ top: 0, behavior: "instant" });
          }}
        />
      ) : null}
      {view === "status" ? (
        <ParticipantPage
          key={eventType}
          slug="preview"
          token="local-preview"
          participant={currentParticipant}
          editContact={async ({ phone, email, twitter, linkedin }) => {
            setParticipant((current) => ({ ...current, submission: { ...current.submission, phone, email, twitter, linkedin } }));
            setNotice("Contact changes are held in this preview only.");
          }}
          withdraw={async () => {
            setParticipant((current) => ({ ...current, submission: { ...current.submission, status: "withdrawn", canWithdraw: false, canSubmitAgain: true } }));
            setNotice("This sample submission was withdrawn in the preview only.");
          }}
          resubmit={async () => {
            setParticipant((current) => ({ ...current, submission: { ...current.submission, status: "candidate", canWithdraw: true, canSubmitAgain: false } }));
            setNotice("This sample submission came back in the preview only.");
            return { restored: true as const };
          }}
        />
      ) : null}
      {view === "stage" || view === "qr" ? <StagePresentation stage={stage} submissionUrl={previewUrl} /> : null}
      {view === "create" ? (
        <EventCreationPreview
          initialStyle="devday"
          onCreate={async (args) => {
            setEventName(args.name);
            setEventType(args.eventType ?? "demo");
            setVisualStyle(args.visualStyle ?? "devday");
            setParticipant(buildDevDayParticipantFixture(args.eventType ?? "demo"));
            setPresenterIndex(0);
            setEmpty(false);
            setView("stage");
            setNotice("Preview updated. No event was created.");
            window.scrollTo({ top: 0, behavior: "instant" });
          }}
        />
      ) : null}
    </div>
  );
}
