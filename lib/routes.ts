export function absoluteUrl(path: string) {
  if (typeof window === "undefined") {
    return path;
  }
  return `${window.location.origin}${path}`;
}

export function submissionPath(slug: string) {
  return `/e/${slug}`;
}

export function stagePath(slug: string) {
  return `/stage/${slug}`;
}

export function adminPath(slug: string) {
  return `/events/${encodeURIComponent(slug)}/admin`;
}

export function participantPath(slug: string, token: string) {
  return `/s/${slug}/${token}`;
}
