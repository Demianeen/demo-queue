import { convexTest } from "convex-test";
import { expect, test } from "vitest";
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

const organizationId = "org_outpost";
const identity = { subject: "user_operator", issuer: "https://api.workos.com/user_management/client_test", org_id: organizationId };
const TAKEN = "You already submitted with this email. Check your inbox for your status link.";

async function fixture(eventType: "demo" | "hackathon") {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity(identity);
  const slug = `${eventType}-night`;
  await owner.mutation(api.events.createEvent, {
    expectedOrganizationId: organizationId,
    name: "Night",
    slug,
    eventType,
    meetUrl: "https://meet.google.com/example",
  });
  return { t, owner, slug };
}

let counter = 0;
function token() {
  counter += 1;
  return `participant-${counter}`;
}

function submitDemo(t: ReturnType<typeof convexTest>, slug: string, email: string, extra: Record<string, string> = {}) {
  const participantToken = token();
  return t
    .mutation(api.events.submitDemo, {
      slug,
      participantToken,
      name: "Participant",
      demoTitle: `Demo ${counter}`,
      description: "A working demonstration",
      phone: "+447911123456",
      email,
      queueOrder: counter,
      ...extra,
    })
    .then((result) => ({ ...result, participantToken }));
}

type Member = { name: string; email: string; whatsappPhone: string; twitter?: string; linkedin?: string; githubProfile?: string };
function submitTeam(t: ReturnType<typeof convexTest>, slug: string, presenterEmail: string, members: Member[], extra: Record<string, string> = {}) {
  return t.mutation(api.events.submitHackathon, {
    slug,
    participantToken: token(),
    name: "Presenter",
    teamName: `Team ${counter}`,
    teamMembers: members.map((member) => member.name),
    teamMemberContacts: members,
    demoTitle: `Project ${counter}`,
    description: "A working project",
    phone: "+447911123400",
    email: presenterEmail,
    githubUrl: "https://github.com/team/project",
    rulesAccepted: true,
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ...extra,
  });
}

const member = (email: string, extra: Partial<Member> = {}): Member => ({
  name: `Member ${email.split("@")[0]}`,
  email,
  whatsappPhone: "+447911123401",
  ...extra,
});

test("a demo email can submit once per event, ignoring case and spaces", async () => {
  const { t, owner, slug } = await fixture("demo");
  await submitDemo(t, slug, "Ada@Example.com");
  await expect(submitDemo(t, slug, "  ada@EXAMPLE.com ")).rejects.toThrow(TAKEN);

  expect(await t.query(api.events.checkSubmissionEmail, { slug, email: "ADA@example.com" })).toEqual({ taken: true });
  expect(await t.query(api.events.checkSubmissionEmail, { slug, email: "grace@example.com" })).toEqual({ taken: false });
  expect(await t.query(api.events.checkSubmissionEmail, { slug: "no-such-event", email: "ada@example.com" })).toEqual({ taken: false });

  // Another event of the same organization is separate.
  await owner.mutation(api.events.createEvent, {
    expectedOrganizationId: organizationId,
    name: "Other",
    slug: "other-night",
    eventType: "demo",
    meetUrl: "https://meet.google.com/example",
  });
  await expect(submitDemo(t, "other-night", "ada@example.com")).resolves.toHaveProperty("submissionId");
});

test("hackathon emails are unique across presenters and team members", async () => {
  const { t, slug } = await fixture("hackathon");
  await submitTeam(t, slug, "lead@example.com", [member("mate@example.com")]);

  // A team member of one submission cannot present another, and the reverse.
  await expect(submitTeam(t, slug, "MATE@example.com", [])).rejects.toThrow(TAKEN);
  await expect(submitTeam(t, slug, "new@example.com", [member("Lead@Example.com")])).rejects.toThrow(TAKEN);
  // One submission cannot list the same person twice.
  await expect(submitTeam(t, slug, "solo@example.com", [member("SOLO@example.com")])).rejects.toThrow(
    "Each person needs a different email.",
  );
  expect(await t.query(api.events.checkSubmissionEmail, { slug, email: "mate@EXAMPLE.com" })).toEqual({ taken: true });
  expect(await t.run((ctx) => ctx.db.query("submissions").collect())).toHaveLength(1);
});

