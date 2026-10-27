import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import * as lumaModule from "./luma";
import { LUMA_LOOKUP_CACHE_MS, LUMA_LOOKUP_LIMITS } from "./luma";
import schema from "./schema";

// Each submit comes from its own browser, like separate people.
let lumaClients = 0;

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
const CALENDAR = "cal-outpost";

type LumaReply = { status: number; body?: unknown } | Error;
let replies: Map<string, LumaReply>;
let fetchMock: ReturnType<typeof vi.fn>;
let logs: MockInstance<(...args: unknown[]) => void>;

/** The model of Luma: answers by path (and guest email), never the real API. */
function lumaReplies(entries: Record<string, LumaReply>) {
  for (const [key, reply] of Object.entries(entries)) replies.set(key, reply);
}

const lumaEvent = { id: "evt-HackSprint1", name: "Daytona HackSprint London", url: "https://luma.com/hacksprint-ldn", calendar_id: CALENDAR, visibility: "public" };
const guest = (answers: { question_type: string; value: string }[]) => ({
  id: "gst-1",
  user_email: "someone@example.com",
  user_name: "Someone",
  phone_number: "+447700900123",
  check_in_qr_code: "https://luma.com/check-in/secret",
  registration_answers: [
    ...answers.map((answer, index) => ({ label: answer.question_type, question_id: `q${index}`, ...answer })),
    { label: "Dietary needs", question_id: "qd", question_type: "text", value: "Vegan" },
  ],
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("LUMA_API_KEY", "");
  vi.stubEnv("LUMA_ORGANIZATION_IDS", "");
  replies = new Map([
    [`/v1/events/get?event_id=${lumaEvent.id}`, { status: 200, body: lumaEvent }],
    ["/v1/calendars/get?", { status: 200, body: { id: CALENDAR, name: "Outpost" } }],
    ["/v1/entities/lookup?slug=hacksprint-ldn", { status: 200, body: { entity: { type: "event", event: { id: lumaEvent.id, name: lumaEvent.name } } } }],
  ]);
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.origin !== "https://public-api.luma.com") return new Response("not here", { status: 404 });
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

/** The key and the organisations that own its calendar. */
const configure = (organizations = organizationId) => {
  vi.stubEnv("LUMA_API_KEY", KEY);
  vi.stubEnv("LUMA_ORGANIZATION_IDS", organizations);
};

async function setup({ linked = true, org = organizationId } = {}) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const owner = t.withIdentity({ ...identity, org_id: org });
  await owner.mutation(api.events.createEvent, {
    expectedOrganizationId: org,
    name: "Hack Night",
    slug,
    eventType: "hackathon",
    meetUrl: "https://meet.google.com/example",
    tracks: [{ name: "AI agents" }],
  });
  const eventId = (await owner.query(api.events.getAdmin, { slug })).event.id;
  if (linked) {
    await t.run((ctx) => ctx.db.patch(eventId, { lumaEventId: lumaEvent.id, lumaEventName: lumaEvent.name, lumaEventUrl: lumaEvent.url }));
  }
  return { t, owner, eventId };
}

type T = Awaited<ReturnType<typeof setup>>["t"];
const runAll = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const lumaCalls = () =>
  fetchMock.mock.calls
    .map(([input, init]) => ({ url: new URL(String(input)), init: init as RequestInit }))
    .filter(({ url }) => url.origin === "https://public-api.luma.com");
const guestLookups = () => lumaCalls().filter(({ url }) => url.pathname === "/v1/events/guests/get").map(({ url }) => url.searchParams.get("id"));
const loggedText = () => logs.mock.calls.map((args) => args.map(String).join(" ")).join("\n");

const TOKEN = "participant-token-for-the-team-0001";
async function submitTeam(t: T, overrides: { presenterEmail?: string; twitter?: string; token?: string; memberDomain?: string } = {}) {
  const domain = overrides.memberDomain ?? "example.com";
  const stage = await t.query(api.events.getStage, { slug });
  return t.mutation(api.events.submitHackathon, {
    slug,
    participantToken: overrides.token ?? TOKEN,
    clientId: `test-browser-luma-${String((lumaClients += 1)).padStart(6, "0")}`,
    name: "Sam Lee",
    teamName: "Night Owls",
    teamMembers: ["Ana Ruiz", "Noor Bakr"],
    teamMemberContacts: [
      { name: "Ana Ruiz", email: domain === "example.com" ? "Ana@Example.com" : `ana@${domain}`, whatsappPhone: "+447911123401" },
      { name: "Noor Bakr", email: `noor@${domain}`, whatsappPhone: "+447911123402", githubProfile: "noorb" },
    ],
    demoTitle: "Guardrail",
    description: "Stops agents from shipping secrets.",
    phone: "+447911123400",
    email: overrides.presenterEmail ?? "sam@example.com",
    twitter: overrides.twitter ?? "@sam_typed",
    githubUrl: "https://github.com/night-owls/guardrail",
    rulesAccepted: true,
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    trackIds: [stage.event.tracks[0].id],
  });
}

