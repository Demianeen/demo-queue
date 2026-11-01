// Members and invitations: rules shared by the Members page (Next server
// actions) and the MCP tools (Convex), so both check emails the same way.

export const MAX_INVITES_PER_REQUEST = 20;
export const INVITATION_EXPIRES_IN_DAYS = 7;
const MAX_EMAIL_LENGTH = 254;
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string) {
  return value.length <= MAX_EMAIL_LENGTH && /^[^\s@,;<>()[\]"]+@[^\s@,;<>()[\]"]+\.[^\s@,;<>()[\]"]+$/.test(value);
}

/** Splits pasted or typed text on commas, semicolons and whitespace. */
export function splitEmails(text: string) {
  return text.split(/[\s,;]+/).map(normalizeEmail).filter(Boolean);
}

export type InviteProblem = "invalid" | "member" | "invited" | "duplicate";

export const INVITE_PROBLEM_MESSAGES: Record<InviteProblem, (email: string) => string> = {
  invalid: (email) => `${email} is not a valid email address.`,
  member: (email) => `${email} is already a member.`,
  invited: (email) => `${email} already has a pending invitation.`,
  duplicate: (email) => `${email} is listed twice.`,
};

/**
 * Checks each email against the organization's members and pending
 * invitations. The first copy of a repeated email is checked normally and
 * later copies are flagged as duplicates.
 */
export function checkInviteEmails(emails: string[], known: { memberEmails: Iterable<string>; invitedEmails: Iterable<string> }) {
  const members = new Set([...known.memberEmails].map(normalizeEmail));
  const invited = new Set([...known.invitedEmails].map(normalizeEmail));
  const seen = new Set<string>();
  return emails.map((raw) => {
    const email = normalizeEmail(raw);
    let problem: InviteProblem | undefined;
    if (seen.has(email)) problem = "duplicate";
    else if (!isValidEmail(email)) problem = "invalid";
    else if (members.has(email)) problem = "member";
    else if (invited.has(email)) problem = "invited";
    seen.add(email);
    return { email, problem };
  });
}

export type InvitationState = "pending" | "accepted" | "expired" | "revoked";
export type InvitationRecord = { id: string; email: string; state: InvitationState; expiresAt: string; createdAt: string; inviterUserId: string | null };

/**
 * Invitations to show: pending or expired, newest per email, and never for
 * someone who is already a member. A pending invitation past its expiry is
 * treated as expired.
 */
export function openInvitations<T extends InvitationRecord>(invitations: T[], memberEmails: Iterable<string>, now: number) {
  const members = new Set([...memberEmails].map(normalizeEmail));
  const newest = new Map<string, T & { expired: boolean }>();
  for (const invitation of invitations) {
    if (invitation.state !== "pending" && invitation.state !== "expired") continue;
    const email = normalizeEmail(invitation.email);
    if (members.has(email)) continue;
    const current = newest.get(email);
    if (current && Date.parse(current.createdAt) >= Date.parse(invitation.createdAt)) continue;
    newest.set(email, { ...invitation, expired: invitation.state === "expired" || Date.parse(invitation.expiresAt) <= now });
  }
  return [...newest.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function invitationStatus(invitation: { expired: boolean; expiresAt: string }, now: number) {
  if (invitation.expired) return "Expired";
  const days = Math.ceil((Date.parse(invitation.expiresAt) - now) / DAY_MS);
  if (days <= 1) return "Expires today";
  return `Expires in ${days} days`;
}

export function initials(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

export function displayName(user: { firstName?: string | null; lastName?: string | null; email: string }) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

/** "today, 10:12", "24 Oct", or "24 Oct 2025" when not this year. */
export function shortDate(iso: string, now: number, timeZone?: string) {
  const date = new Date(iso);
  const today = new Date(now);
  const day = (value: Date) => value.toLocaleDateString("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  if (day(date) === day(today)) return `today, ${date.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" })}`;
  const sameYear = date.toLocaleDateString("en-GB", { timeZone, year: "numeric" }) === today.toLocaleDateString("en-GB", { timeZone, year: "numeric" });
  return date.toLocaleDateString("en-GB", { timeZone, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}
