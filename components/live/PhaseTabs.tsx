"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShortcutTooltip, useCommands, type Command } from "@/components/shell/commands";
import { judgingPath } from "@/lib/admin-views";
import { finalistOrder, placeLabel, WINNER_COUNT } from "@/lib/judging-board";
import { formatClock, parseClock, useRemaining, type ServerTimer } from "./clock";
import { errorText } from "./changes";
import styles from "./live.module.css";
import { InPageLink } from "@/components/InPageLink";
import { formatSignedClock, submissionsClockLabel } from "@/lib/timer-clock";

export type AdminData = FunctionReturnType<typeof api.events.getAdmin>;
type AdminItem = AdminData["pool"][number];

const PRESETS = [5, 10, 15, 30];

/** Everyone on a submission, as one line: "Omar Said, Kit Lau". */
export function teamLine(item: Pick<AdminItem, "name" | "teamMembers">) {
  return [item.name, ...item.teamMembers].join(", ");
}

/**
 * The submissions countdown, at the top of Submissions while that phase is
 * live. The stage shows the same clock; the phase control in the header
 * closes submissions.
 */
export function SubmissionsClock({ slug, admin, onShare }: { slug: string; admin: AdminData; onShare: () => void }) {
  const setStageTimerRemaining = useMutation(api.events.setStageTimerRemaining);
  const startStageTimer = useMutation(api.events.startStageTimer);
  const pauseStageTimer = useMutation(api.events.pauseStageTimer);
  return <div className={styles.phaseTop}>
    <div className={styles.sectionHead}>
      <h2><span className="dq-dot" data-tone={admin.event.submissionsOpen ? "success" : undefined} aria-hidden />{admin.event.submissionsOpen ? "Submissions open" : "Submissions closed"}</h2>
      <button type="button" className={styles.linkButton} onClick={onShare}>Share the submit link →</button>
    </div>
    <ExactTimer label="Submissions close in" labelFor={(remainingMs) => submissionsClockLabel(remainingMs, "Submissions close in")} countsBelowZero editKey={admin.event.eventType !== "hackathon"} timer={admin.event.stageTimer}
      help={admin.event.eventType === "hackathon"
        ? "The stage shows this clock. At 0:00 the submit link stays open until you move to Judging from the phase control."
        : "The stage shows this clock. At 0:00 the submit link stays open until you move to Queue from the phase control."}
      onSet={(remainingMs) => setStageTimerRemaining({ slug, remainingMs })}
      onPause={() => pauseStageTimer({ slug })} onResume={() => startStageTimer({ slug })} resumeLabel="Start" />
  </div>;
}

type Decision = FunctionReturnType<typeof api.judging.getFinalistDecision> | undefined;

/** The finalists in their order: the winners first once submitted, then the rest by score. */
export function useFinalists(slug: string, admin: AdminData) {
  const decision = useQuery(api.judging.getFinalistDecision, admin.event.eventType === "hackathon" ? { slug } : "skip");
  return useMemo(() => {
    if (!decision) return null;
    const scored = new Map(decision.submissions.map((row) => [String(row.submissionId), row]));
    const placements = decision.placementStatus === "submitted" ? decision.placementIds.map(String) : [];
    const order = finalistOrder(decision.finalistIds.map(String), placements, new Map([...scored].map(([id, row]) => [id, row.score])));
    const items = new Map([...admin.pool, ...admin.lineup, ...admin.completed, ...admin.noShows, ...admin.withdrawn, ...admin.hidden].map((item) => [String(item.id), item]));
    const rows = order.map((id) => {
      const item = items.get(id);
      const row = scored.get(id);
      return { id, title: item?.demoTitle ?? row?.demoTitle ?? "Removed project", team: item ? teamLine(item) : row?.presenterName ?? "", tracks: item?.tracks ?? [], score: row?.score ?? null };
    });
    return { decision: decision as NonNullable<Decision>, rows, winners: placements.length > 0 ? rows.slice(0, WINNER_COUNT) : [] };
  }, [decision, admin]);
}

function clockTime(at: number) {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return <div className={styles.list} aria-label="Loading">{Array.from({ length: rows }, (_, index) => <div key={index} className={styles.listRow}><Skeleton className="h-3 w-6" /><Skeleton className="h-3 w-40" /><Skeleton className="h-3 w-24" /></div>)}</div>;
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <div className={styles.stat}><span>{label}</span><strong>{value}</strong></div>;
}

/**
 * Results: the winners, the finalists and the night in numbers. A demo night
 * has no winners: what was submitted and who demoed, in the order they did.
 */