test("a withdrawn submission frees its emails", async () => {
  const { t, slug } = await fixture("hackathon");
  const { submissionId } = await submitTeam(t, slug, "lead@example.com", [member("mate@example.com")]);
  await t.run((ctx) => ctx.db.patch(submissionId, { status: "withdrawn" }));
  expect(await t.query(api.events.checkSubmissionEmail, { slug, email: "mate@example.com" })).toEqual({ taken: false });
  await expect(submitTeam(t, slug, "mate@example.com", [member("lead@example.com")])).resolves.toHaveProperty("submissionId");
});

test("socials are saved per person and checked on the server", async () => {
  const { t, owner, slug } = await fixture("hackathon");
  const { submissionId } = await submitTeam(
    t,
    slug,
    "lead@example.com",
    [member("mate@example.com", { twitter: "@mate", linkedin: "linkedin.com/in/mate", githubProfile: "mate-dev" })],
    { githubProfile: "@lead-dev" },
  );
  const saved = await t.run((ctx) => ctx.db.get(submissionId));
  expect(saved?.githubProfile).toBe("@lead-dev");
  const [teammate] = await t.run((ctx) =>
    ctx.db.query("teamMembers").withIndex("by_submission", (q) => q.eq("submissionId", submissionId)).collect(),
  );
  expect(teammate).toMatchObject({ twitter: "@mate", linkedin: "linkedin.com/in/mate", githubProfile: "mate-dev" });

  const admin = await owner.query(api.events.getAdmin, { slug });
  const row = [...admin.pool, ...admin.lineup].find((item) => item.id === submissionId);
  expect(row?.githubProfile).toBe("@lead-dev");
  expect(row?.teamMemberContacts[0]).toMatchObject({ githubProfile: "mate-dev", twitter: "@mate" });

  await expect(submitTeam(t, slug, "x@example.com", [], { githubProfile: "not a username!" })).rejects.toThrow(
    "Enter a GitHub username or github.com link.",
  );
  await expect(
    submitTeam(t, slug, "y@example.com", [member("z@example.com", { linkedin: "https://example.com/me" })]),
  ).rejects.toThrow("linkedin.com");
});

test("the status page cannot change its email to one another submission uses", async () => {
  const { t, slug } = await fixture("demo");
  await submitDemo(t, slug, "first@example.com");
  const second = await submitDemo(t, slug, "second@example.com");
  const edit = (email: string) =>
    t.mutation(api.events.editParticipantContact, { slug, participantToken: second.participantToken, phone: "+447911123456", email });
  await expect(edit("First@example.com")).rejects.toThrow(TAKEN);
  await expect(edit("SECOND@example.com")).resolves.toBeNull();
});

test("emailing the link again answers the same for unknown emails and is throttled", async () => {
  const { t, slug } = await fixture("demo");
  const { submissionId } = await submitDemo(t, slug, "ada@example.com");
  const scheduled = () =>
    t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name.startsWith("emails")));

  expect(await t.mutation(api.events.requestStatusLinkEmail, { slug, email: "nobody@example.com" })).toEqual({ ok: true });
  expect(await scheduled()).toHaveLength(0);

  expect(await t.mutation(api.events.requestStatusLinkEmail, { slug, email: "ADA@example.com" })).toEqual({ ok: true });
  expect(await t.mutation(api.events.requestStatusLinkEmail, { slug, email: "ada@example.com" })).toEqual({ ok: true });
  const jobs = await scheduled();
  expect(jobs).toHaveLength(1);
  expect(jobs[0].args[0]).toMatchObject({ submissionId, reason: "resend", to: "ada@example.com" });

  // After the wait, another send goes out.
  await t.run((ctx) => ctx.db.patch(submissionId, { statusLinkEmailedAt: Date.now() - 3 * 60 * 1000 }));
  await t.mutation(api.events.requestStatusLinkEmail, { slug, email: "ada@example.com" });
  expect(await scheduled()).toHaveLength(2);
});
