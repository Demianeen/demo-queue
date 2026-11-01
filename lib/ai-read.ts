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

/** Whether a claimed feature looks built in the code read (v3 summaries). */
export type BuiltStatusView = "working" | "partial" | "stubbed" | "not_read";
export const BUILT_STATUS_LABELS: Record<BuiltStatusView, string> = { working: "Working", partial: "Partial", stubbed: "Stubbed", not_read: "Not read" };
export const BUILT_STATUS_TONES: Record<BuiltStatusView, AiReadTone> = { working: "good", partial: "some", stubbed: "some", not_read: "none" };

/** Counts from the repository's commits, computed by the app (v3 summaries). */
export type AiBuildView = {
  sha: string;
  readAt: number;
  deadline: number;
  deadlineKind: "closed" | "written";
  commits: number;
  people: number;
  firstAt: number;
  lastAt: number;
  afterDeadline: number;
  firstCommitLines?: number;
  firstCommitFiles?: number;
  truncated: boolean;
  filesRead: number;
};

/** What a v3 summary adds; every field is null on older summaries. */
export type AiDetailsView = {
  builtVsStubbed?: { part: string; status: BuiltStatusView; evidence: string }[] | null;
  questions?: string[] | null;
  build?: AiBuildView | null;
};

const shortTime = (at: number) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const datedTime = (at: number) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * The build facts as one line: "12 commits by 2 people, 1 Nov, 10:42 to 1 Nov,
 * 18:03. The first commit had no code. 1 commit after the deadline left out."
 * Times are in the viewer's time zone.
 */
export function buildFactsLine(build: AiBuildView, time?: (at: number) => string) {
  // History from an earlier year shows dates with years, so "17 Nov to 26 Aug" never reads as one event.
  const spansYears = new Date(build.firstAt).getFullYear() !== new Date(build.deadline).getFullYear();
  time ??= spansYears ? datedTime : shortTime;
  const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
  return [
    `${plural(build.commits, "commit", "commits")} by ${plural(build.people, "person", "people")}, ${time(build.firstAt)} to ${time(build.lastAt)}${build.truncated ? " (latest 300 only)" : ""}.`,
    build.firstCommitLines === undefined ? "" : build.firstCommitLines === 0 ? "The first commit had no code." : `The first commit added ${plural(build.firstCommitLines, "line", "lines")} of code in ${plural(build.firstCommitFiles ?? 0, "file", "files")}.`,
    build.afterDeadline > 0 ? `${plural(build.afterDeadline, "commit", "commits")} after the deadline left out.` : "",
  ].filter(Boolean).join(" ");
}

/** Which commit the code was read at, and why that one. */
export function buildReadLine(build: AiBuildView, time: (at: number) => string = shortTime) {
  const deadline = build.deadlineKind === "closed" ? `when submissions closed (${time(build.deadline)})` : `when this was written (${time(build.deadline)})`;
  return `Code read at ${build.sha.slice(0, 7)}, the last commit before ${deadline}: ${build.filesRead} file${build.filesRead === 1 ? "" : "s"} read.`;
}

/** Rows show up to this many AI chips; past it, one fewer and then "+N". */
export const ROW_AI_CHIP_LIMIT = 3;

/** Up to the limit, every chip; past it, the first (limit - 1) and the rest behind "+N". */
export function splitRowChips<T>(chips: T[], limit = ROW_AI_CHIP_LIMIT): { shown: T[]; rest: T[] } {
  if (chips.length <= limit) return { shown: chips, rest: [] };
  return { shown: chips.slice(0, limit - 1), rest: chips.slice(limit - 1) };
}
