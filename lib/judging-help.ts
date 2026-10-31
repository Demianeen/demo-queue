/**
 * Help out on the judge page, kept out of the query and the page so it is
 * tested: what each judge has left, which of their projects others already
 * covered, whose Help out list a project is in, who is behind, and who is
 * scoring a project right now.
 */

/** Every project needs this many complete reviews, as on the server and in lib/judging-board. */
const REVIEW_TARGET = 2;
/** An unfinished review touched this recently means its judge is scoring the project now. */
export const SCORING_NOW_MS = 10 * 60_000;
/** A judge is behind with at least this many left, and at least twice the median. */
export const BEHIND_MIN_LEFT = 4;

/** One judge's review of one project, as these rules read it. */
export type HelpReview = { submissionId: string; judgeKey: string; completed: boolean; started: boolean; updatedAt: number };
/** A project in judging and the keys of its assigned judges. */
export type HelpProject = { id: string; judgeKeys: readonly string[] };

/** A review counts as started once any criterion has a score. */
export function reviewStarted(review: { innovation?: number | null; execution?: number | null; demoClarity?: number | null; completed: boolean }) {
  return review.completed || [review.innovation, review.execution, review.demoClarity].some((value) => value !== undefined && value !== null);
}

export function reviewsByProject(reviews: readonly HelpReview[]) {
  const byProject = new Map<string, HelpReview[]>();
  for (const review of reviews) byProject.set(review.submissionId, [...(byProject.get(review.submissionId) ?? []), review]);
  return byProject;
}

/**
 * Covered for this judge: assigned to them, they have not started it, and
 * others already gave it its two complete reviews. It stops counting as
 * theirs. A judge who started it keeps it.
 */
export function isCovered(project: HelpProject, judgeKey: string, projectReviews: readonly HelpReview[]) {
  if (!project.judgeKeys.includes(judgeKey)) return false;
  if (projectReviews.some((review) => review.judgeKey === judgeKey && review.started)) return false;
  return projectReviews.filter((review) => review.completed && review.judgeKey !== judgeKey).length >= REVIEW_TARGET;
}

/** What each judge has left: their assigned projects they have not completed and that are not covered. */
export function leftByJudge(projects: readonly HelpProject[], reviews: readonly HelpReview[], judgeKeys: readonly string[]) {
  const byProject = reviewsByProject(reviews);
  const left = new Map(judgeKeys.map((key) => [key, 0]));
  for (const project of projects) {
    const projectReviews = byProject.get(project.id) ?? [];
    for (const key of project.judgeKeys) {
      if (!left.has(key)) continue;
      const done = projectReviews.some((review) => review.judgeKey === key && review.completed);
      if (!done && !isCovered(project, key, projectReviews)) left.set(key, left.get(key)! + 1);
    }
  }
  return left;
}

/**
 * Whose Help out list a project is in: the assigned judge who has not
 * reviewed it yet, or, when neither has, the one with more left. A project
 * both reviewed (one a helper also scored) stays with the one with more
 * left. Null only for a project nobody is assigned to.
 */
export function helpOutOwner(project: HelpProject, projectReviews: readonly HelpReview[], left: ReadonlyMap<string, number>) {
  const waiting = project.judgeKeys.filter((key) => !projectReviews.some((review) => review.judgeKey === key && review.completed));
  return [...(waiting.length ? waiting : project.judgeKeys)].sort((a, b) => (left.get(b) ?? 0) - (left.get(a) ?? 0))[0] ?? null;
}

export function median(values: readonly number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Judges with 4 or more left and at least twice the median left of the judges given (the active ones). */
export function behindJudges(judges: readonly { judgeKey: string; left: number }[]) {
  const middle = median(judges.map((judge) => judge.left));
  return new Set(judges.filter((judge) => judge.left >= BEHIND_MIN_LEFT && judge.left >= 2 * middle).map((judge) => judge.judgeKey));
}

/** Another judge with an unfinished review of a project. `assigned` is whether the project is theirs. */
export type Scorer = { judgeKey: string; judgeName: string; updatedAt: number; assigned: boolean };

/**
 * Who is scoring a project right now, as this judge sees it: the latest
 * unfinished review by another judge touched in the last 10 minutes. On the
 * judge's own project only a helper counts, since the other assigned judge
 * scores it anyway. `now` is the browser's clock, ticking.
 */
export function scoringNow(scorers: readonly Scorer[], assignedToMe: boolean, now: number) {
  return [...scorers]
    .filter((scorer) => (!assignedToMe || !scorer.assigned) && now - scorer.updatedAt < SCORING_NOW_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

/** "just now", "4 min ago". */
export function startedAgo(at: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

/** "Priya Shah", "Priya Shah and Alex Chen". */
export function joinNames(names: readonly string[]) {
  return names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export type JudgeLeft = { judgeKey: string; judgeName: string; left: number };
export type HelpGroup<T, J extends JudgeLeft = JudgeLeft> = { judge: J | null; projects: T[] };

/**
 * Help out, grouped by the judge each project helps, the judge with the most
 * left first, so helpers go to whoever is furthest behind. Projects someone
 * is scoring right now go to `beingScored`, at the bottom.
 */
export function helpOutSections<T extends { helpFor: string | null }, J extends JudgeLeft>(projects: readonly T[], judges: readonly J[], taken: (project: T) => boolean) {
  const byKey = new Map(judges.map((judge) => [judge.judgeKey, judge]));
  const groups = new Map<string, HelpGroup<T, J>>();
  const beingScored: T[] = [];
  for (const project of projects) {
    if (taken(project)) { beingScored.push(project); continue; }
    const judge = project.helpFor ? byKey.get(project.helpFor) ?? null : null;
    const key = judge?.judgeKey ?? "";
    if (!groups.has(key)) groups.set(key, { judge, projects: [] });
    groups.get(key)!.projects.push(project);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    if (!a.judge || !b.judge) return a.judge ? -1 : b.judge ? 1 : 0;
    return b.judge.left - a.judge.left || a.judge.judgeName.localeCompare(b.judge.judgeName);
  });
  return { groups: ordered, beingScored };
}

/**
 * Yours, in three parts: the ones to score, then the ones a helper is
 * scoring right now (still yours until covered), then the ones others
 * covered, which no longer count as yours.
 */
export function yoursSections<T>(projects: readonly T[], covered: (project: T) => boolean, taken: (project: T) => boolean) {
  return {
    mine: projects.filter((project) => !covered(project) && !taken(project)),
    beingScored: projects.filter((project) => !covered(project) && taken(project)),
    covered: projects.filter(covered),
  };
}
