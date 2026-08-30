export const JUDGING_SCORE_MIN = 0;
export const JUDGING_SCORE_MAX = 10;
export const JUDGING_CRITERIA = ["innovation", "execution", "demoClarity"] as const;
export type JudgingCriterion = (typeof JUDGING_CRITERIA)[number];
export const JUDGING_CRITERION_LABELS: Record<JudgingCriterion, string> = {
  innovation: "Innovation",
  execution: "Execution",
  demoClarity: "Demo clarity",
};

export function isJudgingScore(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= JUDGING_SCORE_MIN && value <= JUDGING_SCORE_MAX;
}

export function isCompleteReview(review: Pick<Record<JudgingCriterion, number | undefined>, JudgingCriterion>) {
  return JUDGING_CRITERIA.every((criterion) => isJudgingScore(review[criterion]));
}
