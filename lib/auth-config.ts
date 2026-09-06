type RedirectEnvironment = {
  VERCEL_ENV?: string;
  VERCEL_BRANCH_URL?: string;
  NEXT_PUBLIC_WORKOS_REDIRECT_URI?: string;
};

// Only deployment configuration chooses the callback, never a request header.
export function getWorkOSRedirectUri(env: RedirectEnvironment = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
}) {
  if (env.VERCEL_ENV !== "preview") return env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
  const hostname = env.VERCEL_BRANCH_URL;
  if (!hostname || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/i.test(hostname)) return undefined;
  return `https://${hostname.toLowerCase()}/callback`;
}

export function previewWorkspaceUrl(requestUrl: string, redirectUri: string | undefined) {
  if (!redirectUri) return undefined;
  const request = new URL(requestUrl);
  const callback = new URL(redirectUri);
  if (request.origin === callback.origin) return undefined;
  // Set path/query separately so a path starting with // cannot replace the host.
  callback.pathname = request.pathname;
  callback.search = request.search;
  return callback.toString();
}

// Safe to import from middleware: this returns only readiness, never secrets.
export function isAuthConfigured() {
  return Boolean(
    process.env.WORKOS_CLIENT_ID &&
      process.env.WORKOS_API_KEY &&
      process.env.WORKOS_COOKIE_PASSWORD &&
      getWorkOSRedirectUri(),
  );
}
