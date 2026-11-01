/** Where `/ingest` requests go: scripts and config come from the assets host. */
const ASSET_PATH = /^\/(static|array)\//;

/**
 * PostHog traffic goes through our own domain, since ad blockers drop
 * requests to posthog.com. Returns the PostHog URL for an `/ingest` request,
 * or null for every other path.
 */
export function posthogProxyUrl(url: URL) {
  if (!url.pathname.startsWith("/ingest/")) return null;
  const path = url.pathname.slice("/ingest".length);
  // The path is set on a fixed origin: resolving "//other.host/x" against
  // one would leave PostHog and make this an open proxy.
  const target = new URL(ASSET_PATH.test(path) ? "https://eu-assets.i.posthog.com" : "https://eu.i.posthog.com");
  target.pathname = path;
  target.search = url.search;
  return target;
}

/**
 * A proxied request carries no cookies (the WorkOS session cookie is sent to
 * every path on our domain) and no Referer (it holds judge and status links).
 * The client IP stays: cookieless mode counts visitors by a hash of it.
 */
export function posthogProxyHeaders(headers: Headers) {
  const forwarded = new Headers(headers);
  forwarded.delete("cookie");
  forwarded.delete("referer");
  return forwarded;
}
