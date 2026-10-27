import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from "vitest";
import { api } from "./_generated/api";
import { LUMA_LOOKUP_CACHE_MS, LUMA_LOOKUP_LIMITS } from "./luma";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./emails.ts": () => import("./emails"),
  "./judging.ts": () => import("./judging"),
  "./tracks.ts": () => import("./tracks"),
  "./luma.ts": () => import("./luma"),
  "./judgingSheetSync.ts": () => import("./judgingSheetSync"),
  "./googleSheets.ts": () => import("./googleSheets"),
};

const organizationId = "org_outpost";
const identity = { subject: "user_operator", issuer: "https://api.workos.com/user_management/client_test", org_id: organizationId };
const slug = "hack-night";
const KEY = "luma-test-key-not-real";

type LumaReply = { status: number; body?: unknown } | Error;
let replies: Map<string, LumaReply>;
let fetchMock: ReturnType<typeof vi.fn>;
let logs: MockInstance<(...args: unknown[]) => void>;

/** The model of Luma: answers by path (and guest email), never the real API. */
function lumaReplies(entries: Record<string, LumaReply>) {
  replies = new Map(Object.entries(entries));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("LUMA_API_KEY", "");
  replies = new Map();
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    const key = url.pathname === "/v1/events/guests/get" ? `guest:${url.searchParams.get("id")}` : `${url.pathname}?${url.searchParams}`;
    const reply = replies.get(key) ?? { status: 404, body: { message: "not found" } };
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  logs = vi.spyOn(console, "log").mockImplementation(() => {}) as unknown as typeof logs;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const configure = () => vi.stubEnv("LUMA_API_KEY", KEY);

const lumaEvent = { id: "evt-HackSprint1", name: "Daytona HackSprint London", url: "https://luma.com/hacksprint-ldn", calendar_id: "cal-1", visibility: "public" };
const fullGuest = {
  id: "gst-1",
  user_email: "sam@example.com",
  user_name: "Sam Lee",
  user_first_name: "Sam",
  phone_number: "+447700900123",
  approval_status: "approved",
  check_in_qr_code: "https://luma.com/check-in/secret",
  registration_answers: [
    { label: "X", question_id: "q1", question_type: "twitter", value: "@samlee" },
    { label: "LinkedIn", question_id: "q2", question_type: "linkedin", value: "https://www.linkedin.com/in/sam-lee" },
    { label: "GitHub", question_id: "q3", question_type: "github", value: "github.com/samlee" },
    { label: "Dietary needs", question_id: "q4", question_type: "text", value: "Vegan" },
    { label: "Phone", question_id: "q5", question_type: "phone-number", value: "+447700900123" },
  ],
  event_tickets: [{ id: "tkt-1", amount: 0 }],
};

async function setup({ linked = true } = {}) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const owner = t.withIdentity(identity);
  await owner.mutation(api.events.createEvent, {
    expectedOrganizationId: organizationId,
    name: "Hack Night",
    slug,
    eventType: "hackathon",
    meetUrl: "https://meet.google.com/example",
    tracks: [{ name: "AI agents" }],
  });
  if (linked) {
    const eventId = (await owner.query(api.events.getAdmin, { slug })).event.id;
    await t.run((ctx) => ctx.db.patch(eventId, { lumaEventId: lumaEvent.id, lumaEventName: lumaEvent.name, lumaEventUrl: lumaEvent.url }));
  }
  return { t, owner };
}

const lumaCalls = () => fetchMock.mock.calls.map(([input, init]) => ({ url: new URL(String(input)), init: init as RequestInit }));
const loggedText = () => logs.mock.calls.map((args) => args.map(String).join(" ")).join("\n");

// ---------------------------------------------------------------------------
// Linking

test("an organiser links a Luma event from its page link; it is looked up first, read-only", async () => {
  configure();
  lumaReplies({
    "/v1/entities/lookup?slug=hacksprint-ldn": { status: 200, body: { entity: { type: "event", event: { id: lumaEvent.id, name: lumaEvent.name } } } },
    [`/v1/events/get?event_id=${lumaEvent.id}`]: { status: 200, body: lumaEvent },
  });
  const { t, owner } = await setup({ linked: false });
  expect((await t.query(api.events.getStage, { slug })).event.lumaLinked).toBe(false);

  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: " https://luma.com/hacksprint-ldn " })).resolves.toEqual({
    id: lumaEvent.id,
    name: lumaEvent.name,
    url: lumaEvent.url,
  });

  const calls = lumaCalls();
  expect(calls.map(({ url }) => url.pathname)).toEqual(["/v1/entities/lookup", "/v1/events/get"]);
  for (const { url, init } of calls) {
    expect(url.origin).toBe("https://public-api.luma.com");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["x-luma-api-key"]).toBe(KEY);
  }
  expect((await owner.query(api.events.getAdmin, { slug })).event.lumaEvent).toEqual({ id: lumaEvent.id, name: lumaEvent.name, url: lumaEvent.url });
  // The public stage query says only whether the event is linked.
  const stage = await t.query(api.events.getStage, { slug });
  expect(stage.event.lumaLinked).toBe(true);
  expect(JSON.stringify(stage)).not.toContain("evt-");
  expect(loggedText()).not.toContain(KEY);
});