function registered() {
  lumaReplies({
    "guest:sam@example.com": { status: 200, body: guest([
      { question_type: "twitter", value: "@samlee" },
      { question_type: "linkedin", value: "https://www.linkedin.com/in/sam-lee" },
      { question_type: "github", value: "github.com/samlee" },
    ]) },
    "guest:ana@example.com": { status: 200, body: guest([
      { question_type: "linkedin", value: "linkedin.com/in/ana-ruiz" },
      { question_type: "github", value: "anaruiz" },
    ]) },
    "guest:noor@example.com": { status: 200, body: guest([{ question_type: "github", value: "noor-from-luma" }]) },
  });
}

const people = (t: T, submissionId: Id<"submissions">) =>
  t.run(async (ctx) => ({
    presenter: await ctx.db.get(submissionId),
    members: await ctx.db.query("teamMembers").withIndex("by_submission", (q) => q.eq("submissionId", submissionId)).collect(),
  }));

// ---------------------------------------------------------------------------
// No public lookup

test("nothing public reads Luma guests: only linking and unlinking are public", async () => {
  const publicFunctions = Object.entries(lumaModule)
    .filter(([, value]) => typeof value === "function" && (value as { isPublic?: boolean }).isPublic)
    .map(([name]) => name)
    .sort();
  expect(publicFunctions).toEqual(["linkLumaEvent", "unlinkLumaEvent"]);
  configure();
  const { t } = await setup();
  await expect(t.action(anyApi.luma.lookupLumaSocials, { slug, email: "sam@example.com" })).rejects.toThrow();
  expect(lumaCalls()).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Import after submit

test("after a submit, empty socials are imported from Luma; typed ones are kept", async () => {
  configure();
  registered();
  const { t, owner } = await setup();
  const { submissionId } = await submitTeam(t);
  // Nothing reaches Luma inside the submit itself.
  expect(lumaCalls()).toHaveLength(0);
  await runAll(t);

  expect(guestLookups().sort()).toEqual(["ana@example.com", "noor@example.com", "sam@example.com"]);
  for (const { init, url } of lumaCalls()) {
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["x-luma-api-key"]).toBe(KEY);
    expect(url.searchParams.get("event_id")).toBe(lumaEvent.id);
  }
  const { presenter, members } = await people(t, submissionId);
  expect(presenter).toMatchObject({
    twitter: "@sam_typed",
    linkedin: "https://www.linkedin.com/in/sam-lee",
    githubProfile: "samlee",
    socialSources: { twitter: "typed", linkedin: "luma", githubProfile: "luma" },
  });
  const ana = members.find((member) => member.name === "Ana Ruiz")!;
  expect(ana).toMatchObject({ linkedin: "https://linkedin.com/in/ana-ruiz", githubProfile: "anaruiz", socialSources: { linkedin: "luma", githubProfile: "luma" } });
  expect(ana.twitter).toBeUndefined();
  const noor = members.find((member) => member.name === "Noor Bakr")!;
  expect(noor).toMatchObject({ githubProfile: "noorb", socialSources: { githubProfile: "typed" } });
  // Nothing else from the guest record is stored anywhere.
  const everything = JSON.stringify(await t.run(async (ctx) => [await ctx.db.query("submissions").collect(), await ctx.db.query("teamMembers").collect(), await ctx.db.query("lumaGuestLookups").collect()]));
  expect(everything).not.toMatch(/Vegan|check-in|gst-|\+447700900123|Someone/);

  // Organisers see the imported values where socials already show.
  const admin = await owner.query(api.events.getAdmin, { slug });
  const item = [...admin.lineup, ...admin.pool].find((submission) => submission.id === submissionId)!;
  expect(item).toMatchObject({ linkedin: "https://www.linkedin.com/in/sam-lee", githubProfile: "samlee" });
  expect(item.teamMemberContacts.find((member) => member.name === "Ana Ruiz")).toMatchObject({ githubProfile: "anaruiz" });

  // The private status page marks what came from Luma.
  const participant = await t.query(api.events.getParticipant, { slug, participantToken: TOKEN });
  expect(participant.submission.fromLuma).toEqual({ twitter: false, linkedin: true, githubProfile: true });
  expect(participant.submission.teamMemberSocials.find((member) => member.name === "Ana Ruiz")).toMatchObject({
    githubProfile: "anaruiz",
    fromLuma: { twitter: false, linkedin: true, githubProfile: true },
  });
  expect(JSON.stringify(participant.submission.teamMemberSocials)).not.toMatch(/@example\.com|\+4479/);

  // Logs say how many, never who or with which key.
  expect(loggedText()).toContain('"event":"luma-import","status":"ok"');
  expect(loggedText()).not.toMatch(/@example\.com|samlee|anaruiz|sam-lee/i);
  expect(loggedText()).not.toContain(KEY);

  // Running the import again inside the cache window does not call Luma.
  // (runAll above also ran the scheduled cache expiry, so warm the cache once first.)
  await t.action(internal.luma.importSubmissionSocials, { submissionId });
  const before = lumaCalls().length;
  await t.action(internal.luma.importSubmissionSocials, { submissionId });
  expect(lumaCalls()).toHaveLength(before);
  expect(loggedText()).toContain('"cached":');
});

test("what the team typed or cleared is never refilled by a later import", async () => {
  configure();
  registered();
  const { t } = await setup();
  const { submissionId } = await submitTeam(t);
  await runAll(t);
  // The presenter clears LinkedIn and changes GitHub; a member corrects their GitHub.
  await t.mutation(api.events.editParticipantContact, {
    slug, participantToken: TOKEN, phone: "+447911123400", email: "sam@example.com", twitter: "@sam_typed", githubProfile: "sam-fixed",
  });
  const ana = (await people(t, submissionId)).members.find((member) => member.name === "Ana Ruiz")!;
  await t.mutation(api.events.editTeamMemberSocials, {
    slug, participantToken: TOKEN, memberId: ana._id, twitter: "", linkedin: ana.linkedin ?? "", githubProfile: "ana-real",
  });

  // Luma is asked again (cache expired); nothing the team set changes.
  vi.advanceTimersByTime(LUMA_LOOKUP_CACHE_MS + 1);
  await runAll(t);
  await t.action(internal.luma.importSubmissionSocials, { submissionId });
  await runAll(t);
  const after = await people(t, submissionId);
  expect(after.presenter).toMatchObject({ twitter: "@sam_typed", githubProfile: "sam-fixed", socialSources: { twitter: "typed", linkedin: "typed", githubProfile: "typed" } });
  expect(after.presenter?.linkedin).toBeUndefined();
  const anaAfter = after.members.find((member) => member.name === "Ana Ruiz")!;
  // The unchanged LinkedIn keeps its Luma source; the corrected GitHub is now typed.
  expect(anaAfter).toMatchObject({ githubProfile: "ana-real", linkedin: "https://linkedin.com/in/ana-ruiz", socialSources: { githubProfile: "typed", linkedin: "luma" } });
  expect(anaAfter.twitter).toBeUndefined();
});

test("a new email clears what Luma filled from the old one and imports again", async () => {
  configure();
  registered();
  lumaReplies({ "guest:sam.new@example.com": { status: 200, body: guest([{ question_type: "github", value: "sam-new" }]) } });
  const { t } = await setup();
  const { submissionId } = await submitTeam(t);
  await runAll(t);
  await t.mutation(api.events.editParticipantContact, {
    slug, participantToken: TOKEN, phone: "+447911123400", email: "sam.new@example.com", twitter: "@sam_typed",
    linkedin: "https://www.linkedin.com/in/sam-lee", githubProfile: "samlee",
  });
  await runAll(t);
  const { presenter } = await people(t, submissionId);
  expect(presenter).toMatchObject({ twitter: "@sam_typed", githubProfile: "sam-new", socialSources: { twitter: "typed", githubProfile: "luma" } });
  expect(presenter?.linkedin).toBeUndefined();
});

test("linking an event imports the teams that already submitted", async () => {
  configure();
  registered();
  const { t, owner } = await setup({ linked: false });
  const { submissionId } = await submitTeam(t);
  await runAll(t);
  expect(lumaCalls()).toHaveLength(0);
  await owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: lumaEvent.id });
  await runAll(t);
  expect(guestLookups().sort()).toEqual(["ana@example.com", "noor@example.com", "sam@example.com"]);
  expect((await people(t, submissionId)).presenter?.githubProfile).toBe("samlee");
});

