import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import { getWorkOSRedirectUri, isAuthConfigured } from "@/lib/auth-config";

// WorkOS-initiated flows must pass through AuthKit to consume its invitation context cookie.
export async function GET(request: NextRequest) {
  if (!isAuthConfigured()) return NextResponse.redirect(new URL("/events", request.url));
  try {
    const url = await getSignInUrl({ returnTo: "/events", redirectUri: getWorkOSRedirectUri() });
    const response = NextResponse.redirect(url);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.redirect(new URL("/events?error=sign-in", request.url));
  }
}
