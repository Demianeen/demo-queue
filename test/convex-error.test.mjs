import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";

import { convexErrorText } from "../lib/convex-error.ts";

/** A ConvexError as ConvexHttpClient and useMutation hand it back, with the message a deployment sends. */
function received(message, data) {
  const error = new ConvexError(data);
  error.message = message;
  return error;
}

test("on prod the text is read from data, since the message is redacted", () => {
  assert.equal(convexErrorText(received("[Request ID: 7bb9b273497154b8] Server Error", "Submission not found")), "Submission not found");
});

test("on dev the full message also gives the text", () => {
  const dev = "[Request ID: d85d8aeab5a6870f] Server Error\nUncaught ConvexError: Event not found\n    at eventBySlug (../../convex/events.ts:176:9)\n";
  assert.equal(convexErrorText(received(dev, "Event not found")), "Event not found");
  assert.equal(convexErrorText(new Error(dev)), "Event not found");
});

test("anything that is not a ConvexError has no text to show", () => {
  assert.equal(convexErrorText(new Error("[Request ID: 1] Server Error")), null);
  assert.equal(convexErrorText(new TypeError("Failed to fetch")), null);
  assert.equal(convexErrorText("oops"), null);
});
