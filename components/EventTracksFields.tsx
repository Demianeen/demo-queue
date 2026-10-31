"use client";

import { useRef } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MAX_EVENT_TRACKS, MAX_TRACK_DESCRIPTION_LENGTH, MAX_TRACK_NAME_LENGTH } from "@/lib/tracks";

export type DraftTrack = { key: number; name: string; description: string };

/** Track rows on the create event form. Blank rows are dropped on submit. */
export function EventTracksFields({
  tracks,
  onChange,
}: {
  tracks: DraftTrack[];
  onChange: (next: DraftTrack[]) => void;
}) {
  const nextKey = useRef(tracks.reduce((max, track) => Math.max(max, track.key), 0) + 1);

  function update(key: number, patch: Partial<DraftTrack>) {
    onChange(tracks.map((track) => (track.key === key ? { ...track, ...patch } : track)));
  }

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= tracks.length) return;
    const next = [...tracks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function add() {
    onChange([...tracks, { key: nextKey.current++, name: "", description: "" }]);
  }

  return (
    <fieldset className="new-event-field workspace-tracks" aria-describedby="tracks-help">
      <legend className="workspace-label">Tracks</legend>
      {tracks.map((track, index) => (
        <div className="workspace-track-row" key={track.key}>
          <div className="workspace-track-inputs">
            <Input
              aria-label={`Track ${index + 1} name`}
              className="new-event-input"
              data-size="track"
              maxLength={MAX_TRACK_NAME_LENGTH}
              onChange={(event) => update(track.key, { name: event.target.value })}
              placeholder="Track name"
              value={track.name}
            />
            <Input
              aria-label={`Track ${index + 1} description`}
              className="new-event-input workspace-track-description"
              data-size="name"
              maxLength={MAX_TRACK_DESCRIPTION_LENGTH}
              onChange={(event) => update(track.key, { description: event.target.value })}
              placeholder="Short description shown to teams (optional)"
              value={track.description}
            />
          </div>
          <div className="workspace-track-actions">
            <Button
              aria-label={`Move track ${index + 1} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ArrowUp aria-hidden size={15} />
            </Button>
            <Button
              aria-label={`Move track ${index + 1} down`}
              disabled={index === tracks.length - 1}
              onClick={() => move(index, 1)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ArrowDown aria-hidden size={15} />
            </Button>
            <Button
              aria-label={`Remove track ${track.name || index + 1}`}
              onClick={() => onChange(tracks.filter((candidate) => candidate.key !== track.key))}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden size={16} />
            </Button>
          </div>
        </div>
      ))}
      {tracks.length < MAX_EVENT_TRACKS ? (
        <div>
          <Button className="workspace-track-add" onClick={add} type="button" variant="outline" size="sm">
            <Plus aria-hidden size={16} /> Add track
          </Button>
        </div>
      ) : null}
      <p id="tracks-help" className="new-event-help">
        Optional. Teams pick none, one or several; none means the main event. Descriptions are shown to teams. You can change them later in Settings.
      </p>
    </fieldset>
  );
}
