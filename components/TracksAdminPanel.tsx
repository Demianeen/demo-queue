"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
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

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "data" in error && typeof error.data === "string") return error.data;
  return error instanceof Error ? error.message : fallback;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
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
  const [editingId, setEditingId] = useState<Id<"eventTracks"> | null>(null);
  const [confirmingId, setConfirmingId] = useState<Id<"eventTracks"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    if (await run(() => addTrack({ slug, name }), "Could not add the track.")) setNewName("");
  }

  async function move(index: number, offset: -1 | 1) {
    const ids = tracks.map((track) => track.id);
    const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run(() => reorderTracks({ slug, orderedIds: ids }), "Could not reorder tracks.");
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
    <section aria-labelledby="admin-tracks-heading" className={`panel ${styles.panel}`}>
      <div className={styles.heading}>
        <h2 id="admin-tracks-heading">Tracks</h2>
        <p>Teams pick none, one or several. Changes show on the form, judge pages and stage straight away.</p>
      </div>

      <div className={styles.list}>
        {tracks.map((track, index) =>
          editingId === track.id ? (
            <RenameRow
              key={track.id}
              busy={busy}
              track={track}
              onCancel={() => setEditingId(null)}
              onSave={async (name, description) => {
                if (await run(() => updateTrack({ slug, trackId: track.id, name, description }), "Could not rename the track.")) {
                  setEditingId(null);
                }
              }}
            />
          ) : (
            <div className={styles.item} key={track.id}>
              <div className={styles.row}>
                <div className={styles.name}>
                  <strong>{track.name}</strong>
                  {track.description ? <span>{track.description}</span> : null}
                </div>
                <span className={styles.count}>{plural(track.submissionCount, "submission")}</span>
                <div className={styles.rowActions}>
                  <Button
                    aria-label={`Move ${track.name} up`}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <ArrowUp aria-hidden size={14} />
                  </Button>
                  <Button
                    aria-label={`Move ${track.name} down`}
                    disabled={busy || index === tracks.length - 1}
                    onClick={() => move(index, 1)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <ArrowDown aria-hidden size={14} />
                  </Button>
                  <Button disabled={busy} onClick={() => setEditingId(track.id)} size="sm" type="button" variant="outline">
                    Rename
                  </Button>
                  <Button
                    aria-label={`Remove ${track.name}`}
                    disabled={busy}
                    onClick={() => remove(track, false)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <X aria-hidden size={15} />
                  </Button>
                </div>
              </div>
              {confirmingId === track.id ? (
                <div className={styles.confirm} role="alert">
                  <span>
                    {plural(track.submissionCount, "submission")} picked {track.name}. Removing it takes it off
                    them; their other tracks stay.
                  </span>
                  <Button disabled={busy} onClick={() => remove(track, true)} size="sm" type="button" variant="destructive">
                    Remove from {track.submissionCount}
                  </Button>
                  <Button disabled={busy} onClick={() => setConfirmingId(null)} size="sm" type="button" variant="outline">
                    Keep
                  </Button>
                </div>
              ) : null}
            </div>
          ),
        )}
        {tracks.length < MAX_EVENT_TRACKS ? (
          <form className={styles.addRow} onSubmit={add}>
            <label className="sr-only" htmlFor="admin-new-track">
              New track name
            </label>
            <input
              id="admin-new-track"
              maxLength={MAX_TRACK_NAME_LENGTH}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="New track name"
              value={newName}
            />
            <Button disabled={busy || !newName.trim()} size="sm" type="submit">
              Add track
            </Button>
          </form>
        ) : (
          <p className={styles.note}>An event can have up to {MAX_EVENT_TRACKS} tracks.</p>
        )}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {tracks.length > 0 || noTrackCount > 0 ? (
        <p className={styles.note}>No track picked: {plural(noTrackCount, "submission")}.</p>
      ) : null}
      {legacyCategoryCount > 0 ? (
        <p className={styles.note}>
          {plural(legacyCategoryCount, "older submission")} still show the category typed before tracks existed.
        </p>
      ) : null}
    </section>
  );
}

function RenameRow({
  track,
  busy,
  onSave,
  onCancel,
}: {
  track: AdminTrack;
  busy: boolean;
  onSave: (name: string, description?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(track.name);
  const [description, setDescription] = useState(track.description ?? "");

  return (
    <form
      className={styles.editRow}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(name, description.trim() || undefined);
      }}
    >
      <input
        aria-label={`Name for ${track.name}`}
        autoFocus
        maxLength={MAX_TRACK_NAME_LENGTH}
        onChange={(event) => setName(event.target.value)}
        value={name}
      />
      <input
        aria-label={`Description for ${track.name}`}
        maxLength={MAX_TRACK_DESCRIPTION_LENGTH}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Short description shown to teams (optional)"
        value={description}
      />
      <div className={styles.rowActions}>
        <Button disabled={busy || !name.trim()} size="sm" type="submit">
          Save
        </Button>
        <Button disabled={busy} onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
      </div>
    </form>
  );
}
