import assert from "node:assert/strict";
import test from "node:test";

import { judgeTotal, parseJudgeSort, sortByScore } from "../lib/judge-sort.ts";
import { average } from "../lib/normalization.ts";

const project = (id, scores) => ({ id, scores });
const order = (projects) => sortByScore(projects, (item) => judgeTotal(item.scores)).map((item) => item.id);

test("the sort is in the address only when it is not queue order", () => {
  assert.equal(parseJudgeSort("score"), "score");
  assert.equal(parseJudgeSort(null), "queue");
  assert.equal(parseJudgeSort("queue"), "queue");
  assert.equal(parseJudgeSort("anything"), "queue");
});

test("sorted by score, the judge's totals go high to low", () => {
  assert.deepEqual(order([
    project("a", { innovation: 5, execution: 5, demoClarity: 5 }),
    project("b", { innovation: 9, execution: 8, demoClarity: 9 }),
    project("c", { innovation: 7, execution: 6, demoClarity: 8 }),
    project("d", { innovation: 0, execution: 1, demoClarity: 0 }),
  ]), ["b", "c", "a", "d"]);
});

test("projects the judge has not scored go last, in queue order", () => {
  assert.deepEqual(order([
    project("a", null),
    project("b", { innovation: 4, execution: 4, demoClarity: 4 }),
    // Two of three criteria is not scored yet.
    project("c", { innovation: 10, execution: 10 }),
    project("d", { innovation: 10, execution: 10, demoClarity: null }),
    project("e", { innovation: 6, execution: 6, demoClarity: 6 }),
    project("f", undefined),
  ]), ["e", "b", "a", "c", "d", "f"]);
});

test("equal totals keep queue order", () => {
  assert.deepEqual(order([
    project("a", { innovation: 6, execution: 6, demoClarity: 6 }),
    project("b", { innovation: 8, execution: 8, demoClarity: 8 }),
    project("c", { innovation: 4, execution: 6, demoClarity: 8 }),
    project("d", { innovation: 8, execution: 7, demoClarity: 9 }),
    project("e", { innovation: 7, execution: 5, demoClarity: 6 }),
  ]), ["b", "d", "a", "c", "e"]);
});

test("sorting leaves the queue's list as it was", () => {
  const projects = [project("a", null), project("b", { innovation: 9, execution: 9, demoClarity: 9 })];
  order(projects);
  assert.deepEqual(projects.map((item) => item.id), ["a", "b"]);
});

test("the total is the per-review score Results is built from", () => {
  for (const row of [
    { innovation: 8, execution: 7, demoClarity: 9 },
    { innovation: 9, execution: 7, demoClarity: 6 },
    { innovation: 0, execution: 0, demoClarity: 0 },
    { innovation: 10, execution: 10, demoClarity: 10 },
  ]) assert.equal(judgeTotal(row), average(row));
  // As on Results: 8, 7 and 9 make 8.00, and 9, 7 and 6 make 7.33.
  assert.equal(judgeTotal({ innovation: 8, execution: 7, demoClarity: 9 }).toFixed(2), "8.00");
  assert.equal(judgeTotal({ innovation: 9, execution: 7, demoClarity: 6 }).toFixed(2), "7.33");
  assert.equal(judgeTotal(null), null);
});
