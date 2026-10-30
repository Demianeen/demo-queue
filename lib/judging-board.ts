/**
 * The Judging tab's arithmetic, kept out of the components so it is tested:
 * which group a project is in, each judge's chip, the final score with or
 * without evening out, and the finalists' order.
 */

export const CRITERIA = ["innovation", "execution", "demoClarity"] as const;
export type Criterion = (typeof CRITERIA)[number];
export type Scores = Partial<Record<Criterion, number>>;

/** Every project needs this many complete reviews, as on the server. */
export const REVIEW_TARGET = 2;
/** The top of the finalists list are the winners. */
export const WINNER_COUNT = 3;

/** "Alex Chen" → "AC". */
export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/** The mean of the three criteria, or null until all three are in. */
export function scoreAverage(scores: Scores | undefined | null) {
  if (!scores) return null;
  const values = CRITERIA.map((criterion) => scores[criterion]);
  if (values.some((value) => value === undefined)) return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0) / values.length;
}

export type ReviewGroup = "first" | "another" | "done";

export const REVIEW_GROUPS: { group: ReviewGroup; label: string; note: string }[] = [
  { group: "first", label: "Needs a first review", note: "no score yet" },
  { group: "another", label: "Needs another review", note: `1 of ${REVIEW_TARGET} scores` },
  { group: "done", label: "Fully reviewed", note: `${REVIEW_TARGET} of ${REVIEW_TARGET} scores` },
];

export function reviewGroup(completeReviews: number): ReviewGroup {
  return completeReviews === 0 ? "first" : completeReviews < REVIEW_TARGET ? "another" : "done";
}

export function parseReviewGroup(value: string | null | undefined): ReviewGroup | null {
  return REVIEW_GROUPS.find((item) => item.group === value)?.group ?? null;
}

/** One judge on one project: what they entered, and the evened-out values when there are any. */
export type JudgeChip = {
  judgeKey: string;
  judgeName: string;
  scores: Scores | null;
  completed: boolean;
  evenedOut: Scores | null;
};

/** How a judge's evening out moved their average: a generous judge comes down, a strict one goes up. */
export function evenOutNote(chip: Pick<JudgeChip, "scores" | "evenedOut" | "completed">) {
  const raw = chip.completed ? scoreAverage(chip.scores) : null;
  const even = scoreAverage(chip.evenedOut);
  if (raw === null || even === null || Math.abs(even - raw) < 0.005) return null;
  return { kind: even < raw ? "generous" as const : "strict" as const, raw, even };
}

/**
 * The project's final score: the mean of its complete reviews, each evened
 * out when `evenOut` is on and the judge has evened-out values (a judge set
 * to raw has none), else as entered. Null with no complete review.
 */
export function finalScore(chips: JudgeChip[], evenOut: boolean) {
  const averages = chips.flatMap((chip) => {
    if (!chip.completed) return [];
    const value = scoreAverage(evenOut && chip.evenedOut ? chip.evenedOut : chip.scores);
    return value === null ? [] : [value];
  });
  return averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : null;
}

export type RankedRow<T> = T & { final: number | null; rawFinal: number | null; rank: number };

export type RankSort = "final" | Criterion;

/** Highest first; projects without a score last, by title. Ranks follow this order before any filter. */
export function rankRows<T extends { id: string; title: string; chips: JudgeChip[] }>(rows: T[], evenOut: boolean, sort: RankSort = "final"): RankedRow<T>[] {
  const key = (row: T) => {
    if (sort === "final") return finalScore(row.chips, evenOut);
    const values = row.chips.flatMap((chip) => (chip.completed && chip.scores?.[sort] !== undefined ? [chip.scores[sort]!] : []));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  return rows
    .map((row) => ({ row, key: key(row) }))
    .sort((left, right) => {
      if (left.key === null && right.key === null) return left.row.title.localeCompare(right.row.title);
      if (left.key === null) return 1;
      if (right.key === null) return -1;
      return right.key - left.key || left.row.title.localeCompare(right.row.title);
    })
    .map(({ row }, index) => ({ ...row, final: finalScore(row.chips, evenOut), rawFinal: finalScore(row.chips, false), rank: index + 1 }));
}

/**
 * The finalists card's order. Before finalists are submitted: the ticked
 * projects by score. After: the saved winner order first, then the other
 * finalists by score.
 */
export function finalistOrder(finalistIds: string[], placementIds: string[], scoreById: ReadonlyMap<string, number | null>) {
  const finalists = new Set(finalistIds);
  const placed = placementIds.filter((id) => finalists.has(id));
  const placedSet = new Set(placed);
  const byScore = finalistIds
    .filter((id) => !placedSet.has(id))
    .sort((left, right) => (scoreById.get(right) ?? -Infinity) - (scoreById.get(left) ?? -Infinity));
  return [...placed, ...byScore];
}

/** Moves one item, as a drag or Alt+arrow does. Out-of-range moves leave the list as it is. */
export function moveItem<T>(list: readonly T[], from: number, to: number) {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** "1st", "2nd", "3rd" for the winners. */
export function placeLabel(index: number) {
  return ["1st", "2nd", "3rd"][index] ?? "";
}