test("a failed lookup changes nothing and logs only status and reason", async () => {
  configure();
  lumaReplies({
    "guest:sam@example.com": { status: 503, body: {} },
    "guest:ana@example.com": new TypeError("fetch failed"),
    "guest:noor@example.com": { status: 200, body: { registration_answers: "not a list" } },
  });
  const { t } = await setup();
  const { submissionId } = await submitTeam(t);
  await runAll(t);
  const { presenter, members } = await people(t, submissionId);
  expect(presenter).toMatchObject({ twitter: "@sam_typed", socialSources: { twitter: "typed" } });
  expect(presenter?.linkedin).toBeUndefined();
  expect(members.every((member) => !member.linkedin && !member.twitter)).toBe(true);
  expect(loggedText()).toContain('"status":"failed","reason":"http_error","httpStatus":503');
  expect(loggedText()).toContain('"reason":"network"');
  expect(loggedText()).not.toMatch(/@example\.com/);
  expect(loggedText()).not.toContain(KEY);
});

test("no import without a key, for an unlinked event, or for an organisation not allowed", async () => {
  registered();
  const unlinked = await setup({ linked: false });
  configure();
  await submitTeam(unlinked.t);
  await runAll(unlinked.t);

  const noKey = await setup();
  vi.stubEnv("LUMA_API_KEY", "");
  await submitTeam(noKey.t);
  await runAll(noKey.t);

  // An event linked earlier, whose organisation is no longer on the list.
  configure("org_someoneelse");
  const removed = await setup();
  const { submissionId } = await submitTeam(removed.t);
  await runAll(removed.t);
  await removed.t.action(internal.luma.importSubmissionSocials, { submissionId });
  expect(loggedText()).toContain('"reason":"organization_not_allowed"');
  expect(lumaCalls()).toHaveLength(0);
});

