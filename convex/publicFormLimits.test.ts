import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./emails.ts": () => import("./emails"),
  "./judging.ts": () => import("./judging"),
  "./tracks.ts": () => import("./tracks"),
  "./judgingSheetSync.ts": () => import("./judgingSheetSync"),
  "./googleSheets.ts": () => import("./googleSheets"),
};
import { EMAIL_CHECK_LIMITED_MESSAGE, PUBLIC_FORM_LIMITS, SUBMIT_EMAIL_LIMITED_MESSAGE, SUBMIT_LIMITED_MESSAGE } from "./events";

const organizationId = "org_outpost";
const identity = { subject: "user_operator", issuer: "https://api.workos.com/user_management/client_test", org_id: organizationId };

// Scheduled emails stay queued unless a test runs them; frozen time keeps buckets from refilling.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function fixture() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const owner = t.withIdentity(identity);
  const slug = "limits-night";
  await owner.mutation(api.events.createEvent, { expectedOrganizationId: organizationId, name: "Night", slug, eventType: "demo", meetUrl: "https://meet.google.com/example" });
  return { t, owner, slug };
}

let counter = 0;
const browser = (name: string) => `test-browser-${name}-${String((counter += 1)).padStart(6, "0")}`;
function submit(t: ReturnType<typeof convexTest>, slug: string, email: string, clientId = browser("submit")) {
  counter += 1;
  return t.mutation(api.events.submitDemo, {
    slug, participantToken: `participant-${counter}`, clientId, name: "Participant", demoTitle: `Demo ${counter}`,
    description: "A working demonstration", phone: "+447911123456", email, queueOrder: counter,
  }).then((result) => ({ ...result, participantToken: `participant-${counter}` }));
}

test("the instant check is limited per browser, answers only {taken}, and refuses bad input", async () => {
  const { t, slug } = await fixture();
  await submit(t, slug, "ada@example.com");
  const check = (clientId: string, email = "ada@example.com") => t.mutation(api.events.checkSubmissionEmail, { slug, email, clientId });
  const one = browser("check");
  for (let index = 0; index < PUBLIC_FORM_LIMITS.emailCheckPerCaller.capacity; index++) {
    expect(await check(one)).toStrictEqual({ taken: true });
  }
  await expect(check(one)).rejects.toThrow(EMAIL_CHECK_LIMITED_MESSAGE);
  expect(await check(browser("check"))).toStrictEqual({ taken: true });
  await expect(check(browser("check"), "not-an-email")).rejects.toThrow("Enter a valid email address.");
  await expect(check("short")).rejects.toThrow("Reload the page and try again.");
});

test("a submit with a taken email answers as a result and spends the limit, so it cannot enumerate", async () => {
  const { t, slug } = await fixture();
  const takenEmails = Array.from({ length: PUBLIC_FORM_LIMITS.submitPerCaller.capacity + 1 }, (_, index) => `taken-${index}@example.com`);
  for (const email of takenEmails) await submit(t, slug, email);
  const one = browser("probe");
  for (const email of takenEmails.slice(0, -1)) {
    expect(await submit(t, slug, email, one)).toMatchObject({ emailTaken: true });
  }
  // Each "taken" answer spent a token, so the next probe is refused before any email is read.
  await expect(submit(t, slug, takenEmails.at(-1)!, one)).rejects.toThrow(SUBMIT_LIMITED_MESSAGE);
  await expect(submit(t, slug, "free@example.com", one)).rejects.toThrow(SUBMIT_LIMITED_MESSAGE);
});

test("the instant check and submit share one budget per browser", async () => {
  const { t, slug } = await fixture();
  const one = browser("shared");
  for (let index = 0; index < PUBLIC_FORM_LIMITS.emailCheckPerCaller.capacity; index++) {
    await t.mutation(api.events.checkSubmissionEmail, { slug, email: `probe-${index}@example.com`, clientId: one });
  }
  await expect(submit(t, slug, "real@example.com", one)).rejects.toThrow(SUBMIT_LIMITED_MESSAGE);
});

test("submits are limited per browser and per email, and a submit refused before the email check costs nothing", async () => {
  const { t, slug } = await fixture();
  const one = browser("one");
  const badSocial = () =>
    t.mutation(api.events.submitDemo, {
      slug, participantToken: `bad-${(counter += 1)}`, clientId: one, name: "Participant", demoTitle: "Demo",
      description: "A working demonstration", phone: "+447911123456", email: "bad@example.com", twitter: "https://example.com/not-x", queueOrder: 1,
    });
  for (let index = 0; index < 5; index++) await expect(badSocial()).rejects.toThrow();
  for (let index = 0; index < PUBLIC_FORM_LIMITS.submitPerCaller.capacity; index++) await submit(t, slug, `one-${index}@example.com`, one);
  await expect(submit(t, slug, "one-more@example.com", one)).rejects.toThrow(SUBMIT_LIMITED_MESSAGE);
  await expect(submit(t, slug, "one-more@example.com")).resolves.toHaveProperty("submissionId");

  // Withdraw and resubmit rounds with one email stop at the per email limit, whatever the browser.
  for (let index = 0; index < PUBLIC_FORM_LIMITS.submitPerEmail.capacity; index++) {
    const round = await submit(t, slug, "cycle@example.com");
    await t.mutation(api.events.withdrawSubmission, { slug, participantToken: round.participantToken });
  }
  await expect(submit(t, slug, "cycle@example.com")).rejects.toThrow(SUBMIT_EMAIL_LIMITED_MESSAGE);
});

test("an event-wide surge never refuses a submit; it only warns the organiser", async () => {
  const { t, owner, slug } = await fixture();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    for (let index = 0; index <= PUBLIC_FORM_LIMITS.submitPerEvent.capacity; index++) await submit(t, slug, `surge-${index}@example.com`);
    expect(warn).toHaveBeenCalledWith("Submission surge", expect.anything());
  } finally {
    warn.mockRestore();
  }
  const admin = await owner.query(api.events.getAdmin, { slug });
  expect(admin.event.submissionSurgeAt).toBe(Date.now());
  expect(admin.pool).toHaveLength(PUBLIC_FORM_LIMITS.submitPerEvent.capacity + 1);
});
