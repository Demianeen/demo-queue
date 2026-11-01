import { Resend } from "@convex-dev/resend";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import tableHistorySchema from "../node_modules/@convex-dev/table-history/src/component/schema";
import { ACTOR_SUBJECT, ORG, modules } from "./behaviour.testing";

const tableHistoryComponentRoot = "../node_modules/@convex-dev/table-history/src/component";
const tableHistoryModules = {
  "./_generated/api.ts": () => import(/* @vite-ignore */ `${tableHistoryComponentRoot}/_generated/api.ts`),
  "./_generated/server.ts": () => import(/* @vite-ignore */ `${tableHistoryComponentRoot}/_generated/server.ts`),
  "./lib.ts": () => import(/* @vite-ignore */ `${tableHistoryComponentRoot}/lib.ts`),
};

function setup() {
  const root = convexTest(schema, modules);
  root.registerComponent("judgingDecisionHistory", tableHistorySchema, tableHistoryModules);
  rateLimiterTest.register(root);
  const t = root.withIdentity({ subject: ACTOR_SUBJECT, org_id: ORG, tokenIdentifier: `https://api.workos.com/user_management/client_test|${ACTOR_SUBJECT}` });
  return { root, t };
}
type Root = ReturnType<typeof setup>["root"];

type Captured = { event: string; distinct_id: string; properties: Record<string, unknown> };
let bodies: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  bodies = [];
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return new Response("{}", { status: 200 });
  }));
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const COMMON = ["event_id", "event_slug", "event_type", "phase", "practice", "organization_id", "environment", "surface", "$process_person_profile", "$lib"];
const ALLOWED: Record<string, string[]> = {
  event_created: ["from_luma"],
  phase_changed: ["from", "to"],
  stage_mode_changed: ["mode"],
  judges_added: ["count"],
  judge_link_replaced: [],
  submission_submitted: ["tracks", "has_video", "has_repository", "team_size", "form_id"],
  status_link_requested: [],
  submission_withdrawn: [],
  email_sent: ["kind", "submission_id"],
  email_failed: ["kind", "reason", "submission_id"],
  judging_sheet_sync_failed: ["reason"],
  $exception: ["function", "$exception_list", "kind", "submission_id"],
};

/** Every event posted to PostHog's batch endpoint, after the scheduled sends ran. */
async function captured(root: Root) {
  await root.finishAllScheduledFunctions(vi.runAllTimers);
  const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
  expect(urls.every((url) => url.endsWith("/batch/"))).toBe(true);
  const events = bodies.flatMap((body) => (JSON.parse(body) as { batch: Captured[] }).batch);
  for (const { event, properties } of events) {
    expect(ALLOWED[event], `unexpected event ${event}`).toBeDefined();
    expect(Object.keys(properties).filter((key) => !COMMON.includes(key) && !ALLOWED[event].includes(key)), event).toEqual([]);
  }
  return events;
}
const named = (events: Captured[], name: string) => events.filter((event) => event.event === name);

const PRIVATE = ["sam@example.com", "Sam Lee", "ana@example.com", "Ana Ruiz", "Night Owls", "Guardrail", "Stops agents from shipping secrets", "+447911123400", "participant-token-0001", "night-owls/guardrail", "dQw4w9WgXcQ", "Alex Judge", "replacement-link-token-0001"];
function expectNothingPrivate() {
  const all = bodies.join("\n");
  for (const value of PRIVATE) expect(all).not.toContain(value);
}

async function createEvent(t: ReturnType<typeof setup>["t"], slug: string, eventType: "demo" | "hackathon") {
  return t.mutation(api.events.createEvent, { expectedOrganizationId: ORG, name: "Night", slug, eventType, meetUrl: eventType === "demo" ? "https://meet.google.com/example" : "" });
}

async function submitTeam(t: ReturnType<typeof setup>["t"], slug: string) {
  return (await t.mutation(api.events.submitHackathon, {
    slug, participantToken: "participant-token-0001", clientId: "test-browser-analytics-0001",
    name: "Sam Lee", teamName: "Night Owls", teamMembers: ["Ana Ruiz"],
    teamMemberContacts: [{ name: "Ana Ruiz", email: "ana@example.com", whatsappPhone: "+447911123401" }],
    demoTitle: "Guardrail", description: "Stops agents from shipping secrets.", phone: "+447911123400", email: "sam@example.com",
    githubUrl: "https://github.com/night-owls/guardrail", rulesAccepted: true, videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  })) as { submissionId: Id<"submissions"> };
}

test("organiser actions send their events, identified by the WorkOS user id", async () => {
  const { root, t } = setup();
  await createEvent(t, "night", "demo");
  await t.mutation(api.phases.setPhase, { slug: "night", phase: "stage" });
  await t.mutation(api.events.setStageScreenMode, { slug: "night", mode: "qr" });

  const events = await captured(root);
  expect(events.map((event) => event.event)).toEqual(["event_created", "phase_changed", "stage_mode_changed"]);
  for (const event of events) {
    expect(event.distinct_id).toBe(ACTOR_SUBJECT);
    expect(event.properties).toMatchObject({ surface: "organiser", organization_id: ORG, event_slug: "night", event_type: "demo", practice: false });
  }
  expect(events[0].properties).toMatchObject({ from_luma: false, phase: "submissions" });
  expect(events[1].properties).toMatchObject({ from: "submissions", to: "stage", phase: "stage" });
  expect(events[2].properties).toMatchObject({ mode: "qr" });
});