test("lookups are rate limited per email and per event, and cached under a hash", async () => {
  configure();
  fetchMock.mockImplementation(async () => new Response("{}", { status: 503 }));
  const { t, eventId } = await setup();
  const { submissionId } = await submitTeam(t);
  await runAll(t);
  for (let i = 0; i < LUMA_LOOKUP_LIMITS.perEmail.rate + 2; i += 1) {
    await t.action(internal.luma.importSubmissionSocials, { submissionId });
  }
  const perPerson = (email: string) => fetchMock.mock.calls.filter(([input]) => new URL(String(input)).searchParams.get("id") === email).length;
  expect(perPerson("sam@example.com")).toBe(LUMA_LOOKUP_LIMITS.perEmail.rate);
  expect(loggedText()).toContain('"reason":"rate_limited","limit":"per_email"');

  const results = [];
  for (let i = 0; i < LUMA_LOOKUP_LIMITS.perEvent.capacity + 2; i += 1) {
    results.push(await t.mutation(internal.luma.beginGuestLookup, { eventId, lumaEventId: lumaEvent.id, emailHash: `hash-${i}` }));
  }
  expect(results.filter((result) => result.kind === "limited" && result.limit === "per_event").length).toBeGreaterThan(0);

  // A successful lookup is cached under a hash and dropped after 10 minutes.
  await t.mutation(internal.luma.saveGuestLookup, { eventId, lumaEventId: lumaEvent.id, emailHash: "a".repeat(64), socials: { githubProfile: "x" } });
  const rows = await t.run((ctx) => ctx.db.query("lumaGuestLookups").collect());
  expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.emailHash))).toBe(true);
  vi.advanceTimersByTime(LUMA_LOOKUP_CACHE_MS + 1);
  await runAll(t);
  expect(await t.run((ctx) => ctx.db.query("lumaGuestLookups").collect())).toHaveLength(0);
});

