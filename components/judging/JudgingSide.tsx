"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShortcutTooltip, useCommands, type Command } from "@/components/shell/commands";
import { SubmissionPreviewBody } from "@/components/SubmissionPreviewCard";
import type { AdminData } from "@/components/live/PhaseTabs";
import { TrackChips } from "@/components/live/PhaseTabs";
import { CopyAllLinks, useMakeLinks, type JudgeRow, type JudgesOverview } from "@/components/live/JudgeTools";
import { errorText } from "@/components/live/changes";
import { formatClock, parseClock, useRemaining } from "@/components/live/clock";
import { adminViewPath } from "@/lib/admin-views";
import { evenOutNote, scoreAverage, type RankedRow } from "@/lib/judging-board";
import { chipDescription, formatScore } from "./ProjectRows";
import type { BoardRow } from "./JudgingPage";
import styles from "./judging.module.css";
import { InPageLink } from "@/components/InPageLink";
import { useStartJudging } from "./useStartJudging";

type NormalizationJudge = FunctionReturnType<typeof api.judging.getNormalizationOverview>["judges"][number];

async function run(action: () => Promise<unknown>, failure: string, done?: string) {
  try { await action(); if (done) toast(done); return true; } catch (error) { toast.error(errorText(error, failure)); return false; }
}

/**
 * The judging clock and what to do next: close submissions (which starts
 * judging), add judges if there are fewer than two, send judges their links,
 * then pause, add time or close. Judges see the same clock, read through
 * lib/timer-clock.ts like every other clock.
 */
