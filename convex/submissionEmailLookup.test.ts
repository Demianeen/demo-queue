import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./events.ts": () => import("./events"),
  "./emails.ts": () => import("./emails"),
  "./judging.ts": () => import("./judging"),
  "./tracks.ts": () => import("./tracks"),
  "./migrations.ts": () => import("./migrations"),
  "./judgingSheetSync.ts": () => import("./judgingSheetSync"),
  "./googleSheets.ts": () => import("./googleSheets"),
};

const organizationId = "org_outpost";
const identity = { subject: "user_operator", issuer: "https://api.workos.com/user_management/client_test", org_id: organizationId };


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
function submitDemo(t: ReturnType<typeof convexTest>, slug: string, email: string) {
  const participantToken = token();
  return t
    .mutation(api.events.submitDemo, {
      slug, participantToken, name: "Participant", demoTitle: `Demo ${counter}`, description: "A working demonstration",
      phone: "+447911123456", email, queueOrder: counter,
    })
    .then((result) => ({ ...result, participantToken }));
}

const TAKEN = "You already submitted with this email. Check your inbox for your status link.";
const RESTORE_TAKEN = "Another submission in this event now uses an email from this one. Change that email first.";
type T = ReturnType<typeof convexTest>;
type Status = "candidate" | "queued" | "hidden" | "withdrawn";
type Seed = { email: string; normalizedEmail?: string; status?: Status };

/** Writes rows straight into the tables, the way older code or a busy event leaves them. */
async function seed(t: T, slug: string, rows: Seed[], members: Seed[] = []) {
  return t.run(async (ctx) => {
    const event = (await ctx.db.query("events").collect()).find((row) => row.slug === slug)!;
    const now = Date.now();
    let submissionId;
    for (const [index, row] of rows.entries()) {
      submissionId = await ctx.db.insert("submissions", {
        eventId: event._id, participantToken: `seed-${slug}-${index}`, name: "Seed", demoTitle: `Seed ${index}`, description: "Seed",
        phone: "+447911123456", status: "candidate", createdAt: now, updatedAt: now, ...row,
      });
    }
    for (const member of members) {
      const key = member.normalizedEmail === undefined ? {} : { normalizedEmail: member.normalizedEmail };
      await ctx.db.insert("teamMembers", { eventId: event._id, submissionId: submissionId!, name: "Member", createdAt: now, email: member.email, ...key });
    }
    return submissionId!;
  });
}

const filler = (count: number): Seed[] =>
  Array.from({ length: count }, (_, index) => ({ email: `filler-${index}@example.com`, normalizedEmail: `filler-${index}@example.com` }));

async function row(t: T, participantToken: string) {
  return t.run(async (ctx) => (await ctx.db.query("submissions").collect()).find((submission) => submission.participantToken === participantToken)!);
}

const taken = (t: T, slug: string, email: string) => t.query(api.events.checkSubmissionEmail, { slug, email });

test("a duplicate is caught however many submissions the event holds, and nothing caps the event", async () => {
  const { t, owner, slug } = await fixture("demo");
  // The old scan read the first 1000 rows only; this email sits after them.
  await seed(t, slug, [...filler(1000), { email: "Ada@Example.com", normalizedEmail: "ada@example.com" }]);
  await expect(submitDemo(t, slug, "ada@example.com")).rejects.toThrow(TAKEN);
  expect(await taken(t, slug, "ADA@example.com")).toEqual({ taken: true });
  await expect(submitDemo(t, slug, "grace@example.com")).resolves.toBeTruthy();
  await expect(
    owner.mutation(api.events.adminAddTestSubmissions, { slug, submissions: [{ participantToken: token(), name: "Test", demoTitle: "Test", description: "Test", phone: "+447911123456" }] }),
  ).resolves.toBeTruthy();
});

