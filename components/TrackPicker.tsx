"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";

export type TrackOption = {
  id: Id<"eventTracks">;
  name: string;
  description?: string;
};

/**
 * Toggle chips for an event's tracks. A submission can pick none, one or
 * several; the server checks every id belongs to the event.
 */
export function TrackPicker({
  tracks,
  value,
  onChange,
  disabled,
  hint = "pick any that fit, or none",
}: {
  tracks: TrackOption[];
  value: Id<"eventTracks">[];
  onChange: (next: Id<"eventTracks">[]) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const labelId = useId();
  if (tracks.length === 0) return null;
  const chosen = new Set(value);

  function toggle(id: Id<"eventTracks">) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Keep the event's track order, not the click order.
    onChange(tracks.filter((track) => next.has(track.id)).map((track) => track.id));
  }

  return (
    <div aria-labelledby={labelId} className="field track-picker" role="group">
      <div className="field-label-group">
        <span className="track-picker-label" id={labelId}>
          Tracks
        </span>
        <span className="track-picker-hint">{hint}</span>
      </div>
      <div className="track-picker-chips">
        {tracks.map((track) => {
          const pressed = chosen.has(track.id);
          return (
            <button
              aria-pressed={pressed}
              className="track-chip"
              disabled={disabled}
              key={track.id}
              onClick={() => toggle(track.id)}
              title={track.description}
              type="button"
            >
              {pressed ? <Check aria-hidden size={14} strokeWidth={2.5} /> : null}
              {track.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TrackPills({ tracks, empty }: { tracks: string[]; empty?: string }) {
  if (tracks.length === 0) {
    return empty ? <span className="track-pill-empty">{empty}</span> : null;
  }
  return (
    <span className="track-pills">
      {tracks.map((track) => (
        <span className="track-pill" key={track}>
          {track}
        </span>
      ))}
    </span>
  );
}
