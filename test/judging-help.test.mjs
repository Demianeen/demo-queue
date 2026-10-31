import assert from "node:assert/strict";
import test from "node:test";

import { behindJudges, helpOutOwner, helpOutSections, isCovered, joinNames, leftByJudge, median, reviewStarted, reviewsByProject, scoringNow, startedAgo, yoursSections } from "../lib/judging-help.ts";

const review = (submissionId, judgeKey, completed = true, updatedAt = 0) => ({ submissionId, judgeKey, completed, started: true, updatedAt });

test("a review is started once any criterion has a score", () => {
  assert.equal(reviewStarted({ completed: false }), false);
  assert.equal(reviewStarted({ innovation: null, execution: undefined, completed: false }), false);
  assert.equal(reviewStarted({ innovation: 0, completed: false }), true);
  assert.equal(reviewStarted({ completed: true }), true);
});

test("a project is covered for its judge once others give it two reviews and they have not started it", () => {
  const project = { id: "p1", judgeKeys: ["sam", "taylor"] };
  assert.equal(isCovered(project, "sam", [review("p1", "taylor"), review("p1", "priya")]), true);
  // One review is not enough.
  assert.equal(isCovered(project, "sam", [review("p1", "priya")]), false);
  // An unfinished review by someone else does not count.
  assert.equal(isCovered(project, "sam", [review("p1", "taylor"), review("p1", "priya", false)]), false);
  // Sam started it, so it stays his.
  assert.equal(isCovered(project, "sam", [review("p1", "taylor"), review("p1", "priya"), review("p1", "sam", false)]), false);
  // A review Sam saved with nothing scored is not a start.
  assert.equal(isCovered(project, "sam", [review("p1", "taylor"), review("p1", "priya"), { ...review("p1", "sam", false), started: false }]), true);
  // Not his project.
  assert.equal(isCovered(project, "priya", [review("p1", "taylor"), review("p1", "sam")]), false);
});

test("left counts a judge's projects not completed and not covered", () => {
  const projects = [
    { id: "p1", judgeKeys: ["sam", "taylor"] },
    { id: "p2", judgeKeys: ["sam", "alex"] },
    { id: "p3", judgeKeys: ["taylor", "alex"] },
  ];
  const reviews = [
    review("p1", "taylor"), review("p1", "priya"), // covered for Sam
    review("p2", "sam", false), // started, still left
    review("p3", "taylor"),
  ];
  const left = leftByJudge(projects, reviews, ["sam", "taylor", "alex", "priya"]);
  assert.deepEqual(Object.fromEntries(left), { sam: 1, taylor: 0, alex: 2, priya: 0 });
});

test("a Help out project goes to the assigned judge who has not reviewed it, or the one with more left", () => {
  const project = { id: "p1", judgeKeys: ["sam", "taylor"] };
  const left = new Map([["sam", 9], ["taylor", 3]]);
  assert.equal(helpOutOwner(project, [], left), "sam");
  assert.equal(helpOutOwner(project, [review("p1", "sam")], left), "taylor");
  // Started is not reviewed: neither has finished, so the one with more left.
  assert.equal(helpOutOwner(project, [review("p1", "sam", false)], left), "sam");
  // Both finished (a helper scored it too): it stays with the one with more left.
  assert.equal(helpOutOwner(project, [review("p1", "sam"), review("p1", "taylor")], left), "sam");
  assert.equal(helpOutOwner({ id: "p2", judgeKeys: [] }, [], left), null);
});

test("a judge is behind with 4 or more left and at least twice the median", () => {
  assert.equal(median([]), 0);
  assert.equal(median([9, 3, 0, 0]), 1.5);
  assert.equal(median([5, 1, 3]), 3);
  const judges = (lefts) => Object.entries(lefts).map(([judgeKey, left]) => ({ judgeKey, left }));
  assert.deepEqual([...behindJudges(judges({ sam: 9, taylor: 3, priya: 0, alex: 0 }))], ["sam"]);
  // Everyone has a lot left at the start: nobody is behind.
  assert.deepEqual([...behindJudges(judges({ sam: 9, taylor: 9, priya: 8 }))], []);
  // Twice the median, but fewer than 4.
  assert.deepEqual([...behindJudges(judges({ sam: 3, taylor: 1, priya: 0 }))], []);
});

test("scoring now is the latest unfinished review in the last 10 minutes; on your own project only a helper counts", () => {
  const now = 1_000_000_000;
  const sam = { judgeKey: "sam", judgeName: "Sam", updatedAt: now - 2 * 60_000, assigned: true };
  const priya = { judgeKey: "priya", judgeName: "Priya", updatedAt: now - 60_000, assigned: false };
  const stale = { judgeKey: "alex", judgeName: "Alex", updatedAt: now - 10 * 60_000, assigned: false };
  assert.equal(scoringNow([sam, priya, stale], false, now), priya);
  assert.equal(scoringNow([sam, stale], false, now), sam);
  assert.equal(scoringNow([sam, stale], true, now), null);
  assert.equal(scoringNow([sam, priya], true, now), priya);
  // Ten minutes later it is no longer now.
  assert.equal(scoringNow([priya], false, now + 9 * 60_000), null);
  assert.equal(startedAgo(now - 20_000, now), "just now");
  assert.equal(startedAgo(now - 4 * 60_000 - 5_000, now), "4 min ago");
  assert.equal(startedAgo(now + 5_000, now), "just now");
});

test("Help out lists the judge with the most left first, and projects being scored last", () => {
  const judges = [
    { judgeKey: "taylor", judgeName: "Taylor", left: 3 },
    { judgeKey: "sam", judgeName: "Sam", left: 9 },
    { judgeKey: "alex", judgeName: "Alex", left: 3 },
  ];
  const projects = [
    { id: "a", helpFor: "taylor" },
    { id: "b", helpFor: "sam" },
    { id: "c", helpFor: "alex" },
    { id: "d", helpFor: "sam" },
    { id: "e", helpFor: null },
    { id: "f", helpFor: "sam" },
  ];
  const { groups, beingScored } = helpOutSections(projects, judges, (project) => project.id === "f");
  assert.deepEqual(groups.map((group) => [group.judge?.judgeName ?? null, group.projects.map((project) => project.id)]), [
    ["Sam", ["b", "d"]],
    ["Alex", ["c"]],
    ["Taylor", ["a"]],
    [null, ["e"]],
  ]);
  assert.deepEqual(beingScored.map((project) => project.id), ["f"]);
});

test("Yours puts projects being scored by a helper, then covered ones, at the bottom", () => {
  const projects = [{ id: "a", covered: false }, { id: "b", covered: true }, { id: "c", covered: false }, { id: "d", covered: true }];
  const { mine, beingScored, covered } = yoursSections(projects, (project) => project.covered, (project) => project.id === "a" || project.id === "d");
  assert.deepEqual([mine, beingScored, covered].map((list) => list.map((project) => project.id)), [["c"], ["a"], ["b", "d"]]);
});

test("names join in plain English and reviews group by project", () => {
  assert.equal(joinNames([]), "");
  assert.equal(joinNames(["Priya"]), "Priya");
  assert.equal(joinNames(["Priya", "Alex"]), "Priya and Alex");
  assert.equal(joinNames(["Priya", "Alex", "Sam"]), "Priya, Alex and Sam");
  assert.deepEqual([...reviewsByProject([review("p1", "a"), review("p2", "b"), review("p1", "c")]).keys()], ["p1", "p2"]);
});
