export type SocialKind = "twitter" | "linkedin" | "github";

const SOCIAL_HOSTS: Record<SocialKind, RegExp> = {
  twitter: /(^|\.)(x\.com|twitter\.com)$/i,
  linkedin: /(^|\.)linkedin\.com$/i,
  github: /(^|\.)github\.com$/i,
};

const SOCIAL_ORIGINS: Record<SocialKind, string> = {
  twitter: "https://x.com",
  linkedin: "https://www.linkedin.com",
  github: "https://github.com",
};

/**
 * The profile link for a handle or URL someone typed, or null when it is not
 * on that platform's own site. Only https links to x.com/twitter.com,
 * linkedin.com or github.com come out of here.
 */
export function socialUrl(kind: SocialKind, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const looksLikeHost = /^[^/@\s]+\.[^/\s]+(\/|$)/.test(trimmed);
  if (hasScheme || looksLikeHost) {
    let url: URL;
    try {
      url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.port) return null;
    if (!SOCIAL_HOSTS[kind].test(url.hostname)) return null;
    url.protocol = "https:";
    return url.toString();
  }

  const clean = trimmed.replace(/^@/, "").replace(/^\/+/, "");
  if (!/^[A-Za-z0-9_.%/-]+$/.test(clean)) return null;
  const path = clean
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(decodeSafely(segment)))
    .join("/");
  if (!path) return null;
  if (kind === "linkedin") return `${SOCIAL_ORIGINS.linkedin}/${path.startsWith("in/") ? path : `in/${path}`}`;
  return `${SOCIAL_ORIGINS[kind]}/${path}`;
}

function decodeSafely(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
