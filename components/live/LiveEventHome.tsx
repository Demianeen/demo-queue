"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShortcutTooltip, useCommands, type Command } from "@/components/shell/commands";
import { PHASE_LABELS, type EventPhase } from "@/lib/event-phase";
import { adminViewPath } from "@/lib/admin-views";
import { stagePath } from "@/lib/routes";
import { formatClock, parseClock, timeAgo, useRemaining, useTick, type ServerTimer } from "./clock";
import { errorText, RecentChanges } from "./changes";
import { PracticeTools } from "./PracticeTools";
import styles from "./live.module.css";

export type AdminData = FunctionReturnType<typeof api.events.getAdmin>;
type PhasePreview = FunctionReturnType<typeof api.phases.previewPhaseChange>;

const PRESETS = [5, 10, 15, 30];

/**
 * The live event home: where the event is, the clock that matters now, what
 * the room sees, and what changed. Every control here goes through the same
 * mutations as the rest of the admin page, so every change lands in Recent
 * changes with Undo.
 */
export function LiveEventHome({ slug, admin, onSetUpJudging }: { slug: string; admin: AdminData; onSetUpJudging: () => void }) {
  const { event } = admin;
  const hackathon = event.eventType === "hackathon";
  const overview = useQuery(api.judging.getJudgesOverview, hackathon ? { slug } : "skip");
  return <div className={styles.home}>
    <div className={styles.main}>
      <PhaseSwitch slug={slug} phase={event.phase} phases={event.phases} />
      <PhaseClock slug={slug} admin={admin} onSetUpJudging={onSetUpJudging} />
      {hackathon && event.phase !== "submissions" && <JudgingProgress overview={overview} />}
      {event.phase === "submissions" && <LatestSubmissions admin={admin} />}
      {hackathon && <ProjectsByTrack admin={admin} />}
      {event.practice && <PracticeTools slug={slug} admin={admin} />}
    </div>
    <aside className={styles.side} aria-label="Event details">
      <OnStageCard slug={slug} admin={admin} />
      <PropertiesCard admin={admin} overview={overview} />
      <RecentChanges slug={slug} />
    </aside>
  </div>;
}

function confirmLabel(to: EventPhase) {
  return to === "submissions" ? "Reopen submissions" : to === "judging" ? "Reopen judging" : `Back to ${PHASE_LABELS[to].toLowerCase()}`;
}

/** The confirm's sentence, from the backend's effects: "Judging pauses at 18:42 and every score is kept." */
function confirmText(preview: PhasePreview) {
  return preview.effects.map((effect) => effect.code === "judging_timer_pause" && preview.judgingRemainingMs !== null
    ? `Judging pauses at ${formatClock(preview.judgingRemainingMs)}.`
    : effect.text).join(" ");
}

/**
 * Submissions / Judging / Stage / Finished. Forward moves happen at once
 * (and can be undone); a move back first says what it does.
 */
