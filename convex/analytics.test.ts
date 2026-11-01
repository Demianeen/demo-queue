import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { track, trackException, organiser } from "./analytics";
import { setupTest } from "./behaviour.testing";

const posted: { url: string; body: { api_key: string; batch: Record<string, unknown>[] } }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  posted.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    posted.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response("{}", { status: 200 });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function runSendBoth() {
  const { t } = setupTest();
  await t.run(async (ctx) => {
    const actor = organiser({ organizationId: "org_live", actor: "https://auth.example|user_01DEMIAN" });
    await track(ctx, "judges_added", actor, { count: 3, event_slug: "hack" });
    await trackException(ctx, new Error("Sync failed for jane.doe@example.com at /judge/hack/tok3n"), { kind: "system" }, "judgingSheetSync:sync");
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

test("events reach PostHog's batch endpoint with the organiser, the environment and PostHog's own properties", async () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
  vi.stubEnv("POSTHOG_ENVIRONMENT", "production");
  await runSendBoth();
  const batch = posted.flatMap((request) => request.body.batch);
  expect(posted.every((request) => request.url === "https://eu.i.posthog.com/batch/" && request.body.api_key === "phc_test")).toBe(true);
  expect(batch.find((event) => event.event === "judges_added")).toMatchObject({
    distinct_id: "user_01DEMIAN",
    properties: { count: 3, event_slug: "hack", organization_id: "org_live", surface: "organiser", environment: "production", $lib: "demo-queue-convex" },
  });
});

test("an exception is sent redacted and anonymous", async () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
  await runSendBoth();
  const exception = posted.flatMap((request) => request.body.batch).find((event) => event.event === "$exception");
  expect(exception).toMatchObject({
    distinct_id: "system",
    properties: { function: "judgingSheetSync:sync", $process_person_profile: false, $exception_list: [{ type: "Error", value: "Sync failed for [redacted] at /judge/hack/[token]" }] },
  });
});

test("an exception whose message can quote model output is sent with its type only", async () => {
  vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
  const { t } = setupTest();
  const error = Object.assign(new Error("Type validation failed: Value: {\"team\":\"Secret Team Rocket\"}"), { name: "AI_TypeValidationError" });
  await t.run((ctx) => trackException(ctx, error, { kind: "system" }, "ai:aiShuffle", {}, { withMessage: false }));
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const exception = posted.flatMap((request) => request.body.batch).find((event) => event.event === "$exception");
  expect(exception).toMatchObject({ properties: { $exception_list: [{ type: "AI_TypeValidationError", value: "AI_TypeValidationError" }] } });
  expect(JSON.stringify(posted)).not.toContain("Secret Team Rocket");
});

test("without a token nothing is scheduled or sent", async () => {
  await runSendBoth();
  expect(posted).toEqual([]);
});
