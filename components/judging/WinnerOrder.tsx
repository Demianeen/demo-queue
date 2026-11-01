"use client";

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { moveItem, placeLabel, WINNER_COUNT } from "@/lib/judging-board";
import { formatScore } from "./ProjectRows";
import styles from "./judging.module.css";

export type WinnerOrderItem = { title: string; score: number | null };

/**
 * The finalists in order: drag or Alt+arrows to reorder; a line marks the
 * winners. Judging's Finalists and the Stage use the same list. Without
 * onRemove, finalists can only be moved, not removed.
 */
export function WinnerOrder({ order, items, disabled, onReorder, onRemove }: {
  order: string[];
  items: ReadonlyMap<string, WinnerOrderItem>;
  disabled: boolean;
  onReorder: (next: string[]) => void;
  onRemove?: (id: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    onReorder(moveItem(order, order.indexOf(String(event.active.id)), order.indexOf(String(event.over.id))));
  }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
    <SortableContext items={order} strategy={verticalListSortingStrategy}>
      <ul className={styles.finalists} aria-label="Finalists in order. The top three are the winners.">
        {order.map((id, index) => <SortableFinalist key={id} id={id} index={index} count={order.length} title={items.get(id)?.title ?? "A project"} score={items.get(id)?.score ?? null} disabled={disabled}
          onMove={(to) => onReorder(moveItem(order, index, to))} onRemove={onRemove && (() => onRemove(id))} />)}
      </ul>
    </SortableContext>
  </DndContext>;
}

function SortableFinalist({ id, index, count, title, score, disabled, onMove, onRemove }: { id: string; index: number; count: number; title: string; score: number | null; disabled: boolean; onMove: (to: number) => void; onRemove?: () => void }) {
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
      {onRemove && <Button variant="ghost" size="icon-xs" aria-label={`Remove ${title} from the finalists`} disabled={disabled} onClick={onRemove}><X aria-hidden /></Button>}
    </li>
    {index === WINNER_COUNT - 1 && count > WINNER_COUNT && <li className={styles.winnerLine} aria-hidden>Drag a finalist above this line to make it a winner</li>}
  </>;
}
