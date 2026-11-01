import assert from "node:assert/strict";
import test from "node:test";

import { addFinalist, evenOutNote, finalistOrder, finalScore, initials, judgeInitials, moveItem, placeLabel, rankRows, reviewGroup, scoreAverage } from "../lib/judging-board.ts";

const chip = (judgeName, scores, evenedOut = null, completed = true) => ({ judgeKey: judgeName.toLowerCase(), judgeName, scores, evenedOut, completed });

test("initials and averages", () => {
  assert.equal(initials("Alex Chen"), "AC");
  assert.equal(initials("priya"), "P");
  assert.equal(initials(" "), "?");
  assert.equal(scoreAverage({ innovation: 9, execution: 7, demoClarity: 6 }).toFixed(2), "7.33");
  assert.equal(scoreAverage({ innovation: 9, execution: 7 }), null);
});

test("projects group by complete reviews out of two", () => {
  assert.equal(reviewGroup(0), "first");
  assert.equal(reviewGroup(1), "another");
  assert.equal(reviewGroup(2), "done");
  assert.equal(reviewGroup(3), "done");
});

test("the final score evens out only complete reviews that have evened-out values", () => {
  const chips = [
    chip("Alex Chen", { innovation: 9, execution: 7, demoClarity: 6 }, { innovation: 8.5, execution: 6.8, demoClarity: 6 }),
    chip("Priya Shah", { innovation: 8, execution: 7, demoClarity: 7 }, { innovation: 8.6, execution: 7.6, demoClarity: 8.1 }),
    chip("Sam Lee", { innovation: 1 }, null, false),
  ];
  assert.equal(finalScore(chips, false).toFixed(2), "7.33");
  assert.equal(finalScore(chips, true).toFixed(2), "7.60");
  // A judge set to raw scores has no evened-out values: their review counts as entered.
  assert.equal(finalScore([chips[0], { ...chips[1], evenedOut: null }], true).toFixed(2), "7.22");
  assert.equal(finalScore([chips[2]], true), null);
  assert.deepEqual(evenOutNote(chips[0]).kind, "generous");
  assert.deepEqual(evenOutNote(chips[1]).kind, "strict");
  assert.equal(evenOutNote(chips[2]), null);
});

test("ranking puts unscored projects last and keeps ranks across a sort", () => {
  const rows = [
    { id: "a", title: "Agent Ledger", chips: [chip("Alex", { innovation: 6, execution: 4, demoClarity: 5 })] },
    { id: "b", title: "BusMan", chips: [chip("Priya", { innovation: 7, execution: 6, demoClarity: 6 })] },
    { id: "c", title: "Clipper", chips: [] },
  ];
  assert.deepEqual(rankRows(rows, false).map((row) => [row.id, row.rank]), [["b", 1], ["a", 2], ["c", 3]]);
  assert.deepEqual(rankRows(rows, false, "demoClarity").map((row) => row.id), ["b", "a", "c"]);
  assert.deepEqual(rankRows(rows, false, "execution").map((row) => row.id), ["b", "a", "c"]);
});

test("finalists: ticked in score order, a dragged order kept, winners first, and moves stay in range", () => {
  const scores = new Map([["grader", 8.42], ["radar", 7.95], ["guardrail", 7.61], ["notes", 7.1], ["cat", 4.8]]);
  const ticked = ["cat", "notes", "guardrail", "radar", "grader"].reduce((order, id) => addFinalist(order, id, scores), []);
  assert.deepEqual(ticked, ["grader", "radar", "guardrail", "notes", "cat"]);
  // After a drag, a new tick goes above the first lower score and the rest stays put.
  assert.deepEqual(addFinalist(["cat", "grader", "notes"], "radar", scores), ["radar", "cat", "grader", "notes"]);
  assert.deepEqual(addFinalist(["grader", "notes"], "cat", scores), ["grader", "notes", "cat"]);
  assert.deepEqual(addFinalist(["grader"], "grader", scores), ["grader"]);
  assert.deepEqual(finalistOrder(["notes", "radar", "grader"], []), ["notes", "radar", "grader"]);
  assert.deepEqual(finalistOrder(ticked, ["grader", "guardrail", "radar"]), ["grader", "guardrail", "radar", "notes", "cat"]);
  // A winner who is no longer a finalist drops out of the order.
  assert.deepEqual(finalistOrder(["radar", "cat"], ["grader", "cat"]), ["cat", "radar"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  assert.equal(placeLabel(1), "2nd");
  assert.equal(placeLabel(3), "");
});

test("judge initials tell judges apart", () => {
  const labels = judgeInitials(["Test judge A", "Test judge B", "Alex Chen", "Ann Cole", "Alex Chen"]);
  assert.equal(labels.get("Test judge A"), "TA");
  assert.equal(labels.get("Test judge B"), "TB");
  // "Alex Chen" and "Ann Cole" clash as AC either way, so they get numbers
  assert.equal(labels.get("Alex Chen"), "A1");
  assert.equal(labels.get("Ann Cole"), "A2");
  assert.equal(judgeInitials(["Priya Shah"]).get("Priya Shah"), "PS");
});