test("an evt- id is checked with one event lookup", async () => {
  configure();
  lumaReplies({ [`/v1/events/get?event_id=${lumaEvent.id}`]: { status: 200, body: lumaEvent } });
  const { owner } = await setup({ linked: false });
  await owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: lumaEvent.id });
  expect(lumaCalls().map(({ url }) => url.pathname)).toEqual(["/v1/events/get"]);
  expect((await owner.query(api.events.getAdmin, { slug })).event.lumaEvent?.id).toBe(lumaEvent.id);
});

test("only organisers of the event can link or unlink it, and Luma is not called for anyone else", async () => {
  configure();
  const { t, owner } = await setup();
  await expect(t.action(api.luma.linkLumaEvent, { slug, lumaEvent: lumaEvent.id })).rejects.toThrow("Sign in");
  await expect(t.withIdentity({ ...identity, subject: "user_other", org_id: "org_other" }).action(api.luma.linkLumaEvent, { slug, lumaEvent: lumaEvent.id })).rejects.toThrow("Unauthorized");
  await expect(t.withIdentity({ ...identity, subject: "user_other", org_id: "org_other" }).mutation(api.luma.unlinkLumaEvent, { slug })).rejects.toThrow("Unauthorized");
  expect(fetchMock).not.toHaveBeenCalled();
  await owner.mutation(api.luma.unlinkLumaEvent, { slug });
  expect((await owner.query(api.events.getAdmin, { slug })).event.lumaEvent).toBeNull();
  expect((await t.query(api.events.getStage, { slug })).event.lumaLinked).toBe(false);
});

test("a link Luma does not know, a calendar page or a missing key saves nothing", async () => {
  const { owner } = await setup({ linked: false });
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: lumaEvent.id })).rejects.toThrow("LUMA_API_KEY");
  configure();
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: "https://example.com/evt-abc" })).rejects.toThrow("Enter a Luma event link");
  expect(fetchMock).not.toHaveBeenCalled();
  lumaReplies({
    "/v1/entities/lookup?slug=minimal": { status: 200, body: { entity: { type: "calendar", calendar: { id: "cal-1" } } } },
    "/v1/events/get?event_id=evt-NotOurs": { status: 404, body: { message: "Event not found" } },
    "/v1/events/get?event_id=evt-BadKey": { status: 401, body: { message: "Invalid API key" } },
  });
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: "luma.com/minimal" })).rejects.toThrow("not an event page");
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: "evt-NotOurs" })).rejects.toThrow("could not find that event");
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: "evt-BadKey" })).rejects.toThrow("refused the API key");
  expect((await owner.query(api.events.getAdmin, { slug })).event.lumaEvent).toBeNull();
  expect(loggedText()).toContain('"reason":"not_found"');
  expect(loggedText()).not.toContain(KEY);
});

// ---------------------------------------------------------------------------
// Prefill lookup

test("the lookup returns only the X, LinkedIn and GitHub answers", async () => {
  configure();
  lumaReplies({ "guest:sam@example.com": { status: 200, body: fullGuest } });
  const { t } = await setup();
  const socials = await t.action(api.luma.lookupLumaSocials, { slug, email: "  Sam@Example.com " });
  expect(socials).toEqual({ twitter: "@samlee", linkedin: "https://www.linkedin.com/in/sam-lee", githubProfile: "samlee" });
  expect(Object.keys(socials).sort()).toEqual(["githubProfile", "linkedin", "twitter"]);
  expect(JSON.stringify(socials)).not.toMatch(/Sam Lee|\+44|Vegan|check-in|gst-|tkt-/);

  const [{ url, init }] = lumaCalls();
  expect(url.pathname).toBe("/v1/events/guests/get");
  expect(url.searchParams.get("event_id")).toBe(lumaEvent.id);
  expect(url.searchParams.get("id")).toBe("sam@example.com");
  expect(init.method).toBe("GET");
  expect((init.headers as Record<string, string>)["x-luma-api-key"]).toBe(KEY);
  // Logs say what happened, never who or with which key.
  expect(loggedText()).toContain('"event":"luma-lookup"');
  expect(loggedText()).not.toMatch(/sam@example\.com|samlee|sam-lee/i);
  expect(loggedText()).not.toContain(KEY);
});

