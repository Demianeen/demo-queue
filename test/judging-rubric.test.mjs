import assert from "node:assert/strict";
import test from "node:test";
import { isCompleteReview, isJudgingScore } from "../lib/judging-rubric.ts";

test("rubric accepts only integer scores from zero through ten", () => {
  assert.equal(isJudgingScore(0), true);
  assert.equal(isJudgingScore(10), true);
  assert.equal(isJudgingScore(10.5), false);
  assert.equal(isJudgingScore(11), false);
});

test("rubric completion requires all three criteria", () => {
  assert.equal(isCompleteReview({ innovation: 8, execution: 7, demoClarity: 9 }), true);
  assert.equal(isCompleteReview({ innovation: 8, execution: 7, demoClarity: undefined }), false);
});
