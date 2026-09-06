export function isEventDetailsPath(path: string) {
  return /^\/events\/[^/]+\/overview$/.test(path);
}

export function workspaceReturnPath(path: string | null) {
  return path && (path === "/styles" || path === "/events/new" || /^\/events\/[a-z0-9]+(?:-[a-z0-9]+)*\/overview$/.test(path)) ? path : "/events";
}

export function eventDetailsPath(slug: string) { return `/events/${slug}/overview`; }
