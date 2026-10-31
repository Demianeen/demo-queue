"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, SkipBack, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ShortcutTooltip, useCommands, type Command } from "@/components/shell/commands";
import { judgingPath } from "@/lib/admin-views";
import { timeLeftMs } from "@/lib/timer-clock";
import { InPageLink } from "@/components/InPageLink";
import { errorText } from "./changes";
import { ExactTimer, ListSkeleton, TrackChips, teamLine, useFinalists, type AdminData } from "./PhaseTabs";
import styles from "./live.module.css";

// Extra time for the pitch on now; Next starts the following pitch at the usual length again.
const STAGE_ADDS = [30, 60];

type Row = { id: Id<"submissions">; title: string; team: string; tracks: string[]; score: number | null };

async function act(action: () => Promise<unknown>, failure: string) {
  try { await action(); } catch (error) { toast.error(errorText(error, failure)); }
}

/**
 * A hackathon's Stage: the finalists are the lineup, in pitch order. The
 * stage clock times each pitch; Next and Previous move the current
 * presenter, and the projector shows "Now pitching" and "Up next" from this
 * list. Before Stage it shows the finalists that will pitch.
 */
export function StageTab({ slug, admin }: { slug: string; admin: AdminData }) {
  const { event } = admin;
  const finalists = useFinalists(slug, admin);
  const reorderLineup = useMutation(api.events.reorderLineup);
  const pickNext = useMutation(api.events.pickNext);
  const markNoShow = useMutation(api.events.markNoShow);
  const restorePreviousPresenter = useMutation(api.events.restorePreviousPresenter);
  const startDemoTimer = useMutation(api.events.startDemoTimer);
  const pauseDemoTimer = useMutation(api.events.pauseDemoTimer);
  const adjustDemoTimer = useMutation(api.events.adjustDemoTimer);
  // Submitting the same finalists again lines them up: for an event that reached Stage before finalists became the lineup.
  const submitFinalists = useMutation(api.judging.submitFinalists);
  const onStage = event.phase === "stage" || event.phase === "finished";
  const scores = useMemo(() => new Map(finalists?.rows.map((row) => [row.id, row.score]) ?? []), [finalists]);

  const serverLineup = useMemo<Row[]>(() => admin.lineup.map((item) => ({
    id: item.id, title: item.demoTitle || item.name, team: teamLine(item), tracks: item.tracks, score: scores.get(String(item.id)) ?? null,
  })), [admin.lineup, scores]);
  // A local order so a drag shows at once; it follows the server whenever that changes.
  const [order, setOrder] = useState<Id<"submissions">[] | null>(null);
  const serverKey = serverLineup.map((row) => row.id).join(",");
  useEffect(() => { setOrder(null); }, [serverKey]);
  const byId = new Map(serverLineup.map((row) => [row.id, row]));
  const lineup = order ? order.map((id) => byId.get(id)).filter((row): row is Row => Boolean(row)) : serverLineup;
  const live = event.queuePublished && onStage;
  const current = live ? lineup[0] ?? null : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = lineup.map((row) => row.id);
    const next = arrayMove(ids, ids.indexOf(active.id as Id<"submissions">), ids.indexOf(over.id as Id<"submissions">));
    setOrder(next);
    void act(() => reorderLineup({ slug, orderedIds: next }), "Could not change the pitch order.");
  }

  const next = () => act(() => pickNext({ slug, expectedCurrentId: current?.id }), "Could not move to the next pitch.");
  const previous = () => act(() => restorePreviousPresenter({ slug }), "Could not go back to the previous pitch.");
  const noShow = () => act(() => markNoShow({ slug, expectedCurrentId: current?.id }), "Could not mark the no-show.");
  const commands = useMemo<Command[]>(() => live ? [
    { id: "stage-next", group: "This page", label: "Next pitch", keys: ["N"], disabled: !current, run: () => void next() },
    { id: "stage-previous", group: "This page", label: "Previous pitch", disabled: !event.canRestorePrevious, run: () => void previous() },
  ] : [], [live, current, event.canRestorePrevious]); // eslint-disable-line react-hooks/exhaustive-deps
  useCommands("stage-tab", commands);

  const demoTimer = event.demoTimer;
  return <div className={styles.phasePage}>
    {!onStage && <p className={styles.hint}>Stage starts when you move to it from the phase control: the submitted finalists become the lineup, in this order.</p>}
    <ExactTimer label={current ? `${current.title}: pitch time left` : "Stage clock"} timer={demoTimer} adds={STAGE_ADDS}
      help={!current ? "Times each pitch. It starts with the first finalist." : event.showDemoTimerOnStage ? "Each pitch starts with this. The room sees it while Timer is on in the Room panel." : "Timer is off in the Room panel: the room does not see it. The clock keeps running here."}
      onSet={(ms) => adjustDemoTimer({ slug, deltaMs: Math.round((ms - timeLeftMs({ ...demoTimer, running: demoTimer.status === "running" }, Date.now())) / 1000) * 1000 })}
      onPause={() => pauseDemoTimer({ slug })} onResume={() => startDemoTimer({ slug })} resumeLabel="Start"
      extra={live ? <>
        <Button variant="outline" disabled={!event.canRestorePrevious} onClick={() => void previous()}><SkipBack aria-hidden />Previous</Button>
        <Button variant="outline" disabled={!current} onClick={() => void noShow()}>No-show</Button>
        <ShortcutTooltip label="Next pitch" keys={["N"]}><Button disabled={!current} onClick={() => void next()}>Next<SkipForward aria-hidden /></Button></ShortcutTooltip>
      </> : undefined} />
    <section className={styles.section} aria-labelledby="stage-finalists">
      <div className={styles.sectionHead}>
        <h2 id="stage-finalists">Finalists <span className={styles.hint}>{onStage ? lineup.length : finalists?.rows.length ?? ""}</span></h2>
        <span className={styles.hint}>{onStage ? "in pitch order · drag to reorder" : "in the order they will pitch"}</span>
        <InPageLink href={judgingPath(slug, { judging: "finalists" })} className={styles.linkButton}>Pick finalists and winners on Judging →</InPageLink>
      </div>
      {onStage ? (lineup.length === 0
        ? <NoFinalists slug={slug} pitched={admin.completed.length} notLinedUp={admin.completed.length === 0 ? finalists?.rows.length ?? 0 : 0}
          onLineUp={() => act(() => submitFinalists({ slug, finalistIds: finalists?.rows.map((row) => row.id as Id<"submissions">) ?? [] }), "Could not line up the finalists.")} />
        : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={lineup.map((row) => row.id)} strategy={verticalListSortingStrategy}>
            <ol className={styles.list}>{lineup.map((row, index) => <PitchRow key={row.id} row={row} label={!live ? String(index + 1) : index === 0 ? "Now" : index === 1 ? "Next" : String(index + 1)} current={live && index === 0} />)}</ol>
          </SortableContext>
        </DndContext>)
        : finalists === null ? <ListSkeleton rows={5} />
        : finalists.rows.length === 0 ? <NoFinalists slug={slug} pitched={0} />
        : <ol className={styles.list}>{finalists.rows.map((row, index) => <li key={row.id} className={styles.listRow}>
          <span className={styles.place}>{index + 1}</span>
          <span className={styles.listTitle}>{row.title}</span>
          <span className={styles.listTeam}>{row.team}</span>
          <TrackChips tracks={row.tracks} />
          <span className={`dq-mono ${styles.listScore}`}>{row.score === null ? "–" : row.score.toFixed(2)}</span>
        </li>)}</ol>}
      {admin.completed.length > 0 && <details className={styles.pitched}>
        <summary>Pitched {admin.completed.length}</summary>
        <ol className={styles.list}>{admin.completed.map((item) => <li key={item.id} className={styles.listRow}>
          <span className={styles.place} aria-hidden>✓</span><span className={styles.listTitle}>{item.demoTitle || item.name}</span><span className={styles.listTeam}>{teamLine(item)}</span>
        </li>)}</ol>
      </details>}
    </section>
    <p className={styles.footer}>
      <span>{event.judgingStatus === "closed" ? "Judging closed" : "Judging still open"}</span>
      {event.judgingSheetUrl && <a className={styles.linkButton} href={event.judgingSheetUrl} target="_blank" rel="noreferrer">Open judging sheet ↗</a>}
    </p>
  </div>;
}

