/**
 * The analytics id of one submit form page load: a short SHA-256 of its
 * `browserClientId`. The browser puts it on its submission events and Convex
 * on `submission_submitted`, so PostHog can tie a failed attempt to the
 * submit that followed without cookies. The client id itself is a rate-limit
 * key and never leaves for analytics. Runs in the browser and in Convex.
 */
export async function formId(clientId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`demo-queue-form:${clientId}`));
  return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
