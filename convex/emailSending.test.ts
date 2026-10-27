import { Resend } from "@convex-dev/resend";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from "vitest";
import { api, internal } from "./_generated/api";
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

const organizationId = "org_outpost";
const identity = { subject: "user_operator", issuer: "https://api.workos.com/user_management/client_test", org_id: organizationId };
const slug = "hack-night";
const token = "participant-token-for-the-team-0001";

let sendEmail: MockInstance<(ctx: unknown, options: unknown) => Promise<unknown>>;
beforeEach(() => {
  vi.useFakeTimers();
  // The model of the outside world: Resend is never called for real.
  sendEmail = vi.spyOn(Resend.prototype, "sendEmail").mockResolvedValue("email_1" as never) as unknown as typeof sendEmail;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function configure() {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM_EMAIL", "Demo Queue <hello@demo-queue.test>");
  vi.stubEnv("DEMO_QUEUE_SITE_URL", "https://demo-queue.test");
}

async function team() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(identity);
  await owner.mutation(api.events.createEvent, {
    expectedOrganizationId: organizationId,
    name: "Outpost <Hack> Night",
    slug,
    eventType: "hackathon",
    meetUrl: "https://meet.google.com/example",
    tracks: [{ name: "AI agents" }, { name: "Developer tools" }],
  });
  const stage = await t.query(api.events.getStage, { slug });
  const { submissionId } = await t.mutation(api.events.submitHackathon, {
    slug,
    participantToken: token,
    name: "Sam Lee",
    teamName: "Night Owls",
    teamMembers: ["Ana Ruiz", "Luca Romano"],
    teamMemberContacts: [
      { name: "Ana Ruiz", email: "ana@example.com", whatsappPhone: "+447911123401", linkedin: "linkedin.com/in/ana" },
      { name: "Luca Romano", email: "Luca@Example.com", whatsappPhone: "+447911123402", githubProfile: "luca" },
    ],
    demoTitle: "Guardrail <b>",
    description: "Stops agents from shipping secrets.",
    phone: "+447911123400",
    email: "sam@example.com",
    twitter: "@samlee",
    githubUrl: "https://github.com/night-owls/guardrail",
    rulesAccepted: true,
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    trackIds: [stage.event.tracks[1].id],
  });
  return { t, owner, submissionId };
}

test("submitting queues the email, and without settings it is skipped", async () => {
  const { t, submissionId } = await team();
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(jobs.filter((job) => job.name.startsWith("emails"))).toHaveLength(1);
  expect((await t.run((ctx) => ctx.db.get(submissionId)))?.statusLinkEmailedAt).toBeTypeOf("number");

  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(sendEmail).not.toHaveBeenCalled();
  expect(info).toHaveBeenCalledWith("status-link-email", expect.objectContaining({ status: "skipped", why: "not_configured" }));
  // Nothing about the people or the link is logged.
  expect(JSON.stringify(info.mock.calls)).not.toMatch(/example\.com|participant-token/);
});

test("with settings, everyone on the team gets the details and the status link", async () => {
  configure();
  const { t, submissionId } = await team();
  const result = await t.mutation(internal.emails.sendStatusLinkEmail, { submissionId, reason: "submitted" });
  expect(result).toEqual({ sent: 3 });
  const messages = sendEmail.mock.calls.map((call) => call[1] as { from: string; to: string; subject: string; html: string; text: string });
  expect(messages.map((message) => message.to)).toEqual(["sam@example.com", "ana@example.com", "Luca@Example.com"]);
  const [first] = messages;
  expect(first.from).toBe('"Outpost Hack Night via Demo Queue" <hello@demo-queue.test>');
  expect(first.subject).toBe("You submitted Guardrail <b> to Outpost <Hack> Night");
  expect(first.text).toContain(`https://demo-queue.test/s/${slug}/${token}`);
  expect(first.text).toContain("Team: Night Owls · Sam Lee, Ana Ruiz, Luca Romano");
  expect(first.text).toContain("Tracks: Developer tools");
  expect(first.html).toContain("Guardrail &lt;b&gt;");
  expect(first.html).not.toContain("Guardrail <b>");
  expect(first.html).toContain("Your team is in, Sam");
  expect(messages[1].html).toContain("Your team is in, Ana");
});

test("a resend goes only to the person who asked, and nothing goes to a withdrawn team", async () => {
  configure();
  const { t, submissionId } = await team();
  expect(await t.mutation(internal.emails.sendStatusLinkEmail, { submissionId, reason: "resend", to: "luca@example.com" })).toEqual({ sent: 1 });
  expect(sendEmail.mock.calls[0][1]).toMatchObject({ to: "Luca@Example.com", subject: "Your status link for Guardrail <b> at Outpost <Hack> Night" });
  expect(await t.mutation(internal.emails.sendStatusLinkEmail, { submissionId, reason: "resend", to: "stranger@example.com" })).toEqual({ sent: 0 });

  await t.run((ctx) => ctx.db.patch(submissionId, { status: "withdrawn" }));
  expect(await t.mutation(internal.emails.sendStatusLinkEmail, { submissionId, reason: "submitted" })).toEqual({ sent: 0 });
  expect(sendEmail).toHaveBeenCalledTimes(1);
});

test("the submit page shows what was sent to the browser holding the token, and nothing else", async () => {
  const { t, owner } = await team();
  const view = await t.query(api.events.getSubmittedView, { slug, participantToken: token });
  expect(view).toMatchObject({
    eventType: "hackathon",
    emailConfigured: false,
    withdrawn: false,
    email: "sam@example.com",
    teamName: "Night Owls",
    demoTitle: "Guardrail <b>",
    tracks: ["Developer tools"],
    githubUrl: "https://github.com/night-owls/guardrail",
  });
  expect(view?.people).toEqual([
    { name: "Sam Lee", presenter: true, twitter: "@samlee", linkedin: undefined, githubProfile: undefined },
    { name: "Ana Ruiz", presenter: false, twitter: undefined, linkedin: "linkedin.com/in/ana", githubProfile: undefined },
    { name: "Luca Romano", presenter: false, twitter: undefined, linkedin: undefined, githubProfile: "luca" },
  ]);
  // No phone numbers or team member emails.
  expect(JSON.stringify(view)).not.toMatch(/\+4479|ana@example|luca@example/i);

  expect(await t.query(api.events.getSubmittedView, { slug, participantToken: "not-a-real-token" })).toBeNull();
  expect(await t.query(api.events.getSubmittedView, { slug: "no-such-event", participantToken: token })).toBeNull();
  await owner.mutation(api.events.createEvent, {
    expectedOrganizationId: organizationId,
    name: "Other",
    slug: "other-night",
    eventType: "demo",
    meetUrl: "https://meet.google.com/example",
  });
  expect(await t.query(api.events.getSubmittedView, { slug: "other-night", participantToken: token })).toBeNull();

  configure();
  expect((await t.query(api.events.getSubmittedView, { slug, participantToken: token }))?.emailConfigured).toBe(true);
});