test("only the team's own private link can correct a member's socials", async () => {
  configure();
  const { t } = await setup();
  const { submissionId } = await submitTeam(t);
  await submitTeam(t, { presenterEmail: "other@example.com", token: "participant-token-for-another-team1", memberDomain: "other.example" });
  const ana = (await people(t, submissionId)).members.find((member) => member.name === "Ana Ruiz")!;
  const edit = { slug, memberId: ana._id, twitter: "@hijack", linkedin: "", githubProfile: "" };
  await expect(t.mutation(api.events.editTeamMemberSocials, { ...edit, participantToken: "participant-token-for-another-team1" })).rejects.toThrow("Submission not found");
  await expect(t.mutation(api.events.editTeamMemberSocials, { ...edit, participantToken: "nope" })).rejects.toThrow("Submission not found");
  await expect(t.mutation(api.events.editTeamMemberSocials, { ...edit, participantToken: TOKEN, twitter: "not a handle!" })).rejects.toThrow();
  expect((await people(t, submissionId)).members.find((member) => member.name === "Ana Ruiz")?.twitter).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Linking

test("an organiser of the key's calendar links a Luma event from its page link, read-only", async () => {
  configure();
  const { t, owner } = await setup({ linked: false });
  expect((await owner.query(api.events.getAdmin, { slug })).event.luma).toEqual({ available: true, event: null });
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: " https://luma.com/hacksprint-ldn " })).resolves.toEqual({
    id: lumaEvent.id, name: lumaEvent.name, url: lumaEvent.url,
  });
  expect(lumaCalls().map(({ url }) => url.pathname)).toEqual(["/v1/entities/lookup", "/v1/events/get", "/v1/calendars/get"]);
  expect(lumaCalls().every(({ init }) => init.method === "GET")).toBe(true);
  expect((await owner.query(api.events.getAdmin, { slug })).event.luma.event).toEqual({ id: lumaEvent.id, name: lumaEvent.name, url: lumaEvent.url });
  const stage = await t.query(api.events.getStage, { slug });
  expect(stage.event.lumaLinked).toBe(true);
  expect(JSON.stringify(stage)).not.toContain("evt-");
  expect(loggedText()).not.toContain(KEY);
});

test("an organisation that does not own the key's calendar cannot link, and Luma is not called", async () => {
  configure(organizationId);
  const { owner } = await setup({ linked: false, org: "org_foreign" });
  expect((await owner.query(api.events.getAdmin, { slug })).event.luma.available).toBe(false);
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: lumaEvent.id })).rejects.toThrow("not available for this organization");
  expect(lumaCalls()).toHaveLength(0);
  expect((await owner.query(api.events.getAdmin, { slug })).event.luma.event).toBeNull();
});

test("an event from another Luma calendar is rejected", async () => {
  configure();
  lumaReplies({ "/v1/events/get?event_id=evt-Elsewhere": { status: 200, body: { ...lumaEvent, id: "evt-Elsewhere", calendar_id: "cal-someone-else" } } });
  const { owner } = await setup({ linked: false });
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: "evt-Elsewhere" })).rejects.toThrow("not on the calendar");
  expect((await owner.query(api.events.getAdmin, { slug })).event.luma.event).toBeNull();
  expect(loggedText()).toContain('"reason":"other_calendar"');
});

test("only organisers of the event can link or unlink it", async () => {
  configure(`${organizationId},org_other`);
  const { t, owner } = await setup();
  await expect(t.action(api.luma.linkLumaEvent, { slug, lumaEvent: lumaEvent.id })).rejects.toThrow("Sign in");
  const other = t.withIdentity({ ...identity, subject: "user_other", org_id: "org_other" });
  await expect(other.action(api.luma.linkLumaEvent, { slug, lumaEvent: lumaEvent.id })).rejects.toThrow("Unauthorized");
  await expect(other.mutation(api.luma.unlinkLumaEvent, { slug })).rejects.toThrow("Unauthorized");
  expect(lumaCalls()).toHaveLength(0);
  await owner.mutation(api.luma.unlinkLumaEvent, { slug });
  expect((await owner.query(api.events.getAdmin, { slug })).event.luma.event).toBeNull();
  expect((await t.query(api.events.getStage, { slug })).event.lumaLinked).toBe(false);
});

test("a link Luma does not know, a calendar page or a missing key saves nothing", async () => {
  vi.stubEnv("LUMA_ORGANIZATION_IDS", organizationId);
  const { owner } = await setup({ linked: false });
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: lumaEvent.id })).rejects.toThrow("LUMA_API_KEY");
  configure();
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: "https://example.com/evt-abc" })).rejects.toThrow("Enter a Luma event link");
  expect(lumaCalls()).toHaveLength(0);
  lumaReplies({
    "/v1/entities/lookup?slug=minimal": { status: 200, body: { entity: { type: "calendar", calendar: { id: "cal-1" } } } },
    "/v1/events/get?event_id=evt-NotOurs": { status: 404, body: { message: "Event not found" } },
    "/v1/events/get?event_id=evt-BadKey": { status: 401, body: { message: "Invalid API key" } },
  });
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: "luma.com/minimal" })).rejects.toThrow("not an event page");
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: "evt-NotOurs" })).rejects.toThrow("could not find that event");
  await expect(owner.action(api.luma.linkLumaEvent, { slug, lumaEvent: "evt-BadKey" })).rejects.toThrow("refused the API key");
  expect((await owner.query(api.events.getAdmin, { slug })).event.luma.event).toBeNull();
  expect(loggedText()).not.toContain(KEY);
});