export function ClockCard({ slug, admin, totals, judges, onManageJudges, wide = false }: { slug: string; admin: AdminData; totals: JudgesOverview["totals"] | undefined; judges?: JudgeRow[]; onManageJudges: () => void; wide?: boolean }) {
  const { event } = admin;
  const status = event.judgingStatus ?? "setup";
  const timer = event.judgingTimer;
  const remaining = useRemaining(timer);
  const closeSubmissions = useMutation(api.judging.closeSubmissions);
  const startJudgingNow = useStartJudging(slug);
  const setJudgingTimer = useMutation(api.judging.setJudgingTimer);
  const setJudgingTimeLeft = useMutation(api.judging.setJudgingTimeLeft);
  const addJudgingTime = useMutation(api.judging.addJudgingTime);
  const pauseJudgingTimer = useMutation(api.judging.pauseJudgingTimer);
  const resumeJudgingTimer = useMutation(api.judging.resumeJudgingTimer);
  const closeJudging = useMutation(api.judging.closeJudging);
  const reopenJudging = useMutation(api.judging.reopenJudging);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = draft === null ? null : parseClock(draft);
  const open = status === "open";
  const running = open && timer?.status === "running";
  const up = open && running && remaining <= 0;
  useEffect(() => { if (draft !== null) inputRef.current?.select(); }, [draft === null]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(key: string, action: () => Promise<unknown>, failure: string, done?: string) {
    setBusy(key);
    const ok = await run(action, failure, done);
    setBusy(null);
    return ok;
  }
  const start = () => act("start", () => startJudgingNow(status), "Could not start judging.", "Judging started. Send every judge their link.");
  const setTime = (ms: number) => act("time", () => (open ? setJudgingTimeLeft({ slug, remainingMs: ms }) : setJudgingTimer({ slug, durationMs: ms })), "Could not set the time.").then((ok) => { if (ok) setDraft(null); });
  const toggle = () => act("toggle", () => (running ? pauseJudgingTimer({ slug }) : resumeJudgingTimer({ slug })), "Could not change the clock.");
  const addFive = () => act("add", () => addJudgingTime({ slug, deltaMs: 5 * 60_000 }), "Could not add time.");

  const latest = useRef({ toggle, addFive, remaining });
  useEffect(() => { latest.current = { toggle, addFive, remaining }; });
  const commands = useMemo<Command[]>(() => open ? [
    { id: "judging-clock-toggle", group: "This page", label: running ? "Pause the judging clock" : "Resume the judging clock", keys: ["P"], run: () => void latest.current.toggle() },
    { id: "judging-clock-edit", group: "This page", label: "Set the judging time exactly", keys: ["E"], run: () => setDraft(formatClock(latest.current.remaining)) },
    { id: "judging-clock-add", group: "This page", label: "Add 5 minutes to judging", run: () => void latest.current.addFive() },
  ] : [], [open, running]);
  useCommands("judging-clock", commands);

  const scoresShare = totals && totals.targetReviews > 0 ? totals.completeReviews / totals.targetReviews : 0;
  const shownMs = open ? Math.max(0, remaining) : timer?.durationMs ?? remaining;
  const clock = draft === null
    ? <button type="button" className={styles.clockValue} data-state={up ? "up" : running ? "running" : "idle"} disabled={status === "closed"} aria-label={`${formatClock(shownMs)}. Click to type an exact time.`} onClick={() => setDraft(formatClock(shownMs))}>{formatClock(shownMs)}</button>
    : <form className={styles.clockForm} onSubmit={(submitEvent) => { submitEvent.preventDefault(); if (parsed !== null) void setTime(parsed); }}>
      <label htmlFor="judging-clock-input" className="sr-only">Judging time</label>
      <input id="judging-clock-input" ref={inputRef} className={styles.clockInput} value={draft} inputMode="numeric" autoComplete="off" aria-invalid={parsed === null}
        onChange={(changeEvent) => setDraft(changeEvent.currentTarget.value)} onKeyDown={(keyEvent) => { if (keyEvent.key === "Escape") { keyEvent.stopPropagation(); setDraft(null); } }} />
      <Button type="submit" size="sm" disabled={busy !== null || parsed === null}>{parsed === null ? "Type mm:ss" : `Set ${formatClock(parsed)}`}</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
    </form>;

  let head = "Judging closes in";
  let note = "judges see the same clock";
  let actions: React.ReactNode = null;
  let help: React.ReactNode = null;
  if (status === "setup" || status === "preparing_assignments") {
    head = "Judging time";
    note = "set it before you start";
    if (event.submissionsOpen) {
      help = "Judging starts once submissions close. Closing them keeps every entry.";
      actions = <Button size="sm" disabled={busy !== null} onClick={() => void act("close-submissions", async () => {
        const { judgingStatus } = await closeSubmissions({ slug });
        if (event.roundOneJudges.length >= 2) await startJudgingNow(judgingStatus as Parameters<typeof startJudgingNow>[0]);
      }, "Could not close submissions.", event.roundOneJudges.length >= 2 ? "Judging started. Send every judge their link." : "Submissions closed.")}>{event.roundOneJudges.length >= 2 ? "Close submissions and start" : "Close submissions"}</Button>;
    } else if (event.roundOneJudges.length < 2) {
      help = "Add at least two judges, then start: every project gets two of them.";
      actions = <Button size="sm" onClick={onManageJudges}>Add judges</Button>;
    } else {
      help = "Every project gets two judges, spread evenly, and the clock starts. Then send judges their links.";
      actions = <Button size="sm" disabled={busy !== null} onClick={() => void start()}>{busy === "start" ? "Starting…" : "Start judging"}</Button>;
    }
  } else if (status === "ready") {
    // Projects were assigned before starting became one step.
    head = "Judging time";
    note = "set it before you start";
    help = "Every project has two judges. Starting opens the judge links and runs the clock.";
    actions = <Button size="sm" disabled={busy !== null} onClick={() => void start()}>{busy === "start" ? "Starting…" : "Start judging"}</Button>;
  } else if (status === "open") {
    actions = <>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void addFive()}>+5 min</Button>
      <ShortcutTooltip label={running ? "Pause" : "Resume"} keys={["P"]}><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void toggle()}>{running ? "Pause" : "Resume"}</Button></ShortcutTooltip>
      <Button size="sm" disabled={busy !== null} onClick={() => void act("close", () => closeJudging({ slug }), "Could not close judging.", "Judging closed.")}>Close judging</Button>
    </>;
    help = up ? "Time's up. Judges can still save; close judging when you're ready." : timer?.status === "paused" ? "Paused. Judges see the clock stopped." : null;
  } else if (status === "closed") {
    head = "Judging closed";
    note = "scores are final";
    help = "Pick finalists and winners on Finalists. Reopening lets judges change scores again.";
    actions = <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act("reopen", () => reopenJudging({ slug }), "Could not reopen judging.", "Judging reopened.")}>Reopen judging</Button>;
  }

  // Overview shows the same clock wide, as the page's main block while judges score.
  const title = wide && open && !up ? "Judging now" : up ? "Time's up" : head;
  return <section className={wide ? styles.wide : `dq-card ${styles.card}`} aria-label="Judging clock">
    <div className={styles.cardHead}>
      <span>{wide && <span className="dq-dot" data-tone={open ? "accent" : undefined} aria-hidden />}{title}</span>
      {wide ? <InPageLink href={adminViewPath(slug, "judging")} className={styles.openLink}>Open judging →</InPageLink> : <span className={styles.muted}>{note}</span>}
    </div>
    <div className={styles.clockRow}>{status === "closed" ? null : clock}{wide && draft === null && status !== "closed" && <span className={styles.muted}>{open ? (up ? "Judges can still save." : "left. Judges see the same clock.") : note}</span>}<span className={styles.clockActions}>{actions}</span></div>
    {event.judgingPaused && <p className={styles.warning}>Submissions are open again, so judges can&apos;t save scores until you close them.</p>}
    <div className={styles.bar} role="progressbar" aria-label="Scores in" aria-valuemin={0} aria-valuemax={totals?.targetReviews ?? 0} aria-valuenow={totals?.completeReviews ?? 0}><span style={{ width: `${Math.round(scoresShare * 100)}%` }} /></div>
    {totals ? <p className={styles.muted}>{totals.completeReviews} of {totals.targetReviews} scores in · {totals.fullyReviewedProjects} of {totals.projects} projects fully reviewed</p> : <Skeleton className="h-3 w-56" />}
    {help && <p className={styles.help}>{help}</p>}
    {open && !wide && judges && <SendLinks slug={slug} eventName={event.name} judges={judges} />}
  </section>;
}

