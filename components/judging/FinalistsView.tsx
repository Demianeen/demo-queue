"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { errorText } from "@/components/live/changes";
import { TimeAgo } from "@/components/live/TimeAgo";
import { addFinalist, finalistOrder, moveItem, placeLabel, REVIEW_TARGET, WINNER_COUNT, type RankedRow } from "@/lib/judging-board";
import { CriteriaChip, CriteriaHeader, formatScore, slots } from "./ProjectRows";
import type { BoardRow } from "./JudgingPage";
import styles from "./judging.module.css";

function clockTime(at: number) {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Finalists: tick finalists from every project, wherever they rank, then
 * submit them; then order them, and the top three are the winners. Both go
 * through the versioned judging decision, which confirms the results once
 * judging is closed and both are submitted.
 */
export function FinalistsView({ slug, closed, rows, visibleRows, loading, toolbar, filters, filtered, onClearFilters }: {
  slug: string;
  closed: boolean;
  /** Every project, ranked: the card's scores. */
  rows: RankedRow<BoardRow>[];
  /** After the search and track filter: the list. */
  visibleRows: RankedRow<BoardRow>[];
  loading: boolean;
  toolbar: ReactNode;
  filters: ReactNode;
  filtered: boolean;
  onClearFilters: () => void;
}) {
  const decision = useQuery(api.judging.getFinalistDecision, closed ? { slug } : "skip");
  const saveFinalistDraft = useMutation(api.judging.saveFinalistDraft);
  const submitFinalists = useMutation(api.judging.submitFinalists);
  const savePlacementDraft = useMutation(api.judging.savePlacementDraft);
  const submitPlacements = useMutation(api.judging.submitPlacements);
  const scoreById = useMemo(() => new Map(rows.map((row) => [row.id, row.final])), [rows]);
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const serverFinalists = useMemo(() => (decision?.finalistIds ?? []).map(String), [decision?.finalistIds]);
  const serverPlacements = useMemo(() => (decision?.placementIds ?? []).map(String), [decision?.placementIds]);
  const serverKey = `${serverFinalists.join(",")}|${serverPlacements.join(",")}`;
  // Local copies so a tick or a drag shows at once; they follow the server whenever it changes.
  const [ticked, setTicked] = useState<string[] | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTicked(null); setOrder(null); }, [serverKey]);

  const finalists = ticked ?? serverFinalists;
  const finalistsSubmitted = decision?.finalistStatus === "submitted" && ticked === null;
  const shownOrder = order ?? finalistOrder(finalists, finalistsSubmitted ? serverPlacements : []);
  const winners = shownOrder.slice(0, WINNER_COUNT);
  const winnersSubmitted = decision?.placementStatus === "submitted" && winners.join(",") === serverPlacements.join(",");

  async function act(action: () => Promise<unknown>, failure: string, done?: string) {
    setBusy(true);
    try { await action(); if (done) toast(done); } catch (error) { toast.error(errorText(error, failure)); setTicked(null); setOrder(null); } finally { setBusy(false); }
  }
  function toggle(id: string) {
    const next = finalists.includes(id) ? shownOrder.filter((item) => item !== id) : addFinalist(shownOrder, id, scoreById);
    setTicked(next);
    setOrder(null);
    void act(() => saveFinalistDraft({ slug, finalistIds: next as Id<"submissions">[] }), "Could not save the finalists.");
  }
  // Before finalists are submitted a drag orders the draft: submitting keeps that order, so the winners are picked too.
  function reorderDraft(next: string[]) {
    setTicked(next);
    void act(() => saveFinalistDraft({ slug, finalistIds: next as Id<"submissions">[] }), "Could not save the order.");
  }
  function reorder(next: string[]) {
    setOrder(next);
    // Only the winners are saved: a move below the line, or one that changes nothing, keeps them submitted.
    if (next.slice(0, WINNER_COUNT).join(",") === winners.join(",")) return;
    void act(() => savePlacementDraft({ slug, placementIds: next.slice(0, WINNER_COUNT) as Id<"submissions">[] }), "Could not save the order.");
  }

  if (!closed) return <div className={styles.page}><div className={styles.main}>
    {toolbar}
    <div className={`dq-card ${styles.emptyCard}`}>
      <h3>Finalists open once judging is closed</h3>
      <p>Then tick any project to make it a finalist, wherever it ranks, and submit them. After the final presentations, drag the finalists into order: the top three are the winners.</p>
    </div>
  </div></div>;

  const loadingDecision = decision === undefined;
  return <div className={styles.page}>
    <div className={styles.main}>
      {toolbar}
      <ol className={styles.steps} aria-label="Steps">
        <li data-done={finalistsSubmitted ? "" : undefined}>{finalistsSubmitted ? <Check aria-hidden /> : <span>1</span>}{finalistsSubmitted ? "Finalists submitted" : "Pick finalists"}</li>
        <li aria-hidden className={styles.stepLine} />
        <li data-done={winnersSubmitted ? "" : undefined} data-current={finalistsSubmitted && !winnersSubmitted ? "" : undefined}>{winnersSubmitted ? <Check aria-hidden /> : <span>2</span>}{winnersSubmitted ? "Winners submitted" : "Winners after the final presentations"}</li>
        {decision?.updatedAt && (ticked !== null || order !== null || decision.finalistStatus !== "submitted" || decision.placementStatus === "draft") && <li className={styles.saved}>{busy ? "Saving…" : <>Draft saved <TimeAgo at={decision.updatedAt} /></>}</li>}
      </ol>
      <div className={`dq-card ${styles.list}`}>
        <div className={styles.listHead}><strong>All {rows.length} projects</strong>{filters}</div>
        <div className={styles.rankHead} role="row">
          <span className={styles.tick} aria-hidden />
          <span className={styles.rank}>#</span>
          <span className={styles.title}>Project</span>
          <CriteriaHeader slotCount={REVIEW_TARGET} />
          <span className={styles.final}>Final</span>
        </div>
        {loading || loadingDecision ? Array.from({ length: 6 }, (_, index) => <div key={index} className={styles.row} aria-hidden><Skeleton className="size-4 rounded" /><Skeleton className="h-3 w-40" /><Skeleton className="ml-auto h-3 w-10" /></div>)
          : visibleRows.length === 0 ? <div className={styles.empty}>{filtered ? <>No projects match. <Button variant="link" size="sm" onClick={onClearFilters}>Clear the search and track</Button></> : "No projects in judging."}</div>
          : visibleRows.map((row) => {
            const checked = finalists.includes(row.id);
            return <label key={row.id} className={styles.row} data-selected={checked ? "" : undefined}>
              <span className={styles.tick}><Checkbox checked={checked} disabled={busy} onCheckedChange={() => toggle(row.id)} aria-label={`${row.title} is a finalist`} /></span>
              <span className={styles.rank}>{row.rank}</span>
              <span className={styles.title}><span className={styles.titleText}>{row.title}</span><span className={styles.team}>{row.team}</span></span>
              <span className={styles.chips}>{slots(row, REVIEW_TARGET).map((chip, index) => <CriteriaChip key={chip?.judgeKey ?? `empty-${index}`} chip={chip} />)}</span>
              <span className={`dq-mono ${styles.final}`}>{formatScore(row.final)}</span>
            </label>;
          })}
      </div>
      <p className={styles.footnote}>Tick any project to make it a finalist, wherever it ranks. Scores are the same as on Ranking.</p>
    </div>
    <aside className={styles.side} aria-label="Finalists">
      <section className={`dq-card ${styles.card}`} aria-labelledby="finalists-title">
        <div className={styles.cardHead}>
          <span id="finalists-title">Finalists <span className={styles.count}>{finalists.length}</span></span>
          <span className={styles.muted}>{decision?.finalistStatus === "submitted" && decision.updatedAt ? `submitted ${clockTime(decision.updatedAt)} · version ${decision.finalistVersion}` : decision?.finalistVersion ? `draft · version ${decision.finalistVersion} submitted before` : "draft"}</span>
        </div>
        {decision?.placementStatus === "needs_review" && <p className={styles.warning}>The finalists changed after the winners were picked. Check the order and submit the winners again.</p>}
        {loadingDecision ? <Skeleton className="h-24 w-full" />
          : finalists.length === 0 ? <p className={styles.help}>No finalists yet. Tick projects on the left.</p>
          : <WinnerOrder order={shownOrder} rowById={rowById} disabled={busy} onReorder={finalistsSubmitted ? reorder : reorderDraft} onRemove={toggle} />}
        <div className={styles.cardFoot}>
          {finalistsSubmitted
            ? <><p className={styles.help}>Starts in the order you submitted. Drag, or Alt and an arrow key, to reorder. The top three are the winners.</p>
              <Button size="sm" disabled={busy || winnersSubmitted || finalists.length === 0} onClick={() => void act(() => submitPlacements({ slug, placementIds: winners as Id<"submissions">[] }), "Could not submit the winners.", "Winners submitted.")}>{winnersSubmitted ? "Winners submitted" : "Submit winners"}</Button></>
            : <><p className={styles.help}>Drag, or Alt and an arrow key, to order them now or after the final presentations. The top three are the winners, and this is the pitch order.</p>
              <Button size="sm" disabled={busy || finalists.length === 0} onClick={() => void act(() => submitFinalists({ slug, finalistIds: shownOrder as Id<"submissions">[] }), "Could not submit the finalists.", "Finalists submitted.")}>Submit finalists</Button></>}
        </div>
        {winnersSubmitted && <p className={styles.help}>Winners submitted {decision?.updatedAt ? clockTime(decision.updatedAt) : ""} · version {decision?.placementVersion}. Reordering saves a new draft until you submit again.</p>}
      </section>
    </aside>
  </div>;
}

