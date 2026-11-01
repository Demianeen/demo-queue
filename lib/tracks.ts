// Shared, framework-free rules for event tracks. Used by the Convex functions
// and by the forms so both enforce the same limits.

export const MAX_EVENT_TRACKS = 20;
export const MAX_TRACK_NAME_LENGTH = 40;
export const MAX_TRACK_DESCRIPTION_LENGTH = 140;

export type TrackInput = { name: string; description?: string };
export type NormalizedTrackInput = { name: string; description?: string };

export function trackKey(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

export function normalizeTrackInput(input: TrackInput): NormalizedTrackInput {
  const name = input.name.normalize("NFKC").trim().replace(/\s+/g, " ");
  const description = input.description?.trim().replace(/\s+/g, " ") || undefined;
  if (!name) throw new Error("Enter a track name.");
  if (name.length > MAX_TRACK_NAME_LENGTH) {
    throw new Error(`Track names must be ${MAX_TRACK_NAME_LENGTH} characters or fewer.`);
  }
  if (description && description.length > MAX_TRACK_DESCRIPTION_LENGTH) {
    throw new Error(`Track descriptions must be ${MAX_TRACK_DESCRIPTION_LENGTH} characters or fewer.`);
  }
  return { name, description };
}

/**
 * Validates a whole track list (event creation). Blank rows are dropped, names
 * must be unique ignoring case, and the list has at most MAX_EVENT_TRACKS entries.
 */
export function normalizeTrackList(inputs: TrackInput[]): NormalizedTrackInput[] {
  const tracks = inputs
    .filter((input) => input.name.trim() || input.description?.trim())
    .map(normalizeTrackInput);
  if (tracks.length > MAX_EVENT_TRACKS) {
    throw new Error(`Add no more than ${MAX_EVENT_TRACKS} tracks.`);
  }
  const seen = new Set<string>();
  for (const track of tracks) {
    const key = trackKey(track.name);
    if (seen.has(key)) throw new Error(`Each track needs a different name. "${track.name}" is listed twice.`);
    seen.add(key);
  }
  return tracks;
}

type TrackLike = { name: string };

/**
 * The track names to show for a submission. A submission that has never been
 * given tracks (`trackIds` undefined) falls back to its legacy free-text
 * category until the category migration has run.
 */
export function submissionTrackNames<Id extends string>(
  submission: { trackIds?: Id[]; category?: string },
  tracksById: ReadonlyMap<Id, TrackLike>,
): string[] {
  if (submission.trackIds === undefined) {
    const legacy = submission.category?.trim();
    return legacy ? [legacy] : [];
  }
  return submission.trackIds.flatMap((id) => {
    const track = tracksById.get(id);
    return track ? [track.name] : [];
  });
}