test("withdrawing frees the email for a new submission, and only the active row holds it", async () => {
  const { t, slug } = await fixture("demo");
  const first = await submitDemo(t, slug, "ada@example.com");
  await t.mutation(api.events.withdrawSubmission, { slug, participantToken: first.participantToken });
  expect((await row(t, first.participantToken)).normalizedEmail).toBe("");
  expect(await taken(t, slug, "ada@example.com")).toEqual({ taken: false });
  const second = await submitDemo(t, slug, "ada@example.com");
  expect((await row(t, second.participantToken)).normalizedEmail).toBe("ada@example.com");
  // Many withdraw and resubmit rounds leave one row with the key, so lookups stay two-row reads.
  const holders = await t.run(async (ctx) =>
    (await ctx.db.query("submissions").collect()).filter((submission) => submission.normalizedEmail === "ada@example.com"),
  );
  expect(holders).toHaveLength(1);
});

test("hiding frees a team's emails; restoring checks them again", async () => {
  const { t, owner, slug } = await fixture("hackathon");
  const team = await t.mutation(api.events.submitHackathon, {
    slug, participantToken: token(), name: "Presenter", teamName: "Team", teamMembers: ["Mate"],
    teamMemberContacts: [{ name: "Mate", email: "mate@example.com", whatsappPhone: "+447911123401" }],
    demoTitle: "Project", description: "A working project", phone: "+447911123400", email: "lead@example.com",
    githubUrl: "https://github.com/team/project", rulesAccepted: true, videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  await owner.mutation(api.events.hideSubmission, { slug, submissionId: team.submissionId });
  expect(await taken(t, slug, "mate@example.com")).toEqual({ taken: false });
  // While hidden, someone else submits with the team member's email.
  const other = await t.mutation(api.events.submitHackathon, {
    slug, participantToken: token(), name: "Mate", teamName: "Solo", teamMembers: [], teamMemberContacts: [],
    demoTitle: "Solo", description: "A working project", phone: "+447911123401", email: "Mate@example.com",
    githubUrl: "https://github.com/solo/project", rulesAccepted: true, videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  await expect(owner.mutation(api.events.restoreSubmission, { slug, submissionId: team.submissionId })).rejects.toThrow(RESTORE_TAKEN);
  await expect(owner.mutation(api.events.moveToPool, { slug, submissionId: team.submissionId })).rejects.toThrow(RESTORE_TAKEN);
  await expect(owner.mutation(api.events.reorderLineup, { slug, orderedIds: [team.submissionId] })).rejects.toThrow(RESTORE_TAKEN);
  await owner.mutation(api.events.hideSubmission, { slug, submissionId: other.submissionId });
  await owner.mutation(api.events.restoreSubmission, { slug, submissionId: team.submissionId });
  expect(await taken(t, slug, "mate@example.com")).toEqual({ taken: true });
  expect(await taken(t, slug, "lead@example.com")).toEqual({ taken: true });
});

test("organiser edits and adds refuse an email another submission uses", async () => {
  const { t, owner, slug } = await fixture("demo");
  await submitDemo(t, slug, "ada@example.com");
  const second = await submitDemo(t, slug, "grace@example.com");
  const { _id: submissionId } = await row(t, second.participantToken);
  const edit = (email: string) =>
    owner.mutation(api.events.updateSubmission, { slug, submissionId, name: "Grace", demoTitle: "Demo", description: "A demo", phone: "+447911123456", email });
  await expect(edit("ADA@example.com")).rejects.toThrow(TAKEN);
  expect((await row(t, second.participantToken)).email).toBe("grace@example.com");
  await edit("Grace.Hopper@example.com");
  expect((await row(t, second.participantToken)).normalizedEmail).toBe("grace.hopper@example.com");
  expect(await taken(t, slug, "grace@example.com")).toEqual({ taken: false });
  await expect(
    owner.mutation(api.events.adminAddSubmission, { slug, participantToken: token(), name: "Admin", demoTitle: "Admin", description: "Admin", phone: "+447911123456", email: "ada@example.com", queueOrder: 1 }),
  ).rejects.toThrow(TAKEN);
  const test = (email: string) => ({ participantToken: token(), name: "Test", demoTitle: "Test", description: "Test", phone: "+447911123456", email });
  await expect(
    owner.mutation(api.events.adminAddTestSubmissions, { slug, submissions: [test("same@example.com"), test("Same@example.com")] }),
  ).rejects.toThrow(TAKEN);
});

test("the participant cannot edit their email to one already taken", async () => {
  const { t, slug } = await fixture("demo");
  await submitDemo(t, slug, "ada@example.com");
  const second = await submitDemo(t, slug, "grace@example.com");
  await expect(
    t.mutation(api.events.editParticipantContact, { slug, participantToken: second.participantToken, phone: "+447911123456", email: " Ada@Example.com" }),
  ).rejects.toThrow(TAKEN);
  await t.mutation(api.events.editParticipantContact, { slug, participantToken: second.participantToken, phone: "+447911123456", email: "Renamed@example.com" });
  expect(await taken(t, slug, "grace@example.com")).toEqual({ taken: false });
  expect(await taken(t, slug, "renamed@example.com")).toEqual({ taken: true });
});

test("the lookup reads at most two rows per table and logs when the invariant is broken", async () => {
  const { t, slug } = await fixture("demo");
  // Broken data: three active rows hold one key. Only two are read, and that is logged.
  await seed(t, slug, [1, 2, 3].map(() => ({ email: "dup@example.com", normalizedEmail: "dup@example.com" })));
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await taken(t, slug, "dup@example.com")).toEqual({ taken: true });
    expect(log).toHaveBeenCalledWith("Email lookup found more than one row holding one email", expect.objectContaining({ rows: expect.any(Array) }));
    expect((log.mock.calls[0][1] as { rows: unknown[] }).rows).toHaveLength(2);
  } finally {
    log.mockRestore();
  }
});

test("rows from before the lookup key are still matched, then backfilled without other changes", async () => {
  const { t, slug } = await fixture("hackathon");
  await seed(t, slug, [{ email: "gone@example.com", status: "withdrawn" }, { email: "hid@example.com", status: "hidden" }]);
  await seed(t, slug, [{ email: " Old@Example.com " }], [{ email: "Mate@Example.com" }]);
  expect(await taken(t, slug, "old@example.com")).toEqual({ taken: true });
  expect(await taken(t, slug, "mate@example.com")).toEqual({ taken: true });
  expect(await taken(t, slug, "hid@example.com")).toEqual({ taken: false });
  const before = await t.run(async (ctx) => [...(await ctx.db.query("submissions").collect()), ...(await ctx.db.query("teamMembers").collect())]);
  expect(await t.action(internal.migrations.backfillNormalizedEmails, {})).toEqual({ submissions: 3, teamMembers: 1 });
  const after = await t.run(async (ctx) => [...(await ctx.db.query("submissions").collect()), ...(await ctx.db.query("teamMembers").collect())]);
  expect(after.map((doc) => doc.normalizedEmail)).toEqual(["", "", "old@example.com", "mate@example.com"]);
  // Only the key was added: every other field is unchanged and nothing was deleted.
  expect(after.map((doc) => ({ ...doc, normalizedEmail: undefined }))).toEqual(before);
  expect(await taken(t, slug, "MATE@example.com")).toEqual({ taken: true });
  expect(await t.action(internal.migrations.backfillNormalizedEmails, {})).toEqual({ submissions: 0, teamMembers: 0 });
});

test("once submissions close, the form refuses and the instant check says nothing", async () => {
  const { t, slug } = await fixture("demo");
  await submitDemo(t, slug, "ada@example.com");
  expect(await taken(t, slug, "ada@example.com")).toEqual({ taken: true });
  await t.run(async (ctx) => {
    const event = (await ctx.db.query("events").collect()).find((candidate) => candidate.slug === slug)!;
    await ctx.db.patch(event._id, { submissionsClosedAt: Date.now() });
  });
  await expect(submitDemo(t, slug, "late@example.com")).rejects.toThrow("Submissions are closed.");
  expect(await taken(t, slug, "ada@example.com")).toEqual({ taken: false });
});