test("judge changes send counts and nothing about the judge", async () => {
  const { root, t } = setup();
  await createEvent(t, "hack", "hackathon");
  const { added } = await t.mutation(api.judging.addJudges, { slug: "hack", names: ["Alex Judge", "Sam Judge"] });
  await t.mutation(api.judging.replaceJudgeLink, { slug: "hack", judgeKey: added[0].judgeKey, capabilityToken: "replacement-link-token-0001" });

  const events = await captured(root);
  expect(named(events, "judges_added").map((event) => event.properties.count)).toEqual([2]);
  expect(named(events, "judge_link_replaced")).toHaveLength(1);
  expectNothingPrivate();
  expect(bodies.join("\n")).not.toContain(added[0].judgeKey);
});

test("a team's submission, status link request and withdrawal send counts only, and a skipped email is a failure", async () => {
  const { root, t } = setup();
  await createEvent(t, "hack", "hackathon");
  await submitTeam(t, "hack");
  await t.mutation(api.events.requestStatusLinkEmail, { slug: "hack", email: "ana@example.com" });
  await root.finishAllScheduledFunctions(vi.runAllTimers);
  await t.mutation(api.events.withdrawSubmission, { slug: "hack", participantToken: "participant-token-0001" });

  const events = await captured(root);
  const [submitted] = named(events, "submission_submitted");
  expect(submitted.properties).toMatchObject({ surface: "team", tracks: 0, has_video: true, has_repository: true, team_size: 2, $process_person_profile: false });
  expect(submitted.distinct_id).not.toBe(ACTOR_SUBJECT);
  // The browser's events from the same page load carry this id too; the raw client id never leaves.
  expect(submitted.properties.form_id).toMatch(/^[0-9a-f]{16}$/);
  expect(JSON.stringify(submitted)).not.toContain("test-browser-analytics-0001");
  expect(named(events, "status_link_requested")).toHaveLength(1);
  expect(named(events, "submission_withdrawn")).toHaveLength(1);
  // No Resend key in tests, so the submitted email is skipped as not configured (the resend waits two minutes).
  expect(named(events, "email_failed").map((event) => event.properties)).toEqual([
    expect.objectContaining({ kind: "status_link_submitted", reason: "not_configured", surface: "system" }),
  ]);
  expectNothingPrivate();
});

test("an email Resend refuses is reported as a failure and an exception without its message", async () => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM_EMAIL", "Demo Queue <hello@demo-queue.test>");
  vi.stubEnv("DEMO_QUEUE_SITE_URL", "https://demo-queue.test");
  vi.spyOn(Resend.prototype, "sendEmail").mockRejectedValue(new Error("Invalid to address sam@example.com"));
  const { root, t } = setup();
  await createEvent(t, "hack", "hackathon");
  const { submissionId } = await submitTeam(t, "hack");

  const events = await captured(root);
  expect(named(events, "email_failed").map((event) => event.properties.reason)).toEqual(["send_error"]);
  const [exception] = named(events, "$exception");
  expect(exception.properties).toMatchObject({ function: "emails.sendStatusLinkEmail", submission_id: submissionId });
  expect(exception.properties.$exception_list).toMatchObject([{ type: "Error", value: "Error" }]);
  expectNothingPrivate();
  expect(await t.run((ctx) => ctx.db.get(submissionId))).not.toBeNull();
});

test("a judging sheet failure sends a fixed code, never Google's message", async () => {
  const { root, t } = setup();
  const { eventId } = await createEvent(t, "hack", "hackathon");
  await t.run((ctx) => ctx.db.patch(eventId, { judgingSheetSyncRevision: 3 }));
  await t.mutation(internal.events.completeJudgingSheetSync, { eventId, revision: 3, error: "The connected Google account does not have permission to update the judging sheet." });

  const events = await captured(root);
  expect(named(events, "judging_sheet_sync_failed").map((event) => event.properties)).toEqual([
    expect.objectContaining({ reason: "forbidden", surface: "system", event_slug: "hack", organization_id: ORG }),
  ]);
  expect(named(events, "$exception").map((event) => event.properties.function)).toEqual(["googleSheets.syncJudgingSheet"]);
  expect(JSON.stringify(named(events, "judging_sheet_sync_failed"))).not.toContain("Google");
});

test("without a PostHog token nothing is scheduled or sent", async () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "");
  const { root, t } = setup();
  await createEvent(t, "hack", "hackathon");
  await t.mutation(api.judging.addJudges, { slug: "hack", names: ["Alex Judge", "Sam Judge"] });
  await submitTeam(t, "hack");
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(jobs.filter((job) => job.name.startsWith("analytics"))).toEqual([]);
  await root.finishAllScheduledFunctions(vi.runAllTimers);
  expect(fetch).not.toHaveBeenCalled();
});