function NoFinalists({ slug, pitched, notLinedUp = 0, onLineUp }: { slug: string; pitched: number; notLinedUp?: number; onLineUp?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  if (notLinedUp > 0 && onLineUp) return <div className={styles.emptyCard}>
    <strong>The finalists are not lined up yet</strong>
    <span>This event reached Stage before finalists became the lineup. Line them up in their pitch order; nothing else changes.</span>
    <Button size="sm" disabled={busy} onClick={() => { setBusy(true); void onLineUp().finally(() => setBusy(false)); }}>Line up {notLinedUp} finalist{notLinedUp === 1 ? "" : "s"}</Button>
  </div>;
  return <div className={styles.emptyCard}>
    <strong>{pitched > 0 ? "Every finalist has pitched" : "No finalists yet"}</strong>
    <span>{pitched > 0 ? "Previous brings the last one back." : "Submit finalists on Judging; they become the lineup here."}</span>
    {pitched === 0 && <Button variant="outline" size="sm" render={<InPageLink href={judgingPath(slug, { judging: "finalists" })} />} nativeButton={false}>Open finalists</Button>}
  </div>;
}

function PitchRow({ row, label, current }: { row: Row; label: string; current: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  return <li ref={setNodeRef} className={styles.listRow} data-current={current ? "" : undefined} data-dragging={isDragging ? "" : undefined}
    style={{ transform: CSS.Transform.toString(transform), transition }}>
    <button type="button" className={styles.grip} aria-label={`Move ${row.title}`} {...attributes} {...listeners}><GripVertical aria-hidden /></button>
    <span className={styles.place}>{label}</span>
    <span className={styles.listTitle}>{row.title}</span>
    <span className={styles.listTeam}>{row.team}</span>
    <TrackChips tracks={row.tracks} />
    <span className={`dq-mono ${styles.listScore}`}>{row.score === null ? "–" : row.score.toFixed(2)}</span>
  </li>;
}
