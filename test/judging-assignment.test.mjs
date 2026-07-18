import assert from "node:assert/strict";
import test from "node:test";

import {
  assignRoundOneJudgePair,
  buildJudgeAssignmentCounts,
  parseRoundOneJudges,
} from "../lib/judging-assignment.ts";

test("judge list parsing normalizes whitespace and removes duplicates", () => {
  assert.deepEqual(
    parseRoundOneJudges("  Alex   Morgan  \r\nSam Lee\nＡlex Morgan\n"),
    ["Alex Morgan", "Sam Lee"],
  );
  assert.throws(() => parseRoundOneJudges("Alex\nalex"), /at least 2 distinct judges/i);
  assert.throws(
    () => parseRoundOneJudges(`${"A".repeat(101)}\nSam`),
    /100 characters or fewer/i,
  );
});

test("judge assignment is deterministic, distinct, and balanced", () => {
  const roster = ["Alex", "Sam", "Jordan", "Taylor"];
  const counts = buildJudgeAssignmentCounts([]);
  const assignments = Array.from({ length: 12 }, () => assignRoundOneJudgePair(roster, counts));

  for (const [first, second] of assignments) assert.notEqual(first, second);
  const loads = roster.map((judge) => counts.individual.get(judge.toLowerCase()) ?? 0);
  assert.ok(Math.max(...loads) - Math.min(...loads) <= 1);

  const repeated = buildJudgeAssignmentCounts([]);
  assert.deepEqual(
    Array.from({ length: 12 }, () => assignRoundOneJudgePair(roster, repeated)),
    assignments,
  );
});
