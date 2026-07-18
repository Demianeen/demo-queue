import assert from "node:assert/strict";
import test from "node:test";

import {
  SUBMISSION_FIELD_LIMITS,
  firstFieldLimitError,
  firstFieldLimitIssue,
  firstInvalidFieldName,
} from "../lib/validation.ts";

test("field limit issue identifies the first invalid field and keeps the legacy message helper", () => {
  const fields = {
    name: "Valid name",
    demoTitle: "x".repeat(SUBMISSION_FIELD_LIMITS.demoTitle + 1),
    description: "x".repeat(SUBMISSION_FIELD_LIMITS.description + 1),
  };

  const issue = firstFieldLimitIssue(fields);
  assert.deepEqual(issue, {
    field: "demoTitle",
    message: `Demo title must be ${SUBMISSION_FIELD_LIMITS.demoTitle} characters or fewer.`,
  });
  assert.equal(firstFieldLimitError(fields), issue.message);
});

test("field limit issue returns null when every provided field is valid", () => {
  assert.equal(firstFieldLimitIssue({ name: "Valid name", category: "AI" }), null);
});

test("first invalid field follows rendered form order instead of validation order", () => {
  const invalidFields = new Set(["rulesAccepted", "phone", "twitter"]);

  assert.equal(
    firstInvalidFieldName(["name", "phone", "email", "twitter", "rulesAccepted"], invalidFields),
    "phone",
  );
  assert.equal(firstInvalidFieldName(["name", "email"], invalidFields), null);
});