/** The submitted finalists in order: drag or Alt+arrows to reorder; a line marks the winners. */
function WinnerOrder({ order, rowById, disabled, onReorder, onRemove }: { order: string[]; rowById: ReadonlyMap<string, RankedRow<BoardRow>>; disabled: boolean; onReorder: (next: string[]) => void; onRemove: (id: string) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    onReorder(moveItem(order, order.indexOf(String(event.active.id)), order.indexOf(String(event.over.id))));
  }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
    <SortableContext items={order} strategy={verticalListSortingStrategy}>
      <ul className={styles.finalists} aria-label="Finalists in order. The top three are the winners.">
        {order.map((id, index) => <SortableFinalist key={id} id={id} index={index} count={order.length} title={rowById.get(id)?.title ?? "A project"} score={rowById.get(id)?.final ?? null} disabled={disabled}
          onMove={(to) => onReorder(moveItem(order, index, to))} onRemove={() => onRemove(id)} />)}
      </ul>
    </SortableContext>
  </DndContext>;
}

function SortableFinalist({ id, index, count, title, score, disabled, onMove, onRemove }: { id: string; index: number; count: number; title: string; score: number | null; disabled: boolean; onMove: (to: number) => void; onRemove: () => void }) {
  const sortable = useSortable({ id, disabled });
  const winner = index < WINNER_COUNT;
  return <>
    <li ref={sortable.setNodeRef} className={styles.finalist} data-winner={winner ? "" : undefined} data-dragging={sortable.isDragging ? "" : undefined}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
      <button type="button" className={styles.handle} aria-label={`Move ${title}. Alt and an arrow key moves it up or down.`} disabled={disabled} {...sortable.attributes} {...sortable.listeners}
        onKeyDown={(event) => {
          if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); onMove(index + (event.key === "ArrowUp" ? -1 : 1)); return; }
          sortable.listeners?.onKeyDown?.(event);
        }}><GripVertical aria-hidden /></button>
      <span className={styles.place}>{placeLabel(index)}</span>
      <span className={styles.finalistTitle}>{title}</span>
      <span className="dq-mono">{formatScore(score)}</span>
      <Button variant="ghost" size="icon-xs" aria-label={`Remove ${title} from the finalists`} disabled={disabled} onClick={onRemove}><X aria-hidden /></Button>
    </li>
    {index === WINNER_COUNT - 1 && count > WINNER_COUNT && <li className={styles.winnerLine} aria-hidden>Drag a finalist above this line to make it a winner</li>}
  </>;
}