export function ResultsTab({ slug, admin }: { slug: string; admin: AdminData }) {
  const { event } = admin;
  const hackathon = event.eventType === "hackathon";
  const finalists = useFinalists(slug, admin);
  const overview = useQuery(api.judging.getJudgesOverview, hackathon ? { slug } : "skip");
  const finished = event.phase === "finished";
  return <div className={styles.phasePage}>
    <div className={styles.sectionHead}>
      <h2><span className="dq-dot" data-tone={finished ? undefined : "success"} aria-hidden />{finished ? "Finished" : "Not finished yet"}</h2>
      {finished && event.finishedAt && <span className={styles.hint}>at {clockTime(event.finishedAt)}</span>}
      {hackathon && event.judgingSheetUrl && <a className={styles.linkButton} href={event.judgingSheetUrl} target="_blank" rel="noreferrer">Open judging sheet ↗</a>}
    </div>
    {hackathon ? <>
      {finalists === null ? <ListSkeleton rows={3} />
        : finalists.winners.length > 0 ? <section className={styles.listCard} aria-labelledby="winners-title">
          <div className={styles.listCardHead}><h2 id="winners-title">Winners</h2>
            <span className={styles.hint}>{finalists.decision.updatedAt ? `confirmed ${clockTime(finalists.decision.updatedAt)} · ` : ""}version {finalists.decision.placementVersion}</span>
            <InPageLink href={judgingPath(slug, { judging: "finalists" })} className={styles.linkButton}>Change on Judging, Finalists →</InPageLink></div>
          <ol className={styles.list}>{finalists.winners.map((row, index) => <li key={row.id} className={styles.listRow}>
            <span className={styles.place}>{placeLabel(index)}</span>
            <span className={styles.listTitle}>{row.title}</span>
            <span className={styles.listTeam}>{row.team}</span>
            <span className={`dq-mono ${styles.listScore}`}>{row.score === null ? "–" : row.score.toFixed(2)}</span>
          </li>)}</ol>
          {finalists.rows.length > WINNER_COUNT && <p className={styles.listFoot}>Also finalists: {finalists.rows.slice(WINNER_COUNT).map((row) => row.title).join(", ")}</p>}
        </section>
        : event.judgingStatus === "setup" && finished ? <div className={styles.emptyCard}><strong>Judging was skipped</strong><span>No scores were entered, so there are no winners to show. The counts still are.</span></div>
        : <div className={styles.emptyCard}><strong>No winners yet</strong><span>The numbers so far, and the winners once you submit them on Judging, Finalists.</span><Button variant="outline" size="sm" render={<InPageLink href={judgingPath(slug, { judging: "finalists" })} />} nativeButton={false}>Open finalists</Button></div>}
      <div className={styles.stats}>
        <Stat label="Submitted" value={event.submissionCount} />
        <Stat label="Finalists" value={finalists ? finalists.rows.length : <Skeleton className="h-6 w-8" />} />
        <Stat label="Scores" value={overview ? `${overview.totals.completeReviews} of ${overview.totals.targetReviews}` : <Skeleton className="h-6 w-14" />} />
        <Stat label="Judges" value={overview ? overview.totals.judges : <Skeleton className="h-6 w-8" />} />
      </div>
      <ProjectsByTrack admin={admin} />
    </> : <>
      <div className={styles.stats}>
        <Stat label="Submitted" value={event.submissionCount} />
        <Stat label="Demoed" value={admin.completed.length} />
        <Stat label="No-shows" value={admin.noShows.length} />
      </div>
      <section className={styles.section} aria-labelledby="demoed-title">
        <div className={styles.sectionHead}><h2 id="demoed-title">Demoed</h2><span className={styles.hint}>in the order they went on</span></div>
        {admin.completed.length === 0 ? <p className={styles.empty}>No one has demoed yet.</p>
          : <ol className={styles.list}>{admin.completed.map((item, index) => <li key={item.id} className={styles.listRow}>
            <span className={styles.place}>{index + 1}</span>
            <span className={styles.listTitle}>{item.demoTitle || item.name}</span>
            <span className={styles.listTeam}>{teamLine(item)}</span>
          </li>)}</ol>}
      </section>
    </>}
    {finished && <p className={styles.footer}>This event is finished. Move it back from the phase control if you need to.{hackathon ? " Finalist teams see it on their status page." : ""}</p>}
  </div>;
}

type ClockControls = {
  label: string;
  /** A label that follows the time left, such as "Deadline passed" below zero. */
  labelFor?: (remainingMs: number) => string;
  /** Keeps counting below zero ("-1:05"), as the projector does, instead of stopping at 0:00. */
  countsBelowZero?: boolean;
  timer: ServerTimer;
  help?: string;
  onSet: (ms: number) => Promise<unknown>;
  onPause: () => Promise<unknown>;
  onResume: () => Promise<unknown>;
  resumeLabel?: string;
  extra?: ReactNode;
  /** E types an exact time. Off where the page's list already uses E. */
  editKey?: boolean;
};

/** A big clock you click to type an exact time, with presets and pause. */
export function ExactTimer({ label, labelFor, countsBelowZero = false, timer, help, onSet, onPause, onResume, resumeLabel = "Resume", extra, editKey = true }: ClockControls) {
  const remaining = useRemaining(timer);
  const shownLabel = labelFor?.(remaining) ?? label;
  const reading = countsBelowZero ? formatSignedClock(remaining) : formatClock(remaining);
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
    { id: "timer-edit", group: "This page", label: "Set the time exactly", ...(editKey ? { keys: ["E"] } : {}), run: () => setDraft(formatClock(latest.current.remaining)) },
    ...PRESETS.map((minutes) => ({ id: `timer-${minutes}`, group: "This page", label: `Set the timer to ${minutes} minutes`, keys: ["T", ...String(minutes).split("")], run: () => void latest.current.set(minutes * 60_000) })),
  ], [running, resumeLabel, editKey]);
  useCommands("live-timer", commands);

  return <section className={styles.section} aria-label={shownLabel}>
    <span className={styles.timerLabel} id="timer-label">{shownLabel}</span>
    <div className={styles.timerRow}>
      {draft === null
        ? <button type="button" className={styles.timerValue} data-state={state} aria-describedby="timer-label" aria-label={`${shownLabel} ${reading}. Click to type an exact time.`} onClick={() => setDraft(formatClock(remaining))}>{state === "up" && !countsBelowZero ? "0:00" : reading}</button>
        : <form className="contents" onSubmit={(submitEvent) => { submitEvent.preventDefault(); if (parsed !== null) void set(parsed); }}>
          <label htmlFor="timer-input" className="sr-only">{shownLabel}</label>
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

