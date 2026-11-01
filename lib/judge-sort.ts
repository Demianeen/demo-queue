// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { JUDGING_CRITERIA, type JudgingCriterion } from "./judging-rubric.ts";
// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { average, type ScoreRow } from "./normalization.ts";

/** The judge page's Sort: the queue's own order, or this judge's score, high to low. Kept in the address as `?sort=score`. */
export type JudgeSort = "queue" | "score";

export function parseJudgeSort(value: string | null | undefined): JudgeSort {
  return value === "score" ? "score" : "queue";
}

/**
 * This judge's total for one project: the same per-review score Results is
 * built from (`average` in lib/normalization), as entered. Null until all
 * three criteria have a score.
 */
export function judgeTotal(scores: Partial<Record<JudgingCriterion, number | null>> | null | undefined): number | null {
  if (!scores) return null;
  if (JUDGING_CRITERIA.some((criterion: JudgingCriterion) => typeof scores[criterion] !== "number")) return null;
  return average(scores as ScoreRow);
}

/** Highest total first; projects without one go last. Both keep queue order among equals. */
export function sortByScore<T>(projects: readonly T[], totalOf: (project: T) => number | null): T[] {
  return projects
    .map((project, index) => ({ project, index, total: totalOf(project) }))
    .sort((left, right) => {
      if (left.total === null || right.total === null) return Number(left.total === null) - Number(right.total === null) || left.index - right.index;
      return right.total - left.total || left.index - right.index;
    })
    .map(({ project }) => project);
}