test("results are cached briefly under a hash of the email, then deleted", async () => {
  configure();
  lumaReplies({ "guest:sam@example.com": { status: 200, body: fullGuest } });
  const { t } = await setup();
  await t.action(api.luma.lookupLumaSocials, { slug, email: "sam@example.com" });
  await t.action(api.luma.lookupLumaSocials, { slug, email: "SAM@example.com" });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const rows = await t.run((ctx) => ctx.db.query("lumaGuestLookups").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].emailHash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(rows)).not.toContain("sam@example.com");

  vi.advanceTimersByTime(LUMA_LOOKUP_CACHE_MS + 1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run((ctx) => ctx.db.query("lumaGuestLookups").collect())).toHaveLength(0);
  await t.action(api.luma.lookupLumaSocials, { slug, email: "sam@example.com" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("a failed lookup is silent: empty answer, logged with status and reason only, not cached", async () => {
  configure();
  lumaReplies({
    "guest:nobody@example.com": { status: 404, body: { message: "Guest nobody@example.com not found" } },
    "guest:busy@example.com": { status: 503, body: {} },
    "guest:down@example.com": new TypeError("fetch failed"),
    "guest:odd@example.com": { status: 200, body: { registration_answers: "not a list" } },
  });
  const { t } = await setup();
  for (const email of ["nobody@example.com", "busy@example.com", "down@example.com", "odd@example.com"]) {
    await expect(t.action(api.luma.lookupLumaSocials, { slug, email })).resolves.toEqual({});
  }
  expect(loggedText()).toContain('"status":"failed","reason":"http_error","httpStatus":503');
  expect(loggedText()).toContain('"reason":"network"');
  expect(loggedText()).not.toMatch(/nobody@|busy@|down@|odd@/);
  // Someone not registered is cached (as nothing); errors are asked again.
  fetchMock.mockClear();
  await t.action(api.luma.lookupLumaSocials, { slug, email: "nobody@example.com" });
  await t.action(api.luma.lookupLumaSocials, { slug, email: "busy@example.com" });
  expect(lumaCalls().map(({ url }) => url.searchParams.get("id"))).toEqual(["busy@example.com"]);
});

test("nothing is asked of Luma for an unlinked event, closed submissions, a bad email or a missing key", async () => {
  const { t, owner } = await setup({ linked: false });
  configure();
  expect(await t.action(api.luma.lookupLumaSocials, { slug, email: "sam@example.com" })).toEqual({});
  expect(await t.action(api.luma.lookupLumaSocials, { slug: "no-such-event", email: "sam@example.com" })).toEqual({});

  const linked = await setup();
  expect(await linked.t.action(api.luma.lookupLumaSocials, { slug, email: "not-an-email" })).toEqual({});
  vi.stubEnv("LUMA_API_KEY", "");
  expect(await linked.t.action(api.luma.lookupLumaSocials, { slug, email: "sam@example.com" })).toEqual({});
  expect(loggedText()).toContain('"reason":"not_configured"');
  configure();
  await linked.owner.mutation(api.judging.closeSubmissions, { slug });
  expect(await linked.t.action(api.luma.lookupLumaSocials, { slug, email: "sam@example.com" })).toEqual({});
  expect(fetchMock).not.toHaveBeenCalled();
  void owner;
});

test("lookups are rate limited per email and per event", async () => {
  configure();
  // Errors are not cached, so every call here would reach Luma without a limit.
  fetchMock.mockImplementation(async () => new Response("{}", { status: 503 }));
  const { t } = await setup();
  for (let i = 0; i < LUMA_LOOKUP_LIMITS.perEmail.rate + 2; i += 1) {
    await t.action(api.luma.lookupLumaSocials, { slug, email: "sam@example.com" });
  }
  expect(fetchMock).toHaveBeenCalledTimes(LUMA_LOOKUP_LIMITS.perEmail.rate);
  expect(loggedText()).toContain('"reason":"rate_limited","limit":"per_email"');

  fetchMock.mockClear();
  const capacity = LUMA_LOOKUP_LIMITS.perEvent.capacity;
  // The per-email calls above already spent some of the event's tokens.
  for (let i = 0; i < capacity + 5; i += 1) {
    await t.action(api.luma.lookupLumaSocials, { slug, email: `person${i}@example.com` });
  }
  expect(fetchMock.mock.calls.length).toBe(capacity - LUMA_LOOKUP_LIMITS.perEmail.rate);
  expect(loggedText()).toContain('"reason":"rate_limited","limit":"per_event"');
});
