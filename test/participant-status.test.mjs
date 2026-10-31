import assert from "node:assert/strict";
import { test } from "node:test";
import { displayUrl, participantHeading, participantSteps } from "../lib/participant-status.ts";

const marks = (steps) => steps.map((step) => `${step.state === "done" ? "✓" : step.state === "current" ? ">" : "-"}${step.label}`).join(" ");
const hack = (status, phase, finalist = false) => ({ eventType: "hackathon", status, phase, finalist });

test("a hackathon team's steps follow the event's phase", () => {
  assert.equal(marks(participantSteps(hack("candidate", "submissions"))), "✓Submitted -Judging -Finalists -Results");
  assert.equal(marks(participantSteps(hack("candidate", "judging"))), "✓Submitted >Judging -Finalists -Results");
  assert.equal(marks(participantSteps(hack("candidate", "stage", true))), "✓Submitted ✓Judging >Finalists -Results");
  assert.equal(marks(participantSteps(hack("done", "finished", true))), "✓Submitted ✓Judging ✓Finalists ✓Results");
  assert.equal(marks(participantSteps(hack("withdrawn", "submissions"))), "-Submitted -Judging -Finalists -Results");
});

test("a demo night team's steps follow its own status", () => {
  const demo = (status) => marks(participantSteps({ eventType: "demo", status, phase: "submissions", finalist: false }));
  assert.equal(demo("candidate"), "✓Submitted -Lineup -Demoing -Done");
  assert.equal(demo("queued"), "✓Submitted ✓Lineup -Demoing -Done");
  assert.equal(demo("current"), "✓Submitted ✓Lineup >Demoing -Done");
  assert.equal(demo("done"), "✓Submitted ✓Lineup ✓Demoing ✓Done");
  assert.equal(demo("withdrawn"), "-Submitted -Lineup -Demoing -Done");
});

test("a finalist waiting to be scheduled reads Selected as a finalist once judging is over", () => {
  assert.equal(participantHeading(hack("candidate", "stage", true)), "Selected as a finalist");
  assert.equal(participantHeading(hack("candidate", "judging", true)), "Submitted, waiting for judging", "not before judging ends");
  assert.equal(participantHeading(hack("candidate", "stage", false)), "Submitted, waiting for judging");
  assert.equal(participantHeading(hack("current", "stage", true)), "You are presenting now", "the lineup status says more");
  assert.equal(participantHeading({ eventType: "demo", status: "candidate", phase: "submissions", finalist: false }), "Submitted, waiting to be added as a demoer");
});

test("links shown as text drop the scheme", () => {
  assert.equal(displayUrl("https://github.com/tomo/guardrail/"), "github.com/tomo/guardrail");
  assert.equal(displayUrl("https://www.youtube.com/watch?v=1"), "youtube.com/watch?v=1");
});
