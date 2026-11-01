import assert from "node:assert/strict";
import test from "node:test";
import { slugify } from "../lib/tokens.ts";

test("an event link keeps the suffix it is given, so server and browser render the same link", () => {
  assert.equal(slugify("Demo Night!", "1ebc6c"), "demo-night-1ebc6c");
  assert.equal(slugify("   ", "1ebc6c"), "demo-night-1ebc6c");
  assert.match(slugify("Hack Day"), /^hack-day-[0-9a-f]{6}$/);
});
