import assert from "node:assert/strict";
import test from "node:test";

import {
  createLumaClient,
  LUMA_API_BASE,
  lumaEmailHash,
  lumaEventPageUrl,
  lumaSocialsFromGuest,
  parseLumaEventInput,
} from "../lib/luma.ts";

const KEY = "test-luma-key-not-real";

function fakeFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = typeof responses === "function" ? responses(url) : responses.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  };
  return { fetch, calls };
}

const guest = (answers, extra = {}) => ({
  id: "gst-1",
  user_email: "sam@example.com",
  user_name: "Sam Lee",
  phone_number: "+447700900123",
  registration_answers: answers,
  ...extra,
});

test("event links and ids are recognised; anything off Luma is not", () => {
  assert.deepEqual(parseLumaEventInput("evt-AbC123"), { kind: "id", eventId: "evt-AbC123" });
  assert.deepEqual(parseLumaEventInput("  https://luma.com/hacksprint-ldn "), { kind: "slug", slug: "hacksprint-ldn" });
  assert.deepEqual(parseLumaEventInput("https://lu.ma/hacksprint-ldn?tk=abc"), { kind: "slug", slug: "hacksprint-ldn" });
  assert.deepEqual(parseLumaEventInput("luma.com/hacksprint-ldn"), { kind: "slug", slug: "hacksprint-ldn" });
  assert.deepEqual(parseLumaEventInput("www.luma.com/hacksprint-ldn"), { kind: "slug", slug: "hacksprint-ldn" });
  assert.deepEqual(parseLumaEventInput("https://luma.com/event/manage/evt-Xyz789/guests"), { kind: "id", eventId: "evt-Xyz789" });
  for (const bad of ["", "hacksprint", "evt-", "evt-has space", "https://evil.com/evt-abc", "https://luma.com.evil.com/x", "https://luma.com/a/b", "javascript:alert(1)", "https://user@luma.com/x", "https://luma.com:8443/x", "ftp://luma.com/x"]) {
    assert.equal(parseLumaEventInput(bad), null, bad);
  }
});

test("only Luma page addresses are kept for the event link", () => {
  assert.equal(lumaEventPageUrl("https://luma.com/hacksprint-ldn"), "https://luma.com/hacksprint-ldn");
  assert.equal(lumaEventPageUrl("hacksprint-ldn"), "https://luma.com/hacksprint-ldn");
  assert.equal(lumaEventPageUrl("https://evil.com/x"), null);
  assert.equal(lumaEventPageUrl("http://luma.com/x"), null);
  assert.equal(lumaEventPageUrl(null), null);
});

test("X, LinkedIn and GitHub answers are read and normalised to the form's formats", () => {
  const socials = lumaSocialsFromGuest(guest([
    { label: "Your X", question_id: "q1", question_type: "twitter", value: "https://x.com/samlee_dev" },
    { label: "LinkedIn", question_id: "q2", question_type: "linkedin", value: "linkedin.com/in/sam-lee-123/?utm=1" },
    { label: "GitHub", question_id: "q3", question_type: "github", value: "https://github.com/samlee" },
    { label: "Company", question_id: "q4", question_type: "company", value: { company: "Acme", job_title: "CTO" } },
    { label: "Anything else?", question_id: "q5", question_type: "text", value: "@not_a_social" },
    { label: "Phone", question_id: "q6", question_type: "phone-number", value: "+447700900123" },
    { label: "Instagram", question_id: "q7", question_type: "instagram", value: "samlee" },
  ]));
  assert.deepEqual(socials, {
    twitter: "@samlee_dev",
    linkedin: "https://linkedin.com/in/sam-lee-123/",
    githubProfile: "samlee",
  });
  // Bare handles work too.
  assert.deepEqual(lumaSocialsFromGuest(guest([
    { question_type: "twitter", value: "samlee" },
    { question_type: "linkedin", value: "sam-lee" },
    { question_type: "github", value: "@samlee" },
  ])), { twitter: "@samlee", linkedin: "https://www.linkedin.com/in/sam-lee", githubProfile: "samlee" });
});

test("nothing but the three handles comes out, and bad answers are dropped", () => {
  const socials = lumaSocialsFromGuest(guest([
    { question_type: "twitter", value: "https://evil.com/samlee" },
    { question_type: "linkedin", value: "javascript:alert(1)" },
    { question_type: "github", value: "https://github.com/samlee/repo" },
    { question_type: "twitter", value: null },
    { question_type: "__proto__", value: "x" },
    { question_type: "toString", value: "x" },
  ]));
  assert.deepEqual(socials, {});
  assert.deepEqual(Object.keys(lumaSocialsFromGuest(guest([{ question_type: "github", value: "samlee" }]))), ["githubProfile"]);
  assert.deepEqual(lumaSocialsFromGuest(guest(null)), {});
  assert.deepEqual(lumaSocialsFromGuest(null), {});
  assert.deepEqual(lumaSocialsFromGuest("nope"), {});
  // The first usable answer of each kind wins.
  assert.deepEqual(lumaSocialsFromGuest(guest([
    { question_type: "github", value: "" },
    { question_type: "github", value: "first" },
    { question_type: "github", value: "second" },
  ])), { githubProfile: "first" });
  // Over-long answers are dropped, not cut.
  assert.deepEqual(lumaSocialsFromGuest(guest([{ question_type: "linkedin", value: `https://linkedin.com/in/${"a".repeat(400)}` }])), {});
});

