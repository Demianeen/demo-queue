"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink, QrCode, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PHASE_LABELS } from "@/lib/event-phase";
import { stagePath, submissionPath } from "@/lib/routes";
import { errorText, RecentChanges } from "./changes";
import { Toggle } from "./Toggle";
import type { AdminData } from "./PhaseTabs";
import styles from "./live.module.css";

type Overview = FunctionReturnType<typeof api.judging.getJudgesOverview> | undefined;

async function run(action: () => Promise<unknown>, failure: string) {
  try { await action(); } catch (error) { toast.error(errorText(error, failure)); }
}

/**
 * The Room panel: what the room sees, with its switches, Recent changes and
 * the event's properties. It opens beside any tab and stays open as you
 * switch tabs; Esc or × closes it.
 */
export function RoomPanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { isAuthenticated } = useConvexAuth();
  // The admin page asks for the same query, so this shares its subscription.
  const admin = useQuery(api.events.getAdmin, isAuthenticated ? { slug } : "skip");
  const hackathon = admin?.event.eventType === "hackathon";
  const overview = useQuery(api.judging.getJudgesOverview, hackathon ? { slug } : "skip");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape" || keyEvent.defaultPrevented) return;
      const target = keyEvent.target as HTMLElement | null;
      // Esc in a field or an open menu belongs to that field or menu.
      if (target?.closest("input, textarea, select, [role='dialog'], [role='menu'], [role='listbox']")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <aside id="room-panel" className={styles.room} aria-labelledby="room-title">
    <div className={styles.roomInner}>
      <div className={styles.roomHead}>
        <h2 id="room-title">Room</h2><span className={styles.hint}>what the room sees</span>
        <Button ref={closeRef} variant="ghost" size="icon-xs" aria-label="Close the room panel" onClick={onClose}><X aria-hidden /></Button>
      </div>
      {admin ? <>
        <OnStageCard slug={slug} admin={admin} />
        <div className={styles.roomLinks}>
          <Button variant="outline" size="sm" render={<a href={submissionPath(slug)} target="_blank" rel="noreferrer" />} nativeButton={false}><QrCode aria-hidden />Form link</Button>
          <Button variant="outline" size="sm" render={<a href={stagePath(slug)} target="_blank" rel="noreferrer" />} nativeButton={false}>Open presentation view<ExternalLink aria-hidden /></Button>
        </div>
        <RecentChanges slug={slug} />
        <PropertiesCard admin={admin} overview={overview} />
      </> : <div className={`dq-card ${styles.sideCard}`} aria-label="Loading the room">
        <Skeleton className="aspect-video w-full" /><Skeleton className="h-3 w-40" /><Skeleton className="h-3 w-56" /><Skeleton className="h-3 w-32" />
      </div>}
      <p className={styles.note}>Opens on any tab and stays open as you switch tabs. Esc closes it.</p>
    </div>
  </aside>;
}

/**
 * The live mirror of the stage, with the switches that change it. A
 * hackathon's lineup is its finalists, and its meet link shows in Stage.
 */
function OnStageCard({ slug, admin }: { slug: string; admin: AdminData }) {
  const { event } = admin;
  const demo = event.eventType === "demo";
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
    {/* On a hackathon the lineup is the finalists: "Now pitching" and "Up next". */}
    <div role="radiogroup" aria-label="Stage shows" className="dq-segmented w-full">
      <button type="button" role="radio" aria-checked={!lineup} data-pressed={!lineup ? "" : undefined} onClick={() => void run(() => setStageScreenMode({ slug, mode: "qr" }), "Could not change the stage.")}>QR code</button>
      <button type="button" role="radio" aria-checked={lineup} data-pressed={lineup ? "" : undefined} onClick={() => void run(() => setStageScreenMode({ slug, mode: "demo" }), "Could not change the stage.")}>{demo ? "Lineup" : "Finalists"}</button>
    </div>
    <div className={styles.toggles}>
      <Toggle label="Timer" checked={timerOn} onChange={(visible) => run(() => (lineup ? setDemoTimerVisible : setStageTimerVisible)({ slug, visible }), "Could not change the timer.")} />
      <Toggle label="Count" checked={event.showSubmissionCountOnStage} disabled={lineup} onChange={(visible) => run(() => setSubmissionCountVisible({ slug, visible }), "Could not change the count.")} />
      <Toggle label="Meet link" checked={event.showMeetLinkOnStage} disabled={!event.queuePublished || !event.meetUrl} title={!event.meetUrl ? "Add a meet link in Settings first." : event.queuePublished ? undefined : demo ? "Make the queue live first." : "Move to Stage first."} onChange={(visible) => run(() => setStageMeetLinkVisible({ slug, visible }), "Could not change the meet link.")} />
    </div>
  </section>;
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
    if (event.meetUrl) rows.push(["Meet link", <span key="meet" className="truncate" title={event.meetUrl}>{event.meetUrl.replace(/^https?:\/\//, "")}</span>]);
  } else {
    rows.push(["Demoers", `${admin.lineup.length}`]);
    rows.push(["Meet link", event.meetUrl ? <span className="truncate" title={event.meetUrl}>{event.meetUrl.replace(/^https?:\/\//, "")}</span> : "None"]);
    rows.push(["Queue", event.queuePublished ? "Live" : "Not live"]);
  }
  rows.push(["Submit link", event.submissionsOpen ? "Open" : "Closed"]);
  if (event.practice) {
    if (event.practice.copiedFromName) rows.push(["Copied from", event.practice.copiedFromName]);
    rows.push(["Tidies away", new Date(event.practice.tidiesAwayAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })]);
  }
  return <section className={`dq-card ${styles.sideCard}`} aria-labelledby="props-title">
    <div className={styles.sideHead}><h2 id="props-title">Properties</h2></div>
    <dl className={styles.props}>{rows.map(([term, value]) => <div key={term} className="contents"><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}
