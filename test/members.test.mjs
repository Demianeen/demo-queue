import assert from "node:assert/strict";
import test from "node:test";
import { checkInviteEmails, initials, invitationStatus, openInvitations, shortDate, splitEmails } from "../lib/members.ts";

test("pasted emails split on commas, semicolons and spaces and are lowercased", () => {
  assert.deepEqual(splitEmails(" Ana@Example.com, luca@example.com;\nmia@example.com  "), ["ana@example.com", "luca@example.com", "mia@example.com"]);
  assert.deepEqual(splitEmails(" , ; "), []);
});

test("invite emails are flagged when invalid, already members, already invited or repeated", () => {
  const checked = checkInviteEmails(["ana@example.com", "luca@example.com", "nope", "tom@example.com", "ANA@example.com"], { memberEmails: ["Luca@example.com"], invitedEmails: ["tom@example.com"] });
  assert.deepEqual(checked.map((entry) => entry.problem ?? "ok"), ["ok", "member", "invalid", "invited", "duplicate"]);
  for (const bad of ["a@b", "a b@example.com", "@example.com", "a@example.com,", `${"a".repeat(250)}@example.com`]) assert.equal(checkInviteEmails([bad], { memberEmails: [], invitedEmails: [] })[0].problem, "invalid");
});

test("open invitations keep the newest per email, drop members and mark lapsed ones expired", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  const row = (id, email, state, createdAt, expiresAt) => ({ id, email, state, createdAt, expiresAt, inviterUserId: null });
  const open = openInvitations([
    row("1", "priya@example.com", "expired", "2026-10-10T00:00:00Z", "2026-10-17T00:00:00Z"),
    row("2", "priya@example.com", "pending", "2026-10-29T10:00:00Z", "2026-11-05T10:00:00Z"),
    row("3", "tom@example.com", "pending", "2026-10-20T00:00:00Z", "2026-10-27T00:00:00Z"),
    row("4", "luca@example.com", "pending", "2026-10-28T00:00:00Z", "2026-11-04T00:00:00Z"),
    row("5", "gone@example.com", "revoked", "2026-10-28T00:00:00Z", "2026-11-04T00:00:00Z"),
    row("6", "in@example.com", "accepted", "2026-10-28T00:00:00Z", "2026-11-04T00:00:00Z"),
  ], ["luca@example.com"], now);
  assert.deepEqual(open.map((entry) => [entry.id, entry.expired]), [["2", false], ["3", true]]);
  assert.equal(invitationStatus(open[0], now), "Expires in 7 days");
  assert.equal(invitationStatus(open[1], now), "Expired");
  assert.equal(invitationStatus({ expired: false, expiresAt: "2026-10-29T20:00:00Z" }, now), "Expires today");
});

test("names show as initials and dates read as today, a day or a dated year", () => {
  assert.equal(initials("Luca Romano", "luca@example.com"), "LR");
  assert.equal(initials("Sean", "sean@example.com"), "SE");
  assert.equal(initials("", "mia@example.com"), "MI");
  const now = Date.parse("2026-10-29T12:00:00Z");
  assert.equal(shortDate("2026-10-29T10:12:00Z", now, "UTC"), "today, 10:12");
  assert.equal(shortDate("2026-10-24T10:12:00Z", now, "UTC"), "24 Oct");
  assert.equal(shortDate("2025-10-24T10:12:00Z", now, "UTC"), "24 Oct 2025");
});
