import assert from "node:assert/strict";
import test from "node:test";

import {
  adjusted,
  adjustmentDelta,
  average,
  mean,
} from "../lib/normalization.ts";

test("normalization centers harsh and generous judges by criterion", () => {
  const eventMean = mean([
    { innovation: 8, execution: 6, demoClarity: 7 },
    { innovation: 4, execution: 8, demoClarity: 5 },
  ]);
  const harshMean = mean([{ innovation: 3, execution: 4, demoClarity: 2 }]);
  const generousMean = mean([{ innovation: 9, execution: 10, demoClarity: 8 }]);

  assert.ok(eventMean);
  assert.ok(harshMean);
  assert.ok(generousMean);
  assert.deepEqual(adjustmentDelta(harshMean, eventMean), {
    innovation: 3,
    execution: 3,
    demoClarity: 4,
  });
  assert.deepEqual(adjustmentDelta(generousMean, eventMean), {
    innovation: -3,
    execution: -3,
    demoClarity: -2,
  });
});

test("normalization displays the unclamped value and keeps final scores in range", () => {
  const high = adjusted(
    { innovation: 9, execution: 10, demoClarity: 8 },
    { innovation: 3, execution: 2, demoClarity: 4 },
  );
  assert.deepEqual(high.unclamped, {
    innovation: 12,
    execution: 12,
    demoClarity: 12,
  });
  assert.deepEqual(high.clamped, {
    innovation: 10,
    execution: 10,
    demoClarity: 10,
  });

  const low = adjusted(
    { innovation: 1, execution: 0, demoClarity: 2 },
    { innovation: -3, execution: -2, demoClarity: -4 },
  );
  assert.deepEqual(low.unclamped, {
    innovation: -2,
    execution: -2,
    demoClarity: -2,
  });
  assert.deepEqual(low.clamped, {
    innovation: 0,
    execution: 0,
    demoClarity: 0,
  });
  assert.equal(average(low.clamped), 0);
});

test("normalization has no mean when there are no complete reviews", () => {
  assert.equal(mean([]), null);
});
