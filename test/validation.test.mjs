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

test("category allows up to 30 characters", () => {
  assert.equal(SUBMISSION_FIELD_LIMITS.category, 30);
  assert.equal(firstFieldLimitIssue({ category: "x".repeat(30) }), null);
  assert.deepEqual(firstFieldLimitIssue({ category: "x".repeat(31) }), {
    field: "category",
    message: "Category must be 30 characters or fewer.",
  });
});

test("first invalid field follows rendered form order instead of validation order", () => {
  const invalidFields = new Set(["rulesAccepted", "phone", "twitter"]);

  assert.equal(
    firstInvalidFieldName(["name", "phone", "email", "twitter", "rulesAccepted"], invalidFields),
    "phone",
  );
  assert.equal(firstInvalidFieldName(["name", "email"], invalidFields), null);
});

test("GitHub profiles accept a username or a github.com profile link", async () => {
  const { isValidGithubProfile } = await import("../lib/validation.ts");
  for (const value of ["octocat", "@octo-cat", "github.com/octocat", "https://github.com/octocat/", "https://www.github.com/octocat"]) {
    assert.equal(isValidGithubProfile(value), true, value);
  }
  for (const value of ["-octocat", "octo cat", "https://github.com/octocat/repo", "https://gitlab.com/octocat", "a".repeat(41)]) {
    assert.equal(isValidGithubProfile(value), false, value);
  }
});

test("social link errors name the first bad link", async () => {
  const { socialLinksError } = await import("../lib/validation.ts");
  assert.equal(socialLinksError({}), "");
  assert.equal(socialLinksError({ twitter: "@ada", linkedin: "linkedin.com/in/ada", githubProfile: "ada" }), "");
  assert.match(socialLinksError({ githubProfile: "not valid!" }), /GitHub/);
  assert.match(socialLinksError({ linkedin: "example.com/ada" }), /linkedin/);
});

test("email keys ignore case, spaces and compatibility forms", async () => {
  const { emailKey } = await import("../lib/validation.ts");
  assert.equal(emailKey("  Ada@Example.COM "), "ada@example.com");
  assert.equal(emailKey("ａｄａ@example.com"), "ada@example.com");
});

test("GitHub social links point at the profile", async () => {
  const { socialUrl } = await import("../lib/social.ts");
  assert.equal(socialUrl("github", "@octocat"), "https://github.com/octocat");
  assert.equal(socialUrl("github", "github.com/octocat"), "https://github.com/octocat");
});