export function PhaseSwitch({ slug, phase, phases }: { slug: string; phase: EventPhase; phases: EventPhase[] }) {
  const convex = useConvex();
  const setPhase = useMutation(api.phases.setPhase);
  const reopenSubmissions = useMutation(api.phases.reopenSubmissions);
  const [pending, setPending] = useState<{ to: EventPhase; preview: PhasePreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  async function move(to: EventPhase) {
    setBusy(true);
    try {
      // A hackathon's submit link reopens through its own mutation: judging pauses and every score stays.
      if (to === "submissions" && phases.includes("judging")) await reopenSubmissions({ slug });
      else await setPhase({ slug, phase: to });
      setPending(null);
    } catch (error) {
      toast.error(errorText(error, `Could not move to ${PHASE_LABELS[to]}.`));
    } finally {
      setBusy(false);
    }
  }

  async function choose(to: EventPhase) {
    if (to === phase || busy) return;
    setBusy(true);
    let preview: PhasePreview;
    try {
      preview = await convex.query(api.phases.previewPhaseChange, { slug, phase: to });
    } catch (error) {
      setBusy(false);
      toast.error(errorText(error, "Could not check that move."));
      return;
    }
    setBusy(false);
    if (preview.direction === "back") { setPending({ to, preview }); return; }
    await move(to);
  }

  useEffect(() => { if (pending) cancelRef.current?.focus(); }, [pending]);

  const commands = useMemo<Command[]>(() => phases.filter((item) => item !== phase).map((item) => ({
    id: `phase-${item}`, group: "This page", label: `Move to ${PHASE_LABELS[item]}`, run: () => void choose(item),
  })), // eslint-disable-next-line react-hooks/exhaustive-deps
  [phases, phase]);
  useCommands("live-phase", commands);

  return <section className={styles.section} aria-labelledby="phase-label">
    <div className={styles.sectionHead}><h2 id="phase-label">Phase</h2><span className={styles.hint}>Any phase, either direction. Nothing is deleted.</span></div>
    <div className={styles.phaseRow}>
      <div role="radiogroup" aria-labelledby="phase-label" className={`dq-segmented ${styles.phases}`}>
        {phases.map((item) => <button key={item} type="button" role="radio" aria-checked={item === phase} disabled={busy} onClick={() => void choose(item)}>{PHASE_LABELS[item]}</button>)}
      </div>
    </div>
    {pending && <div role="dialog" data-open="" aria-labelledby="phase-confirm-title" className={styles.confirm} onKeyDown={(keyEvent) => { if (keyEvent.key === "Escape") setPending(null); }}>
      <h3 id="phase-confirm-title">Back to {PHASE_LABELS[pending.to].toLowerCase()}?</h3>
      <p>{confirmText(pending.preview)}</p>
      <div className={styles.confirmActions}>
        <Button ref={cancelRef} variant="outline" size="sm" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={() => void move(pending.to)} disabled={busy}>{busy ? "Moving…" : confirmLabel(pending.to)}</Button>
      </div>
    </div>}
  </section>;
}

type ClockControls = {
  label: string;
  timer: ServerTimer;
  help?: string;
  onSet: (ms: number) => Promise<unknown>;
  onPause: () => Promise<unknown>;
  onResume: () => Promise<unknown>;
  resumeLabel?: string;
  extra?: ReactNode;
};

/** The current phase's clock: judging time, the submissions clock, or the presenter's demo time. */
function PhaseClock({ slug, admin, onSetUpJudging }: { slug: string; admin: AdminData; onSetUpJudging: () => void }) {
  const { event } = admin;
  const setStageTimerRemaining = useMutation(api.events.setStageTimerRemaining);
  const startStageTimer = useMutation(api.events.startStageTimer);
  const pauseStageTimer = useMutation(api.events.pauseStageTimer);
  const setJudgingTimeLeft = useMutation(api.judging.setJudgingTimeLeft);
  const pauseJudgingTimer = useMutation(api.judging.pauseJudgingTimer);
  const resumeJudgingTimer = useMutation(api.judging.resumeJudgingTimer);
  const startJudging = useMutation(api.judging.startJudging);
  const setPhase = useMutation(api.phases.setPhase);
  const adjustDemoTimer = useMutation(api.events.adjustDemoTimer);
  const startDemoTimer = useMutation(api.events.startDemoTimer);
  const pauseDemoTimer = useMutation(api.events.pauseDemoTimer);
  const demoRemaining = useRemaining(event.demoTimer);
  const presenter = event.queuePublished ? admin.lineup[0] ?? null : null;

  if (event.phase === "finished") return <section className={styles.section}><p className={styles.progressText}>This event is finished. Move it back to Stage or Judging from the phase switch if you need to.</p></section>;

  if (event.phase === "judging" && event.judgingTimer) {
    if (event.judgingStatus !== "open") {
      return <section className={styles.section} aria-label="Judging">
        <span className={styles.timerLabel}>Judging hasn&apos;t started</span>
        <p className={styles.progressText}>{event.judgingStatus === "ready" ? "Every project has two judges. Start judging to open the judge links and run the clock." : "Give every project two judges first, on the Judging page."}</p>
        <div className={styles.timerActions} style={{ marginLeft: 0 }}>
          {event.judgingStatus === "ready"
            ? <Button onClick={() => void run(() => startJudging({ slug }), "Could not start judging.")}>Start judging</Button>
            : <Button onClick={onSetUpJudging}>Set up judging</Button>}
        </div>
      </section>;
    }
    return <ExactTimer label="Judging closes in" timer={event.judgingTimer} help="Click the time to type an exact value. Judges see the same clock."
      onSet={(remainingMs) => setJudgingTimeLeft({ slug, remainingMs })}
      onPause={() => pauseJudgingTimer({ slug })} onResume={() => resumeJudgingTimer({ slug })}
      extra={<Button onClick={() => void run(() => setPhase({ slug, phase: "stage" }), "Could not close judging.")}>Close judging</Button>} />;
  }

  if (event.phase === "stage") {
    return <ExactTimer label={presenter ? `${presenter.demoTitle || presenter.teamName || presenter.name}: demo time left` : "Demo time"}
      timer={event.demoTimer} help={presenter ? "Click the time to type an exact value. Advance presenters from the Queue." : "No one is presenting yet. Start the lineup from the Queue."}
      onSet={(ms) => adjustDemoTimer({ slug, deltaMs: Math.round((ms - demoRemaining) / 1000) * 1000 })}
      onPause={() => pauseDemoTimer({ slug })} onResume={() => startDemoTimer({ slug })} resumeLabel="Start"
      extra={<Button variant="outline" render={<Link href={adminViewPath(slug, "queue")} />} nativeButton={false}>Open the queue</Button>} />;
  }

  return <ExactTimer label="Submissions close in" timer={event.stageTimer} help="Click the time to type an exact value. The stage shows this clock; close submissions from the phase switch."
    onSet={(remainingMs) => setStageTimerRemaining({ slug, remainingMs })}
    onPause={() => pauseStageTimer({ slug })} onResume={() => startStageTimer({ slug })} resumeLabel="Start" />;
}

async function run(action: () => Promise<unknown>, failure: string) {
  try { await action(); } catch (error) { toast.error(errorText(error, failure)); }
}

/** A big clock you click to type an exact time, with presets and pause. */
export function ExactTimer({ label, timer, help, onSet, onPause, onResume, resumeLabel = "Resume", extra }: ClockControls) {
  const remaining = useRemaining(timer);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = draft === null ? null : parseClock(draft);
  const running = timer.status === "running";
  const state = running ? (remaining <= 0 ? "up" : "running") : timer.status === "paused" ? "paused" : "idle";

  useEffect(() => { if (draft !== null) inputRef.current?.select(); }, [draft === null]); // eslint-disable-line react-hooks/exhaustive-deps

  async function set(ms: number) {
    setBusy(true);
    try { await onSet(ms); setDraft(null); } catch (error) { toast.error(errorText(error, "Could not set the time.")); } finally { setBusy(false); }
  }
  async function toggle() {
    setBusy(true);
    try { await (running ? onPause() : onResume()); } catch (error) { toast.error(errorText(error, "Could not change the timer.")); } finally { setBusy(false); }
  }

  // Shortcuts read the latest time and handlers, so a preset never works from a stale clock.
  const latest = useRef({ set, toggle, remaining });
  useEffect(() => { latest.current = { set, toggle, remaining }; });
  const commands = useMemo<Command[]>(() => [
    { id: "timer-toggle", group: "This page", label: running ? "Pause timer" : `${resumeLabel} timer`, keys: ["P"], run: () => void latest.current.toggle() },
    { id: "timer-edit", group: "This page", label: "Set the time exactly", keys: ["E"], run: () => setDraft(formatClock(latest.current.remaining)) },
    ...PRESETS.map((minutes) => ({ id: `timer-${minutes}`, group: "This page", label: `Set the timer to ${minutes} minutes`, keys: ["T", ...String(minutes).split("")], run: () => void latest.current.set(minutes * 60_000) })),
  ], [running, resumeLabel]);
  useCommands("live-timer", commands);

  return <section className={styles.section} aria-label={label}>
    <span className={styles.timerLabel} id="timer-label">{label}</span>
    <div className={styles.timerRow}>
      {draft === null
        ? <button type="button" className={styles.timerValue} data-state={state} aria-describedby="timer-label" aria-label={`${label} ${formatClock(remaining)}. Click to type an exact time.`} onClick={() => setDraft(formatClock(remaining))}>{state === "up" ? "0:00" : formatClock(remaining)}</button>
        : <form className="contents" onSubmit={(submitEvent) => { submitEvent.preventDefault(); if (parsed !== null) void set(parsed); }}>
          <label htmlFor="timer-input" className="sr-only">{label}</label>
          <input id="timer-input" ref={inputRef} className={styles.timerInput} value={draft} inputMode="numeric" autoComplete="off" aria-invalid={parsed === null}
            onChange={(changeEvent) => setDraft(changeEvent.currentTarget.value)} onKeyDown={(keyEvent) => { if (keyEvent.key === "Escape") { keyEvent.stopPropagation(); setDraft(null); } }} />
          <Button type="submit" className="bg-[var(--dq-accent)] hover:bg-[var(--dq-accent)]" disabled={busy || parsed === null}>{parsed === null ? "Type mm:ss" : `Set to ${formatClock(parsed)}`}</Button>
          <Button type="button" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
        </form>}
      {draft === null && <span className={styles.presets} aria-label="Presets">{PRESETS.map((minutes) => <button key={minutes} type="button" className={styles.preset} disabled={busy} onClick={() => void set(minutes * 60_000)}>{minutes} min</button>)}</span>}
      <div className={styles.timerActions}>
        <ShortcutTooltip label={running ? "Pause timer" : `${resumeLabel} timer`} keys={["P"]}>
          <Button variant="outline" onClick={() => void toggle()} disabled={busy}>{running ? "Pause" : resumeLabel}</Button>
        </ShortcutTooltip>
        {extra}
      </div>
    </div>
    <span className={styles.timerHelp}>{state === "up" ? "Time's up. The clock stays at 0:00 until you add time or move on." : timer.status === "paused" ? `Paused. ${help ?? ""}` : help}</span>
  </section>;
}

type Overview = FunctionReturnType<typeof api.judging.getJudgesOverview> | undefined;

function JudgingProgress({ overview }: { overview: Overview }) {
  if (overview === undefined) return <section className={styles.section} aria-label="Loading judging progress"><Skeleton className="h-1.5 w-full max-w-[560px]" /><Skeleton className="h-3 w-80" /></section>;
  const { totals } = overview;
  const share = totals.projects === 0 ? 0 : Math.round((totals.fullyReviewedProjects / totals.projects) * 100);
  return <section className={styles.section} aria-label="Judging progress">
    <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={totals.projects} aria-valuenow={totals.fullyReviewedProjects} aria-label="Projects fully reviewed"><span style={{ width: `${share}%` }} /></div>
    <span className={styles.progressText}>{totals.fullyReviewedProjects} of {totals.projects} projects fully reviewed · {totals.completeReviews} of {totals.targetReviews} scores in · {totals.activeJudges} judge{totals.activeJudges === 1 ? "" : "s"} active</span>
  </section>;
}

function LatestSubmissions({ admin }: { admin: AdminData }) {
  const now = useTick(true);
  const all = [...admin.pool, ...admin.lineup].sort((a, b) => b.createdAt - a.createdAt);
  const latest = all.slice(0, 5);
  const word = admin.event.eventType === "hackathon" ? "projects" : "people";
  return <section className={styles.section} aria-labelledby="latest-title">
    <div className={styles.bigStat}><strong>{admin.event.submissionCount}</strong><span className={styles.progressText}>submitted</span></div>
    <div className={styles.sectionHead}><h2 id="latest-title">Latest submissions</h2></div>
    {latest.length === 0 ? <p className={styles.empty}>No {word} yet. Share the submit link: its QR is under Share, and on the stage.</p>
      : <div className={styles.latest}>{latest.map((item) => <div key={item.id} className={styles.latestRow}>
        <span className={styles.latestTitle}>{item.demoTitle || item.name} {item.teamName && <span className={styles.latestTeam}>· {item.teamName}</span>}</span>
        <TrackChips tracks={item.tracks} hackathon={admin.event.eventType === "hackathon"} />
        <span className={styles.latestWhen}>{timeAgo(item.createdAt, now)}</span>
      </div>)}</div>}
  </section>;
}

/** 0 to many track chips, or muted "Main event" when a project entered none. */
export function TrackChips({ tracks, hackathon = true }: { tracks: string[]; hackathon?: boolean }) {
  if (!hackathon) return null;
  if (tracks.length === 0) return <span className="dq-track-none">Main event</span>;
  return <span className="dq-track-chips">{tracks.map((track) => <span key={track} className="dq-track-chip">{track}</span>)}</span>;
}

function ProjectsByTrack({ admin }: { admin: AdminData }) {
  return <section className={styles.section} aria-labelledby="tracks-title">
    <div className={styles.sectionHead}><h2 id="tracks-title">Projects by track</h2><span className={styles.hint}>{admin.event.submissionCount} project{admin.event.submissionCount === 1 ? "" : "s"}, a project can enter several tracks or none</span></div>
    <div className={styles.trackCards}>
      <div className={styles.trackCard}><span className={styles.trackName} data-muted=""><span className={styles.swatch} data-muted="" aria-hidden /><span>Main event only</span></span><span className={styles.trackCount}>{admin.noTrackCount}</span></div>
      {admin.tracks.map((track) => <div key={track.id} className={styles.trackCard}><span className={styles.trackName}><span className={styles.swatch} aria-hidden /><span>{track.name}</span></span><span className={styles.trackCount}>{track.submissionCount}</span></div>)}
    </div>
  </section>;
}

/** What the room sees, live, with the switches that change it. */
function OnStageCard({ slug, admin }: { slug: string; admin: AdminData }) {
  const { event } = admin;
  const setStageScreenMode = useMutation(api.events.setStageScreenMode);
  const setStageTimerVisible = useMutation(api.events.setStageTimerVisible);
  const setDemoTimerVisible = useMutation(api.events.setDemoTimerVisible);
  const setSubmissionCountVisible = useMutation(api.events.setSubmissionCountVisible);
  const setStageMeetLinkVisible = useMutation(api.events.setStageMeetLinkVisible);
  const frameBox = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    const box = frameBox.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setScale(box.clientWidth / 1280));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const lineup = event.stageScreenMode === "demo";
  const timerOn = lineup ? event.showDemoTimerOnStage : event.showStageTimerOnStage;
  return <section className={`dq-card ${styles.sideCard}`} aria-labelledby="on-stage">
    <div className={styles.sideHead}>
      <h2 id="on-stage"><span className="dq-dot" data-tone={event.queuePublished || event.phase !== "submissions" ? "success" : undefined} aria-hidden />On stage now</h2>
      <a className={styles.linkButton} href={stagePath(slug)} target="_blank" rel="noreferrer">Open</a>
    </div>
    <div ref={frameBox} className={styles.mirror}>
      <iframe src={stagePath(slug)} title={`${event.name} stage, live`} tabIndex={-1} scrolling="no" style={{ transform: `scale(${scale})` }} />
    </div>
    <div role="radiogroup" aria-label="Stage shows" className="dq-segmented w-full">
      <button type="button" role="radio" aria-checked={!lineup} data-pressed={!lineup ? "" : undefined} onClick={() => void run(() => setStageScreenMode({ slug, mode: "qr" }), "Could not change the stage.")}>QR code</button>
      <button type="button" role="radio" aria-checked={lineup} data-pressed={lineup ? "" : undefined} onClick={() => void run(() => setStageScreenMode({ slug, mode: "demo" }), "Could not change the stage.")}>Lineup</button>
    </div>
    <div className={styles.toggles}>
      <Toggle label="Timer" checked={timerOn} onChange={(visible) => run(() => (lineup ? setDemoTimerVisible : setStageTimerVisible)({ slug, visible }), "Could not change the timer.")} />
      <Toggle label="Count" checked={event.showSubmissionCountOnStage} disabled={lineup} onChange={(visible) => run(() => setSubmissionCountVisible({ slug, visible }), "Could not change the count.")} />
      <Toggle label="Meet link" checked={event.showMeetLinkOnStage} disabled={!event.queuePublished} title={event.queuePublished ? undefined : "Publish the lineup first."} onChange={(visible) => run(() => setStageMeetLinkVisible({ slug, visible }), "Could not change the meet link.")} />
    </div>
    <p className={styles.note}>A live mirror of the stage, exactly what the room sees.</p>
  </section>;
}

