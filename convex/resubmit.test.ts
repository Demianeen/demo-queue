import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createEvent, setupTest, type TestClient } from "./behaviour.testing";
import {
  PUBLIC_FORM_LIMITS, SUBMIT_AGAIN_CLOSED_MESSAGE, SUBMIT_AGAIN_NOT_ALLOWED_MESSAGE, SUBMIT_AGAIN_TAKEN_MESSAGE, SUBMIT_EMAIL_LIMITED_MESSAGE,
  WITHDRAW_ACTED_ON_MESSAGE, WITHDRAW_HIDDEN_MESSAGE,
} from "./events";

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

const statusEmails = (t: TestClient) =>
  t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect())
    .filter((row) => row.name.includes("sendStatusLinkEmail") && (row.args[0] as { reason: string }).reason === "resend")
    .map((row) => row.args[0] as { submissionId: string; to: string }));

test("an email clash never returns another entry's link or token; that entry's status link is emailed to the address on file", async () => {
  const { t } = setupTest();
  // Same person: they submitted a new entry meanwhile.
  const { slug } = await createEvent(t);
  const first = await submit(t, slug, "ana@example.com");
  await t.mutation(api.events.withdrawSubmission, { slug, participantToken: first.participantToken });
  const newer = await submit(t, slug, "Ana@Example.com");
  // Past the two minutes after its own confirmation email.
  vi.setSystemTime(Date.now() + 3 * 60_000);
  const result = await again(t, slug, first.participantToken);
  expect(result).toEqual({ restored: false, reason: "email_taken", message: SUBMIT_AGAIN_TAKEN_MESSAGE });
  expect(JSON.stringify(result)).not.toContain(newer.participantToken);
  expect(JSON.stringify(result)).not.toContain("/s/");
  expect(await statusEmails(t)).toEqual([{ submissionId: newer.submissionId, to: "Ana@Example.com", reason: "resend" }]);
  expect((await row(t, first.submissionId))!.status).toBe("withdrawn");

  // The attack: a withdrawn entry's email changed to someone else's. Their link goes only to them.
  const other = await createEvent(t, { slug: "hack-two" });
  const victim = await submit(t, other.slug, "victim@example.com");
  const attacker = await submit(t, other.slug, "attacker@example.com");
  await t.mutation(api.events.withdrawSubmission, { slug: other.slug, participantToken: attacker.participantToken });
  await t.run((ctx) => ctx.db.patch(attacker.submissionId, { email: "victim@example.com" }));
  vi.setSystemTime(Date.now() + 3 * 60_000);
  const stolen = await again(t, other.slug, attacker.participantToken);
  expect(stolen).toEqual({ restored: false, reason: "email_taken", message: SUBMIT_AGAIN_TAKEN_MESSAGE });
  expect(JSON.stringify(stolen)).not.toContain(victim.participantToken);
  const sent = (await statusEmails(t)).filter((email) => email.submissionId === victim.submissionId);
  expect(sent).toEqual([{ submissionId: victim.submissionId, to: "victim@example.com", reason: "resend" }]);
  expect((await statusEmails(t)).some((email) => email.to === "attacker@example.com")).toBe(false);
});

test("a hidden entry can't be withdrawn, so it can't be brought back either", async () => {
  const { t } = setupTest();
  const { slug } = await createEvent(t);
  const entry = await submit(t, slug, "ana@example.com");
  await t.mutation(api.events.hideSubmission, { slug, submissionId: entry.submissionId });
  await expect(t.mutation(api.events.withdrawSubmission, { slug, participantToken: entry.participantToken })).rejects.toThrow(WITHDRAW_HIDDEN_MESSAGE);
  expect(await again(t, slug, entry.participantToken)).toEqual({ restored: false, reason: "not_withdrawn" });
  expect((await row(t, entry.submissionId))!.status).toBe("hidden");
  for (const status of ["done", "no_show", "current", "up_next"] as const) {
    await t.run((ctx) => ctx.db.patch(entry.submissionId, { status }));
    await expect(t.mutation(api.events.withdrawSubmission, { slug, participantToken: entry.participantToken })).rejects.toThrow(WITHDRAW_ACTED_ON_MESSAGE);
  }
});

test("a queued entry comes back queued, at the end of the lineup", async () => {
  const { t } = setupTest();
  const { slug } = await createEvent(t);
  const entry = await submit(t, slug, "ana@example.com");
  const other = await submit(t, slug, "sam@example.com");
  await t.run(async (ctx) => {
    await ctx.db.patch(entry.submissionId, { status: "queued", queueOrder: 1 });
    await ctx.db.patch(other.submissionId, { status: "queued", queueOrder: 2 });
  });
  await t.mutation(api.events.withdrawSubmission, { slug, participantToken: entry.participantToken });
  expect((await row(t, entry.submissionId))!).toMatchObject({ status: "withdrawn", withdrawnFromStatus: "queued", withdrawnBy: "participant" });
  expect(await again(t, slug, entry.participantToken)).toEqual({ restored: true });
  const back = (await row(t, entry.submissionId))!;
  expect(back).toMatchObject({ status: "queued", queueOrder: 3 });
  expect(back.withdrawnFromStatus).toBeUndefined();
  expect(back.withdrawnBy).toBeUndefined();
});

test("an entry the team did not withdraw themselves can't be brought back by them", async () => {
  const { t } = setupTest();
  const { slug } = await createEvent(t);
  const entry = await submit(t, slug, "ana@example.com");
  await t.run((ctx) => ctx.db.patch(entry.submissionId, { status: "withdrawn", withdrawnBy: "organiser", withdrawnFromStatus: "candidate", normalizedEmail: "" }));
  await expect(again(t, slug, entry.participantToken)).rejects.toThrow(SUBMIT_AGAIN_NOT_ALLOWED_MESSAGE);
  // An older withdraw, from before the record, is refused too.
  await t.run((ctx) => ctx.db.patch(entry.submissionId, { withdrawnBy: undefined, withdrawnFromStatus: undefined }));
  await expect(again(t, slug, entry.participantToken)).rejects.toThrow(SUBMIT_AGAIN_NOT_ALLOWED_MESSAGE);
  expect((await row(t, entry.submissionId))!.status).toBe("withdrawn");
  const page = await t.query(api.events.getParticipant, { slug, participantToken: entry.participantToken });
  expect(page.submission).toMatchObject({ canWithdraw: false, canSubmitAgain: false });
});

test("an organiser's Restore still works on a withdrawn entry, and its Undo puts the team's withdraw back", async () => {
  const { t } = setupTest();
  const { slug } = await createEvent(t);
  const entry = await submit(t, slug, "ana@example.com");
  await t.mutation(api.events.withdrawSubmission, { slug, participantToken: entry.participantToken });
  await t.mutation(api.events.restoreSubmission, { slug, submissionId: entry.submissionId });
  const restored = (await row(t, entry.submissionId))!;
  expect(restored).toMatchObject({ status: "candidate", normalizedEmail: "ana@example.com" });
  expect(restored.withdrawnBy).toBeUndefined();
  const [change] = (await t.query(api.changes.listRecentChanges, { slug })).changes;
  await t.mutation(api.changes.undoChange, { slug, changeId: change.id });
  expect((await row(t, entry.submissionId))!).toMatchObject({ status: "withdrawn", withdrawnBy: "participant", withdrawnFromStatus: "candidate" });
  expect(await again(t, slug, entry.participantToken)).toEqual({ restored: true });
});
