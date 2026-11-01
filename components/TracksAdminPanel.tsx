"use client";

import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation } from "convex/react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { MAX_EVENT_TRACKS, MAX_TRACK_DESCRIPTION_LENGTH, MAX_TRACK_NAME_LENGTH } from "@/lib/tracks";
import styles from "./TracksAdminPanel.module.css";

export type AdminTrack = {
  id: Id<"eventTracks">;
  name: string;
  description?: string;
  submissionCount: number;
};

const DESCRIPTION_PLACEHOLDER = "Short description shown to teams (optional)";

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "data" in error && typeof error.data === "string") return error.data;
  return error instanceof Error ? error.message : fallback;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Enter saves the field, Escape puts back what was saved. */
function fieldKeys(event: KeyboardEvent<HTMLInputElement>, reset: () => void) {
  if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
  else if (event.key === "Escape") { reset(); requestAnimationFrame(() => (event.target as HTMLInputElement).blur()); }
}

export function TracksAdminPanel({
  slug,
  tracks,
  noTrackCount,
  legacyCategoryCount,
}: {
  slug: string;
  tracks: AdminTrack[];
  noTrackCount: number;
  legacyCategoryCount: number;
}) {
  const addTrack = useMutation(api.tracks.addTrack);
  const updateTrack = useMutation(api.tracks.updateTrack);
  const reorderTracks = useMutation(api.tracks.reorderTracks);
  const removeTrack = useMutation(api.tracks.removeTrack);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [confirmingId, setConfirmingId] = useState<Id<"eventTracks"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The order shown while a drag is saving, so the row does not jump back.
  const [order, setOrder] = useState<Id<"eventTracks">[] | null>(null);
  const byId = new Map(tracks.map((track) => [track.id, track]));
  const shown = order ? order.map((id) => byId.get(id)).filter((track): track is AdminTrack => Boolean(track)) : tracks;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (caught) {
      setError(errorMessage(caught, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const description = newDescription.trim() || undefined;
    if (await run(() => addTrack({ slug, name, description }), "Could not add the track.")) { setNewName(""); setNewDescription(""); }
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = shown.map((track) => track.id);
    const next = arrayMove(ids, ids.indexOf(active.id as Id<"eventTracks">), ids.indexOf(over.id as Id<"eventTracks">));
    setOrder(next);
    await run(() => reorderTracks({ slug, orderedIds: next }), "Could not reorder tracks.");
    setOrder(null);
  }

  async function remove(track: AdminTrack, confirmInUse: boolean) {
    if (track.submissionCount > 0 && !confirmInUse) {
      setConfirmingId(track.id);
      return;
    }
    if (await run(() => removeTrack({ slug, trackId: track.id, confirmInUse }), "Could not remove the track.")) {
      setConfirmingId(null);
    }
  }

  return (
    <section aria-labelledby="admin-tracks-heading" className={styles.panel}>
      <div>
        <h2 id="admin-tracks-heading" className={styles.title}>Tracks</h2>
        <p className={styles.note}>Teams pick none, one or several. Changes show on the form, judge pages and stage straight away.</p>
      </div>

      <div className={styles.list}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void onDragEnd(event)}>
          <SortableContext items={shown.map((track) => track.id)} strategy={verticalListSortingStrategy}>
            <ul className={styles.rows}>
              {shown.map((track) => <TrackRow key={track.id} track={track} busy={busy} confirming={confirmingId === track.id}
                onSave={(name, description) => run(() => updateTrack({ slug, trackId: track.id, name, description }), "Could not save the track.")}
                onRemove={(confirmInUse) => void remove(track, confirmInUse)} onKeep={() => setConfirmingId(null)} />)}
            </ul>
          </SortableContext>
        </DndContext>
        {tracks.length < MAX_EVENT_TRACKS ? (
          <form className={styles.addRow} onSubmit={add}>
            <input aria-label="New track name" className={styles.nameInput} maxLength={MAX_TRACK_NAME_LENGTH} onChange={(event) => setNewName(event.target.value)} placeholder="New track name" value={newName} />
            <input aria-label="New track description" className={styles.descriptionInput} maxLength={MAX_TRACK_DESCRIPTION_LENGTH} onChange={(event) => setNewDescription(event.target.value)} placeholder={DESCRIPTION_PLACEHOLDER} value={newDescription} />
            <Button disabled={busy || !newName.trim()} size="sm" type="submit" variant="outline">Add track</Button>
          </form>
        ) : null}
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <p className={styles.note}>
        {tracks.length > 0 || noTrackCount > 0 ? `No track picked: ${plural(noTrackCount, "submission")}. ` : ""}
        {tracks.length < MAX_EVENT_TRACKS ? `Up to ${MAX_EVENT_TRACKS} tracks.` : `An event can have up to ${MAX_EVENT_TRACKS} tracks.`}
      </p>
      {legacyCategoryCount > 0 ? (
        <p className={styles.note}>
          {plural(legacyCategoryCount, "older submission")} still show the category typed before tracks existed.
        </p>
      ) : null}
    </section>
  );
}

/** One track: name and description edit in place and save when you leave the field. */
function TrackRow({ track, busy, confirming, onSave, onRemove, onKeep }: {
  track: AdminTrack;
  busy: boolean;
  confirming: boolean;
  onSave: (name: string, description?: string) => Promise<boolean>;
  onRemove: (confirmInUse: boolean) => void;
  onKeep: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: track.id });
  const [name, setName] = useState(track.name);
  const [description, setDescription] = useState(track.description ?? "");
  // A change saved elsewhere (another organiser, the assistant) shows here too.
  useEffect(() => { setName(track.name); }, [track.name]);
  useEffect(() => { setDescription(track.description ?? ""); }, [track.description]);

  async function save() {
    const nextName = name.trim();
    const nextDescription = description.trim();
    if (!nextName) { setName(track.name); return; }
    if (nextName === track.name && nextDescription === (track.description ?? "")) return;
    if (!(await onSave(nextName, nextDescription || undefined))) { setName(track.name); setDescription(track.description ?? ""); }
  }

  return (
    <li ref={setNodeRef} className={styles.item} data-dragging={isDragging ? "" : undefined} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <div className={styles.row}>
        <button type="button" className={styles.grip} aria-label={`Move ${track.name}`} disabled={busy} {...attributes} {...listeners}><GripVertical aria-hidden /></button>
        <input aria-label={`Name for ${track.name}`} className={styles.nameInput} maxLength={MAX_TRACK_NAME_LENGTH} value={name}
          onChange={(event) => setName(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => fieldKeys(event, () => setName(track.name))} />
        <input aria-label={`Description for ${track.name}`} className={styles.descriptionInput} maxLength={MAX_TRACK_DESCRIPTION_LENGTH} placeholder={DESCRIPTION_PLACEHOLDER} value={description}
          onChange={(event) => setDescription(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => fieldKeys(event, () => setDescription(track.description ?? ""))} />
        <span className={styles.count}>{plural(track.submissionCount, "submission")}</span>
        <Button aria-label={`Remove ${track.name}`} title="Remove" disabled={busy} onClick={() => onRemove(false)} size="icon-xs" type="button" variant="ghost">
          <X aria-hidden />
        </Button>
      </div>
      {confirming ? (
        <div className={styles.confirm} role="alert">
          <span>
            {plural(track.submissionCount, "submission")} picked {track.name}. Removing it takes it off
            them; their other tracks stay.
          </span>
          <Button disabled={busy} onClick={() => onRemove(true)} size="sm" type="button" variant="destructive">
            Remove from {track.submissionCount}
          </Button>
          <Button disabled={busy} onClick={onKeep} size="sm" type="button" variant="outline">
            Keep
          </Button>
        </div>
      ) : null}
    </li>
  );
}