test("the guest lookup is a GET with the key in its header, returning only the handles", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: guest([{ question_type: "github", value: "samlee" }]) }]);
  const result = await createLumaClient({ apiKey: KEY, fetch }).getGuestSocials("evt-abc123", "sam+demo@example.com");
  assert.deepEqual(result, { ok: true, data: { githubProfile: "samlee" } });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, LUMA_API_BASE);
  assert.equal(url.pathname, "/v1/events/guests/get");
  assert.equal(url.searchParams.get("event_id"), "evt-abc123");
  assert.equal(url.searchParams.get("id"), "sam+demo@example.com");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers["x-luma-api-key"], KEY);
  assert.ok(!calls[0].url.includes(KEY), "the key is never in the address");
  // A response wrapped in { guest } reads the same.
  const wrapped = fakeFetch([{ status: 200, body: { guest: guest([{ question_type: "twitter", value: "@sam" }]) } }]);
  assert.deepEqual(await createLumaClient({ apiKey: KEY, fetch: wrapped.fetch }).getGuestSocials("evt-abc123", "a@b.co"), { ok: true, data: { twitter: "@sam" } });
});

test("failures carry only a status and a reason", async () => {
  const cases = [
    [{ status: 404, body: { message: "Guest sam@example.com not found" } }, { ok: false, status: 404, reason: "not_found" }],
    [{ status: 401, body: { message: `bad key ${KEY}` } }, { ok: false, status: 401, reason: "unauthorized" }],
    [{ status: 403, body: {} }, { ok: false, status: 403, reason: "forbidden" }],
    [{ status: 429, body: {} }, { ok: false, status: 429, reason: "rate_limited" }],
    [{ status: 400, body: {} }, { ok: false, status: 400, reason: "bad_request" }],
    [{ status: 502, body: {} }, { ok: false, status: 502, reason: "http_error" }],
    [Object.assign(new Error("timed out"), { name: "TimeoutError" }), { ok: false, status: 0, reason: "timeout" }],
    [new TypeError("fetch failed"), { ok: false, status: 0, reason: "network" }],
  ];
  for (const [response, expected] of cases) {
    const { fetch } = fakeFetch([response]);
    assert.deepEqual(await createLumaClient({ apiKey: KEY, fetch }).getGuestSocials("evt-abc123", "sam@example.com"), expected);
  }
  const badJson = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } });
  assert.deepEqual(await createLumaClient({ apiKey: KEY, fetch: badJson }).getGuestSocials("evt-abc123", "a@b.co"), { ok: false, status: 200, reason: "bad_response" });
});

test("a slug resolves to an event id; calendars and unknown slugs do not", async () => {
  const { fetch, calls } = fakeFetch([
    { status: 200, body: { entity: { type: "event", event: { id: "evt-abc123", name: "HackSprint" } } } },
    { status: 200, body: { entity: { type: "calendar", calendar: { id: "cal-1" } } } },
    { status: 200, body: { entity: null } },
  ]);
  const client = createLumaClient({ apiKey: KEY, fetch });
  assert.deepEqual(await client.lookupSlug("hacksprint-ldn"), { ok: true, data: { kind: "event", eventId: "evt-abc123" } });
  assert.deepEqual(await client.lookupSlug("minimal"), { ok: true, data: { kind: "other" } });
  assert.deepEqual(await client.lookupSlug("nothing"), { ok: true, data: { kind: "other" } });
  assert.equal(new URL(calls[0].url).pathname, "/v1/entities/lookup");
  assert.equal(new URL(calls[0].url).searchParams.get("slug"), "hacksprint-ldn");
  assert.ok(calls.every((call) => call.init.method === "GET"));
});

test("an event lookup returns its id, name and Luma page only", async () => {
  const { fetch, calls } = fakeFetch([
    { status: 200, body: { id: "evt-abc123", name: "Daytona HackSprint London", url: "https://luma.com/hacksprint-ldn", calendar_id: "cal-1", visibility: "public" } },
    { status: 200, body: { event: { id: "evt-abc123", name: " ", url: "https://evil.com/x" } } },
    { status: 200, body: { name: "no id" } },
  ]);
  const client = createLumaClient({ apiKey: KEY, fetch });
  assert.deepEqual(await client.getEvent("evt-abc123"), { ok: true, data: { id: "evt-abc123", name: "Daytona HackSprint London", url: "https://luma.com/hacksprint-ldn" } });
  assert.deepEqual(await client.getEvent("evt-abc123"), { ok: true, data: { id: "evt-abc123", name: "evt-abc123", url: null } });
  assert.deepEqual(await client.getEvent("evt-abc123"), { ok: false, status: 200, reason: "bad_response" });
  assert.equal(new URL(calls[0].url).pathname, "/v1/events/get");
  assert.equal(new URL(calls[0].url).searchParams.get("event_id"), "evt-abc123");
});

test("the cache key is a hash, never the email", async () => {
  const hash = await lumaEmailHash("sam@example.com");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, await lumaEmailHash("sam@example.com"));
  assert.notEqual(hash, await lumaEmailHash("sam2@example.com"));
  assert.ok(!hash.includes("sam"));
});
