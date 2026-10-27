import assert from "node:assert/strict";
import test from "node:test";
import { sampleDevDayLook, sampleDevDayWink, DEVDAY_LOOK_DURATION } from "../lib/devday-motion.ts";

test("the automatic performance reads left, right and returns to exact rest", () => {
  assert.ok(sampleDevDayLook(1).x < -0.85);
  assert.ok(sampleDevDayLook(2.2).x > 0.85);
  assert.ok(Math.abs(sampleDevDayLook(3.3).x) < 0.02);
  assert.deepEqual(sampleDevDayLook(0), { x: 0, y: 0 });
  assert.deepEqual(sampleDevDayLook(DEVDAY_LOOK_DURATION), { x: 0, y: 0 });
  assert.deepEqual(sampleDevDayLook(Infinity), { x: 0, y: 0 });
});

test("all automatic gaze samples stay inside the source 0.12D radial limit", () => {
  for (let t = 0; t <= DEVDAY_LOOK_DURATION; t += 1 / 240) {
    const { x, y } = sampleDevDayLook(t);
    assert.ok(Math.hypot(x, y) <= 1 + Number.EPSILON);
  }
});

test("the wink anticipates its fast closure, opens softly and recovers completely", () => {
  assert.ok(sampleDevDayWink(-0.2).nod > 0.5);
  assert.equal(sampleDevDayWink(0).closure, 1);
  assert.ok(sampleDevDayWink(0.1).closure > sampleDevDayWink(-0.1).closure);
  assert.ok(sampleDevDayWink(0).depth > 0);
  assert.equal(sampleDevDayWink(0, "left").roll, -sampleDevDayWink(0, "right").roll);
  assert.deepEqual(sampleDevDayWink(1.2), { closure: 0, nod: 0, depth: 0, roll: 0 });
});

test("reduced motion holds the original lockup throughout every phrase", () => {
  for (let t = -1; t <= 6; t += 0.05) {
    assert.deepEqual(sampleDevDayLook(t, true), { x: 0, y: 0 });
    assert.deepEqual(sampleDevDayWink(t, "left", true), { closure: 0, nod: 0, depth: 0, roll: 0 });
  }
});
