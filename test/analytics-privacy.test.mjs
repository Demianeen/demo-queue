import assert from "node:assert/strict";
import test from "node:test";

import { analyticsSurface, scrubPath, scrubSecretPaths, scrubUrl } from "../lib/analytics-url.ts";
import { redactExceptionList, redactText } from "../lib/analytics-redact.ts";

test("exception lists lose secrets from messages and stack frames", () => {
  const [item] = redactExceptionList([{
    type: "Error",
    value: "Failed for jane.doe@example.com",
    stacktrace: { frames: [
      { filename: "https://hack.outpostcrew.co/judge/devday/tok3n?code=1", lineno: 1 },
      { filename: "/_next/static/chunks/app/judge/[slug]/[token]/page-abc.js", lineno: 2 },
    ] },
  }]);
  assert.equal(item.value, "Failed for [redacted]");
  assert.equal(item.stacktrace.frames[0].filename, "https://hack.outpostcrew.co/judge/devday/[token]");
  assert.equal(item.stacktrace.frames[0].lineno, 1);
  assert.equal(item.stacktrace.frames[1].filename, "/_next/static/chunks/app/judge/[slug]/[token]/page-abc.js");
  assert.equal(redactExceptionList(undefined), undefined);
});
import { posthogProxyHeaders, posthogProxyUrl } from "../lib/posthog-routing.ts";

test("the PostHog proxy keeps the path, query and trailing slash", () => {
  const url = (path) => posthogProxyUrl(new URL(path, "https://hack.outpostcrew.co"))?.href ?? null;
  assert.equal(url("/ingest/i/v0/e/?ip=1&_=2"), "https://eu.i.posthog.com/i/v0/e/?ip=1&_=2");
  assert.equal(url("/ingest/flags/?v=2"), "https://eu.i.posthog.com/flags/?v=2");
  assert.equal(url("/ingest/static/1.444.0/exception-autocapture.js"), "https://eu-assets.i.posthog.com/static/1.444.0/exception-autocapture.js");
  assert.equal(url("/ingest/array/phc_x/config.js"), "https://eu-assets.i.posthog.com/array/phc_x/config.js");
  assert.equal(url("/ingest//evil.example/x?y=1"), "https://eu.i.posthog.com//evil.example/x?y=1");
  assert.equal(url("/ingest/%2F%2Fevil.example/x"), "https://eu.i.posthog.com/%2F%2Fevil.example/x");
  assert.equal(url("/ingestion"), null);
  assert.equal(url("/events"), null);
});

test("the PostHog proxy drops cookies and the referrer but keeps the client", () => {
  const headers = posthogProxyHeaders(new Headers({
    cookie: "wos-session=secret",
    referer: "https://hack.outpostcrew.co/judge/devday/tok3n",
    "x-forwarded-for": "203.0.113.9",
    "user-agent": "Safari",
  }));
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("referer"), null);
  assert.equal(headers.get("x-forwarded-for"), "203.0.113.9");
  assert.equal(headers.get("user-agent"), "Safari");
});

test("judge, status and old admin tokens never leave the path", () => {
  assert.equal(scrubPath("/judge/devday/abc123secret"), "/judge/devday/[token]");
  assert.equal(scrubPath("/s/devday/abc123secret"), "/s/devday/[token]");
  assert.equal(scrubPath("/admin/devday/abc123secret"), "/admin/devday/[token]");
  assert.equal(scrubPath("/judge/devday/abc123secret/extra"), "/judge/devday/[token]/extra");
  assert.equal(scrubPath("/events/devday/admin"), "/events/devday/admin");
  assert.equal(scrubPath("/e/devday"), "/e/devday");
});

test("URLs keep only view state in the query and lose the fragment", () => {
  assert.equal(scrubUrl("https://hack.outpostcrew.co/judge/devday/tok3n?x=1#top"), "https://hack.outpostcrew.co/judge/devday/[token]");
  assert.equal(scrubUrl("http://localhost:3000/callback?code=01ABC&state=xyz"), "http://localhost:3000/callback");
  assert.equal(scrubUrl("/events/connect?client_id=a&redirect_uri=b&state=c"), "/events/connect");
  assert.equal(scrubUrl("/events/devday/admin?view=judging&q=Alice"), "/events/devday/admin?view=judging");
  assert.equal(scrubUrl("https://x.test/e/devday?utm_source=luma&email=a@b.co"), "https://x.test/e/devday?utm_source=luma");
  assert.equal(scrubUrl("/events?sort=score&status=open&track=ai"), "/events?sort=score&status=open&track=ai");
});

test("values that are not URLs are left alone", () => {
  assert.equal(scrubUrl("$direct"), "$direct");
  assert.equal(scrubUrl(""), "");
});

test("secret paths are scrubbed inside longer text", () => {
  assert.equal(
    scrubSecretPaths('a:attr__href="/judge/devday/tok3n";text="Open"'),
    'a:attr__href="/judge/devday/[token]";text="Open"',
  );
});

test("each path belongs to one surface", () => {
  assert.equal(analyticsSurface("/judge/devday/[token]"), "judge");
  assert.equal(analyticsSurface("/e/devday"), "team");
  assert.equal(analyticsSurface("/s/devday/[token]"), "team");
  assert.equal(analyticsSurface("/saved"), "team");
  assert.equal(analyticsSurface("/stage/devday"), "stage");
  assert.equal(analyticsSurface("/events/devday/admin"), "organiser");
  assert.equal(analyticsSurface("/members"), "organiser");
  assert.equal(analyticsSurface("/"), "other");
});

test("personal data and secrets are redacted from free text", () => {
  const text = redactText(
    "Failed for jane.doe@example.com at +44 7700 900123 from 10.0.0.1 with token=abc123 " +
      "and Bearer eyJhbGciOi.payload.sig on https://x.test/s/devday/tok3n?code=1 key phc_AbC123dEf456GhI789jKl",
  );
  for (const secret of ["jane.doe@example.com", "7700 900123", "10.0.0.1", "abc123", "eyJhbGciOi", "tok3n", "code=1", "phc_AbC123"]) {
    assert.ok(!text.includes(secret), `${secret} leaked: ${text}`);
  }
  assert.ok(text.includes("on [redacted] key"));
});

test("URLs are redacted whole, with or without a scheme", () => {
  const text = redactText("Profiles https://www.linkedin.com/in/jane-doe-42, www.example.org/team and github.com/acme/secret-proj failed");
  assert.equal(text, "Profiles [redacted], [redacted] and [redacted] failed");
  assert.equal(redactText("Cannot read convex/judging.ts:72 or /events/hack/admin."), "Cannot read convex/judging.ts:72 or /events/hack/admin.");
});

test("ordinary error text survives redaction", () => {
  assert.equal(redactText("Judging is not open."), "Judging is not open.");
  assert.equal(redactText("Add between 1 and 25 test submissions at a time."), "Add between 1 and 25 test submissions at a time.");
});

test("redacted text is cut to the limit", () => {
  assert.equal(redactText("a".repeat(5000), 300).length, 300);
});
