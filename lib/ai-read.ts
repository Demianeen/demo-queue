/** How well a project fits a track's description. */
export const TRACK_FIT_LEVELS = ["strong", "partial", "weak"] as const;
export type TrackFitLevel = (typeof TRACK_FIT_LEVELS)[number];
/** How a project uses a sponsor: the product depends on it, a real part of the build, small or incidental, or no sign. */
export const SPONSOR_USE_LEVELS = ["core", "used", "light", "none"] as const;
export type SponsorUseLevel = (typeof SPONSOR_USE_LEVELS)[number];

export const TRACK_FIT_LABELS: Record<TrackFitLevel, string> = { strong: "Strong", partial: "Partial", weak: "Weak" };
export const SPONSOR_USE_LABELS: Record<SponsorUseLevel, string> = { core: "Core", used: "Used", light: "Light", none: "No sign" };

/** The read as judges and organisers get it (publicAiRead). */
export type AiReadView = {
  status: "ready" | "checking";
  overall: string | null;
  tracks: { id: string; name: string; level: TrackFitLevel | null; reason: string | null; described: boolean }[];
  sponsors: { id: string; name: string; level: SponsorUseLevel | null; reason: string | null }[];
};

/** Green for a fit or a real use, amber for a partial one, grey for weak or none. */
export type AiReadTone = "good" | "some" | "none";
const TONES: Record<TrackFitLevel | SponsorUseLevel, AiReadTone> = {
  strong: "good", core: "good", used: "good",
  partial: "some", light: "some",
  weak: "none", none: "none",
};

export type AiReadChip = {
  key: string;
  name: string;
  /** "Strong", "Used". */
  level: string;
  tone: AiReadTone;
  /** "AI agents · Strong fit: books meetings on its own…", for the hover. */
  tip: string;
};

/** One chip per picked track with a level, then one per sponsor with a level, in the event's order. */
export function aiReadChips(read: AiReadView | null | undefined): AiReadChip[] {
  if (!read || read.status !== "ready") return [];
  const tracks = read.tracks.flatMap((track) => track.level ? [{
    key: `t:${track.id}`,
    name: track.name,
    level: TRACK_FIT_LABELS[track.level],
    tone: TONES[track.level],
    tip: `${track.name} · ${TRACK_FIT_LABELS[track.level]} fit${track.reason ? `: ${track.reason}` : ""}`,
  }] : []);
  const sponsors = read.sponsors.flatMap((sponsor) => sponsor.level ? [{
    key: `s:${sponsor.id}`,
    name: sponsor.name,
    level: SPONSOR_USE_LABELS[sponsor.level],
    tone: TONES[sponsor.level],
    tip: `${sponsor.name} · ${SPONSOR_USE_LABELS[sponsor.level]}${sponsor.reason ? `: ${sponsor.reason}` : ""}`,
  }] : []);
  return [...tracks, ...sponsors];
}

/** Rows show up to this many AI chips; past it, one fewer and then "+N". */
export const ROW_AI_CHIP_LIMIT = 3;

/** Up to the limit, every chip; past it, the first (limit - 1) and the rest behind "+N". */
export function splitRowChips<T>(chips: T[], limit = ROW_AI_CHIP_LIMIT): { shown: T[]; rest: T[] } {
  if (chips.length <= limit) return { shown: chips, rest: [] };
  return { shown: chips.slice(0, limit - 1), rest: chips.slice(limit - 1) };
}