/**
 * Judging's next step once it runs: every judge needs their link. Shown
 * until each one has opened it; making links comes first when some have none.
 */
function SendLinks({ slug, eventName, judges }: { slug: string; eventName: string; judges: JudgeRow[] }) {
  const roster = judges.filter((judge) => judge.onRoster && (judge.active || !judge.hasLink));
  const { linkless, making, makeAllLinks } = useMakeLinks(slug, judges);
  const unopened = roster.filter((judge) => judge.hasLink && !judge.openedAt && judge.assignedScoredCount + judge.helpedCount === 0);
  if (linkless.length === 0 && unopened.length === 0) return null;
  return <div className={styles.nextStep}>
    <strong>Send every judge their link</strong>
    <span>{linkless.length > 0
      ? `${linkless.length} judge${linkless.length === 1 ? " has" : "s have"} no link yet. Make them, then copy them all into WhatsApp or Slack.`
      : `${unopened.length} of ${roster.length} judge${roster.length === 1 ? " hasn't" : "s haven't"} opened theirs yet. Copy them all into WhatsApp or Slack.`}</span>
    {linkless.length > 0
      ? <Button size="sm" disabled={making} onClick={() => void makeAllLinks()}>{making ? "Making links…" : `Make ${linkless.length} link${linkless.length === 1 ? "" : "s"}`}</Button>
      : <CopyAllLinks eventName={eventName} judges={judges} disabled={false} primary commands={false} />}
  </div>;
}