function Toggle({ label, checked, disabled, title, onChange }: { label: string; checked: boolean; disabled?: boolean; title?: string; onChange: (checked: boolean) => Promise<unknown> }) {
  return <label className={styles.toggle} title={title}>
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(changeEvent) => void onChange(changeEvent.currentTarget.checked)} />
    <span className={styles.toggleTrack} aria-hidden />{label}
  </label>;
}

function PropertiesCard({ admin, overview }: { admin: AdminData; overview: Overview }) {
  const { event } = admin;
  const hackathon = event.eventType === "hackathon";
  const rows: [string, ReactNode][] = [
    ["Status", <><span className="dq-dot" data-tone={event.phase === "finished" ? undefined : event.phase === "judging" ? "accent" : "success"} aria-hidden />{PHASE_LABELS[event.phase]}{event.judgingPaused ? " (judging paused)" : ""}</>],
    ["Type", hackathon ? "Hackathon" : "Demo night"],
  ];
  if (hackathon) {
    rows.push(["Tracks", admin.tracks.length === 0 ? "Main event only" : `${admin.tracks.length} plus main event`]);
    rows.push(["Judges", overview && overview.totals.judges > 0 ? `${overview.totals.activeJudges} active of ${overview.totals.judges}` : event.roundOneJudges.length ? `${event.roundOneJudges.length}` : "None yet"]);
  }
  rows.push(["Submit link", event.submissionsOpen ? "Open" : "Closed"]);
  rows.push(["Lineup", event.queuePublished ? "Published" : "Not published"]);
  if (event.practice) {
    if (event.practice.copiedFromName) rows.push(["Copied from", event.practice.copiedFromName]);
    rows.push(["Tidies away", new Date(event.practice.tidiesAwayAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })]);
  }
  return <section className={`dq-card ${styles.sideCard}`} aria-labelledby="props-title">
    <div className={styles.sideHead}><h2 id="props-title">Properties</h2></div>
    <dl className={styles.props}>{rows.map(([term, value]) => <div key={term} className="contents"><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}
