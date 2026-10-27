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

test("social links point only at the platform's own site", async () => {
  const { socialUrl } = await import("../lib/social.ts");
  assert.equal(socialUrl("github", "@octocat"), "https://github.com/octocat");
  assert.equal(socialUrl("github", "github.com/octocat"), "https://github.com/octocat");
  assert.equal(socialUrl("twitter", "@ada"), "https://x.com/ada");
  assert.equal(socialUrl("twitter", "http://twitter.com/ada"), "https://twitter.com/ada");
  assert.equal(socialUrl("linkedin", "in/ada-l"), "https://www.linkedin.com/in/ada-l");
  assert.equal(socialUrl("linkedin", "ada-l"), "https://www.linkedin.com/in/ada-l");
  assert.equal(socialUrl("linkedin", "https://uk.linkedin.com/in/ada"), "https://uk.linkedin.com/in/ada");
  for (const [kind, value] of [
    ["twitter", "https://evil.example/ada"],
    ["twitter", "https://x.com.evil.example/ada"],
    ["twitter", "https://evilx.com/ada"],
    ["linkedin", "https://github.com/ada"],
    ["github", "javascript:alert(1)"],
    ["github", "data:text/html,hi"],
    ["github", "https://user:pass@github.com/ada"],
    ["linkedin", "example.com/in/ada"],
    ["twitter", 'ada"><script>'],
    ["github", ""],
  ]) {
    assert.equal(socialUrl(kind, value), null, `${kind} ${value}`);
  }
});

test("email format check refuses malformed addresses", async () => {
  const { isValidEmail } = await import("../lib/validation.ts");
  assert.equal(isValidEmail("ada@example.com"), true);
  for (const value of ["", "ada", "ada@", "@example.com", "ada@example", "a b@example.com", `${"a".repeat(250)}@example.com`]) {
    assert.equal(isValidEmail(value), false, value);
  }
});