/**
 * One project, opened from Progress or Ranking (`&project=`): its video,
 * links, AI summary and team, each judge's scores, and the actions that were
 * on the old judging table.
 */
export function DetailPanel({ slug, row, closed, evenOut, decisions, onClose, onHide, saveNormalization }: {
  slug: string;
  row: RankedRow<BoardRow>;
  closed: boolean;
  evenOut: boolean;
  decisions: ReadonlyMap<string, NormalizationJudge>;
  onClose: () => void;
  onHide: (id: Id<"submissions">) => Promise<void>;
  saveNormalization: (judgeKeys: string[], decision: "apply" | "raw") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const changed = evenOut && row.final !== null && row.rawFinal !== null && Math.abs(row.final - row.rawFinal) >= 0.005;
  async function act(action: () => Promise<unknown>, failure: string, done: string) {
    setBusy(true);
    await run(action, failure, done);
    setBusy(false);
  }
  return <section className={`dq-card ${styles.detail}`} aria-label={row.title}>
    <div className={styles.detailHead}>
      <h2>{row.title} <span className={styles.muted}>#{row.rank}</span></h2>
      <span className={`dq-mono ${styles.detailFinal}`}>{formatScore(row.final)}</span>
      <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}><X aria-hidden /></Button>
    </div>
    <div className={styles.detailMeta}><TrackChips tracks={row.tracks} />{changed && <span className={styles.muted}>Raw {formatScore(row.rawFinal)} → final {formatScore(row.final)}</span>}</div>
    {row.preview ? <div className={`submission-preview ${styles.inlinePreview}`}><SubmissionPreviewBody preview={row.preview} /></div> : <p className={styles.muted}>{row.team}</p>}
    <div className={styles.judgeScores}>
      {row.chips.length === 0 && <p className={styles.muted}>No judges assigned yet.</p>}
      {row.chips.map((chip) => {
        const judge = decisions.get(chip.judgeKey);
        const note = evenOut ? evenOutNote(chip) : null;
        const average = chip.completed ? scoreAverage(chip.scores) : null;
        return <div key={chip.judgeKey} className={styles.judgeScore}>
          <span className={styles.avatar} aria-hidden>{chip.initials}</span>
          <div className={styles.judgeScoreBody}>
            <div className={styles.judgeScoreTop}><strong>{chip.judgeName}</strong><span className="dq-mono">{average === null ? (chip.scores ? "scoring" : "–") : average.toFixed(2)}</span></div>
            <span className={styles.judgeScoreLine}>{chipDescription(chip)}</span>
            {note && <span className={styles.muted}>{note.kind === "generous" ? "Generous judge" : "Strict judge"}: evened out to {note.even.toFixed(2)}</span>}
            {judge?.lowData && chip.completed && <span className={styles.warningText}>Limited data: based on {judge.completeReviewCount} complete review{judge.completeReviewCount === 1 ? "" : "s"}.</span>}
            {closed && judge && chip.completed && judge.completeReviewCount > 0 && <Button variant="link" size="sm" className={styles.inlineButton} disabled={busy}
              onClick={() => void act(() => saveNormalization([judge.judgeKey], judge.effectiveDecision === "raw" ? "apply" : "raw"), "Could not change the judge's scores.", judge.effectiveDecision === "raw" ? `${chip.judgeName} is evened out again.` : `${chip.judgeName} now counts as entered.`)}>
              {judge.effectiveDecision === "raw" ? `Even out ${chip.judgeName}` : `Use ${chip.judgeName}'s raw scores`}
            </Button>}
          </div>
        </div>;
      })}
    </div>
    <div className={styles.detailActions}>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(async () => { await onHide(row.submissionId); onClose(); }, "Could not hide it.", `${row.title} hidden from results. Undo from Recent changes.`)}>Hide from results</Button>
      <Button variant="outline" size="sm" render={<InPageLink href={`${adminViewPath(slug, "submissions")}&edit=${row.id}`} />} nativeButton={false}>Edit submission</Button>
    </div>
  </section>;
}
