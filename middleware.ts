import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse, NextFetchEvent } from "next/server";
import { getWorkOSRedirectUri, isAuthConfigured, previewWorkspaceUrl } from "./lib/auth-config";
import { posthogProxyHeaders, posthogProxyUrl } from "./lib/posthog-routing";

const redirectUri = getWorkOSRedirectUri();
const handleAuth = authkitMiddleware({ redirectUri });

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  // A next.config rewrite would forward the session cookie to PostHog.
  const posthogUrl = posthogProxyUrl(request.nextUrl);
  if (posthogUrl) return NextResponse.rewrite(posthogUrl, { request: { headers: posthogProxyHeaders(request.headers) } });
  if (!isAuthConfigured()) return NextResponse.next();
  if (process.env.VERCEL_ENV === "preview") {
    const canonicalUrl = previewWorkspaceUrl(request.url, redirectUri);
    if (canonicalUrl) return NextResponse.redirect(canonicalUrl);
  }
  return handleAuth(request, event);
}

export const config = { matcher: ["/events/:path*", "/styles/:path*", "/members/:path*", "/ai-usage/:path*", "/callback", "/ingest/:path*"] };
