/**
 * Analytics never sees a secret in a URL. Judge, status and old admin links
 * carry their token in the path, and sign-in and MCP consent pages carry
 * OAuth codes and state in the query, so every URL is rewritten before it
 * leaves the browser or the server.
 */

/** `/judge/[slug]/[token]`, `/s/[slug]/[token]` and `/admin/[slug]/[token]`. */
const SECRET_PATH = /^\/(judge|s|admin)\/([^/?#]+)\/[^/?#]+/;
/** The same paths anywhere in a longer string, such as an autocapture element chain. */
const SECRET_PATH_ANYWHERE = /\/(judge|s|admin)\/([^/?#"'\s]+)\/[^/?#"'\s]+/g;
/** Query parameters that only hold the app's own view state. Everything else is dropped. */
const KEPT_QUERY = new Set(["view", "sort", "status", "track"]);
const RELATIVE_BASE = "http://relative.invalid";

const keepParameter = (name: string) => KEPT_QUERY.has(name) || name.startsWith("utm_");

export function scrubPath(pathname: string) {
  return pathname.replace(SECRET_PATH, "/$1/$2/[token]");
}

export function scrubSecretPaths(text: string) {
  return text.replace(SECRET_PATH_ANYWHERE, "/$1/$2/[token]");
}

/**
 * The URL with secret path segments replaced, only the allowed query
 * parameters and no fragment. Values that are not a URL or a path, such as
 * PostHog's `$direct` referrer, are returned unchanged.
 */
export function scrubUrl(value: string): string {
  const absolute = /^https?:\/\//i.test(value);
  if (!absolute && !value.startsWith("/")) return value;
  let url: URL;
  try {
    url = new URL(value, RELATIVE_BASE);
  } catch {
    return scrubSecretPaths(value.split(/[?#]/)[0]);
  }
  const query = new URLSearchParams();
  for (const [name, parameter] of url.searchParams) if (keepParameter(name)) query.append(name, parameter);
  const search = query.size ? `?${query}` : "";
  const path = scrubPath(url.pathname);
  return absolute ? `${url.origin}${path}${search}` : `${path}${search}`;
}

export type AnalyticsSurface = "organiser" | "team" | "judge" | "stage" | "other";

/** Which part of the app a path belongs to, for the `surface` property. */
export function analyticsSurface(pathname: string): AnalyticsSurface {
  if (/^\/judge\//.test(pathname)) return "judge";
  if (/^\/(e|s)\//.test(pathname) || /^\/saved(\/|$)/.test(pathname)) return "team";
  if (/^\/stage\//.test(pathname)) return "stage";
  if (/^\/(events|members|styles|ai-usage|admin)(\/|$)/.test(pathname)) return "organiser";
  return "other";
}
