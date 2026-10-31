import assert from "node:assert/strict";
import { test } from "node:test";
import { displayUrl, participantCelebration, participantHeading, participantSteps } from "../lib/participant-status.ts";

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

test("a finalist is celebrated, and a place only once the event is finished", () => {
  const celebrate = (status, phase, finalist, placement = null) => participantCelebration({ eventType: "hackathon", status, phase, finalist, placement, demoTitle: "Volley Bot" });
  assert.deepEqual(celebrate("queued", "stage", true), { place: null, kicker: "Finalist", headline: "You're a finalist", sentence: "Volley Bot made the final. Your team pitches on stage, and the winners are picked after the last pitch." });
  assert.equal(celebrate("candidate", "stage", false), null);
  assert.equal(celebrate("candidate", "judging", false, 1), null, "no place before the event is finished");
  assert.equal(celebrate("done", "stage", true, 1).headline, "You're a finalist", "no place before the event is finished");
  assert.deepEqual(celebrate("done", "finished", true, 1), { place: 1, kicker: "Winners", headline: "1st place", sentence: "Volley Bot came first. Congratulations to the whole team." });
  assert.equal(celebrate("done", "finished", true, 2).sentence, "Volley Bot came second. Congratulations to the whole team.");
  assert.equal(celebrate("done", "finished", true, 3).headline, "3rd place");
  assert.equal(celebrate("done", "finished", true).sentence, "Volley Bot made the final and pitched on stage.");
  assert.equal(celebrate("no_show", "finished", true).sentence, "Volley Bot made the final.");
  assert.equal(celebrate("withdrawn", "finished", true, 1), null);
  assert.equal(participantCelebration({ eventType: "demo", status: "done", phase: "finished", finalist: true, placement: null, demoTitle: "Demo" }), null);
});

test("no celebration copy counts the projects", () => {
  for (const placement of [null, 1, 2, 3]) {
    for (const phase of ["stage", "finished"]) {
      const text = JSON.stringify(participantCelebration({ eventType: "hackathon", status: "done", phase, finalist: true, placement, demoTitle: "Volley Bot" }));
      assert.doesNotMatch(text, /\bof \d+|\d+ projects/);
      assert.doesNotMatch(text, /—/);
    }
  }
});
