// Lets a browser that submitted see what it sent when the link is reopened.
// The token stays only for a week: events store no end time, so a fixed
// window covers the event and a little after. "Not you? Start a new
// submission" forgets it at once, for shared or borrowed devices.

const STORAGE_PREFIX = "demo-queue:submitted:";
export const REMEMBER_FOR_MS = 7 * 24 * 60 * 60 * 1000;

type Remembered = { token: string; expiresAt: number };

function isRemembered(value: unknown): value is Remembered {
  return typeof value === "object" && value !== null &&
    typeof (value as Remembered).token === "string" && typeof (value as Remembered).expiresAt === "number";
}

/** The participant token this browser submitted with, if it is remembered and not expired. */
export function readRememberedSubmission(slug: string, now = Date.now()) {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + slug);
    if (!raw) return null;
    let value: unknown = null;
    try { value = JSON.parse(raw); } catch { /* an unreadable value is dropped below */ }
    if (isRemembered(value) && value.expiresAt > now) return value.token;
    window.localStorage.removeItem(STORAGE_PREFIX + slug);
    return null;
  } catch {
    return null;
  }
}

export function rememberSubmission(slug: string, participantToken: string, now = Date.now()) {
  try {
    const value: Remembered = { token: participantToken, expiresAt: now + REMEMBER_FOR_MS };
    window.localStorage.setItem(STORAGE_PREFIX + slug, JSON.stringify(value));
  } catch {
    // Private windows and blocked storage just skip the locked view.
  }
}

export function forgetSubmission(slug: string) {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + slug);
  } catch {
    // Nothing to forget.
  }
}
