import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createEvent, setupTest, type TestClient } from "./behaviour.testing";
import { PUBLIC_FORM_LIMITS, SUBMIT_AGAIN_CLOSED_MESSAGE, SUBMIT_AGAIN_TAKEN_MESSAGE, SUBMIT_EMAIL_LIMITED_MESSAGE } from "./events";

// Frozen time keeps the rate limit buckets from refilling.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T18:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

let counter = 0;
const browser = () => `test-browser-again-${String((counter += 1)).padStart(6, "0")}`;

async function submit(t: TestClient, slug: string, email: string, teammate?: string) {
  const participantToken = `participant-again-${(counter += 1)}`;
  const result = await t.mutation(api.events.submitHackathon, {
    slug, participantToken, clientId: browser(), name: "Ana Ruiz", teamName: `Team ${counter}`, teamMembers: teammate ? ["Luca Romano"] : [],
    ...(teammate ? { teamMemberContacts: [{ name: "Luca Romano", email: teammate, whatsappPhone: "+44 20 7946 0456" }] } : {}),
    demoTitle: `Guardrail ${counter}`, description: "Policy checks for agent tool calls.", phone: "+44 20 7946 0123", email,
    githubUrl: "https://github.com/jqlang/jq", rulesAccepted: true, videoUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  }) as { submissionId: Id<"submissions"> };
  return { submissionId: result.submissionId, participantToken };
}

const again = (t: TestClient, slug: string, participantToken: string) =>
  t.mutation(api.events.resubmitWithdrawnSubmission, { slug, participantToken, clientId: browser() });

const row = (t: TestClient, id: Id<"submissions">) => t.run((ctx) => ctx.db.get(id));

test("Submit again brings back the same entry with its details and status link, only with its participant token, and tells the organiser", async () => {
  const { t } = setupTest();
  const { slug } = await createEvent(t);
  const entry = await submit(t, slug, "ana@example.com", "luca@example.com");
  const before = (await row(t, entry.submissionId))!;
  await t.mutation(api.events.withdrawSubmission, { slug, participantToken: entry.participantToken });
  expect((await row(t, entry.submissionId))!).toMatchObject({ status: "withdrawn", normalizedEmail: "" });

  // Another token, or another event's, never brings it back.
  await expect(again(t, slug, "participant-someone-else")).rejects.toThrow("Submission not found");
  expect((await row(t, entry.submissionId))!.status).toBe("withdrawn");

  expect(await again(t, slug, entry.participantToken)).toEqual({ restored: true });
  const after = (await row(t, entry.submissionId))!;
  expect(after).toMatchObject({
    status: "candidate", participantToken: before.participantToken, demoTitle: before.demoTitle, description: before.description,
    githubUrl: before.githubUrl, videoUrl: before.videoUrl, email: "ana@example.com", normalizedEmail: "ana@example.com",
  });
  const member = await t.run((ctx) => ctx.db.query("teamMembers").withIndex("by_submission", (q) => q.eq("submissionId", entry.submissionId)).unique());
  expect(member).toMatchObject({ normalizedEmail: "luca@example.com" });
  // The same status link works and shows it as submitted.
  expect((await t.query(api.events.getParticipant, { slug, participantToken: entry.participantToken })).submission.status).toBe("candidate");

  const [change] = (await t.query(api.changes.listRecentChanges, { slug })).changes;
  expect(change).toMatchObject({ via: "participant", kind: "submission_resubmitted", summary: `submitted ${before.demoTitle} again after withdrawing it`, canUndo: false, isYou: false });
});

test("Submit again works only while submissions are open", async () => {
  const { t } = setupTest();
  const { slug, eventId } = await createEvent(t);
  const entry = await submit(t, slug, "ana@example.com");
  await t.mutation(api.events.withdrawSubmission, { slug, participantToken: entry.participantToken });
  await t.run((ctx) => ctx.db.patch(eventId, { submissionsClosedAt: Date.now() }));
  await expect(again(t, slug, entry.participantToken)).rejects.toThrow(SUBMIT_AGAIN_CLOSED_MESSAGE);
  expect((await row(t, entry.submissionId))!.status).toBe("withdrawn");
});

test("Submit again on an entry that is not withdrawn does nothing", async () => {
  const { t } = setupTest();
  const { slug } = await createEvent(t);
  const entry = await submit(t, slug, "ana@example.com");
  const before = (await row(t, entry.submissionId))!;
  expect(await again(t, slug, entry.participantToken)).toEqual({ restored: false, reason: "not_withdrawn" });
  expect(await row(t, entry.submissionId)).toEqual(before);
  expect((await t.query(api.changes.listRecentChanges, { slug })).changes).toHaveLength(0);
});

test("the submit limits still apply to withdraw and Submit again rounds", async () => {
  const { t } = setupTest();
  const { slug } = await createEvent(t);
  const entry = await submit(t, slug, "cycle@example.com");
  // The first submit spent one of the email's tokens; each Submit again spends another.
  for (let round = 1; round < PUBLIC_FORM_LIMITS.submitPerEmail.capacity; round++) {
    await t.mutation(api.events.withdrawSubmission, { slug, participantToken: entry.participantToken });
    expect(await again(t, slug, entry.participantToken)).toEqual({ restored: true });
  }
  await t.mutation(api.events.withdrawSubmission, { slug, participantToken: entry.participantToken });
  await expect(again(t, slug, entry.participantToken)).rejects.toThrow(SUBMIT_EMAIL_LIMITED_MESSAGE);
  expect((await row(t, entry.submissionId))!.status).toBe("withdrawn");
});

test("a newer entry with the same email blocks Submit again and links to it; another person's entry is named without a link", async () => {
  const { t } = setupTest();
  // Same person: they submitted a new entry, so link to its status page instead.
  const { slug } = await createEvent(t);
  const first = await submit(t, slug, "ana@example.com");
  await t.mutation(api.events.withdrawSubmission, { slug, participantToken: first.participantToken });
  const newer = await submit(t, slug, "Ana@Example.com");
  expect(await again(t, slug, first.participantToken)).toEqual({ restored: false, reason: "email_taken", message: SUBMIT_AGAIN_TAKEN_MESSAGE, statusPath: `/s/${slug}/${newer.participantToken}` });
  expect((await row(t, first.submissionId))!.status).toBe("withdrawn");

  // A teammate submitted on their own: say so, with no link to their entry.
  const other = await createEvent(t, { slug: "hack-two" });
  const team = await submit(t, other.slug, "ana@example.com", "luca@example.com");
  await t.mutation(api.events.withdrawSubmission, { slug: other.slug, participantToken: team.participantToken });
  await submit(t, other.slug, "luca@example.com");
  expect(await again(t, other.slug, team.participantToken)).toEqual({ restored: false, reason: "email_taken", message: SUBMIT_AGAIN_TAKEN_MESSAGE, statusPath: null });
  expect((await row(t, team.submissionId))!.status).toBe("withdrawn");
});
