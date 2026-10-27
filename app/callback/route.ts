import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import { isAuthConfigured } from "@/lib/auth-config";
import { beginOrganizationSelection, callbackCookieName, organizationSelectionCookieName, organizationSelectionCookieOptions, organizationSelectionPath, readGoogleCallback } from "@/lib/google-auth-flow";

export async function GET(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.redirect(new URL("/events", request.url));
  }
  const password = process.env.WORKOS_COOKIE_PASSWORD;
  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!password || !clientId) return NextResponse.redirect(new URL("/events", request.url));
  let response: NextResponse;
  try {
    const flow = await readGoogleCallback({ url: request.nextUrl, cookies: request.cookies, password });
    try {
      const session = await getWorkOS().userManagement.authenticateWithCode({ clientId, code: flow.code, codeVerifier: flow.codeVerifier });
      if (!session.accessToken || !session.refreshToken) throw new Error("Missing authentication tokens");
      await saveSession(session, request);
      response = NextResponse.redirect(new URL(flow.returnTo, request.url));
    } catch (error) {
      const pending = await beginOrganizationSelection({ error, returnTo: flow.returnTo, password });
      if (!pending) throw new Error("Authentication could not be completed");
      const destination = new URL(organizationSelectionPath, request.url);
      destination.searchParams.set("flow", pending.flowId);
      response = NextResponse.redirect(destination);
      response.cookies.set(organizationSelectionCookieName(pending.flowId), pending.sealed, organizationSelectionCookieOptions(request.url));
    }
  } catch {
    response = NextResponse.redirect(new URL("/events?error=sign-in", request.url));
  }
  const domain = process.env.WORKOS_COOKIE_DOMAIN;
  const expiredPKCECookie = { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", ...(domain ? { domain } : {}) } as const;
  const cookieName = callbackCookieName(request.nextUrl);
  if (cookieName) response.cookies.set(cookieName, "", expiredPKCECookie);
  if (request.cookies.has("wos-auth-verifier")) response.cookies.set("wos-auth-verifier", "", expiredPKCECookie);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
