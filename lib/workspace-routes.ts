export function isEventDetailsPath(path: string) {
  return /^\/events\/[^/]+\/overview$/.test(path);
}

export function isEventAdminPath(path: string) {
  return /^\/events\/[^/]+\/admin$/.test(path);
}

export function workspaceReturnPath(path: string | null) {
  if (path === "/events/connections" || path === "/events/connect" || (path && /^\/events\/connect\?request=[A-Za-z0-9_-]{1,128}$/.test(path))) return path;
  return path && (path === "/styles" || path === "/events/new" || /^\/events\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:overview|admin)$/.test(path)) ? path : "/events";
}

export function eventDetailsPath(slug: string) { return `/events/${slug}/overview`; }
