// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { JUDGING_CRITERIA, JUDGING_SCORE_MAX, JUDGING_SCORE_MIN, type JudgingCriterion } from "./judging-rubric.ts";

export type ScoreRow = Record<JudgingCriterion, number>;

export function mean(rows: ScoreRow[]): ScoreRow | null {
  if (rows.length === 0) return null;
  return Object.fromEntries(
    JUDGING_CRITERIA.map((criterion) => [
      criterion,
      rows.reduce((sum, row) => sum + row[criterion], 0) / rows.length,
    ]),
  ) as ScoreRow;
}

export function adjustmentDelta(judgeMean: ScoreRow, eventMean: ScoreRow): ScoreRow {
  return Object.fromEntries(
    JUDGING_CRITERIA.map((criterion) => [
      criterion,
      eventMean[criterion] - judgeMean[criterion],
    ]),
  ) as ScoreRow;
}

export function adjusted(raw: ScoreRow, delta: ScoreRow) {
  const unclamped = Object.fromEntries(
    JUDGING_CRITERIA.map((criterion) => [criterion, raw[criterion] + delta[criterion]]),
  ) as ScoreRow;
  const clamped = Object.fromEntries(
    JUDGING_CRITERIA.map((criterion) => [
      criterion,
      Math.max(JUDGING_SCORE_MIN, Math.min(JUDGING_SCORE_MAX, unclamped[criterion])),
    ]),
  ) as ScoreRow;
  return { unclamped, clamped };
}

export function average(row: ScoreRow) {
  return JUDGING_CRITERIA.reduce((sum, criterion) => sum + row[criterion], 0) /
    JUDGING_CRITERIA.length;
}
