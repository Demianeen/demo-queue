import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import { getWorkOSRedirectUri, isAuthConfigured } from "@/lib/auth-config";
import { workspaceReturnPath } from "@/lib/workspace-routes";

export async function GET(request: NextRequest) {
  if (!isAuthConfigured()) return NextResponse.redirect(new URL("/events", request.url));
  const requested = request.nextUrl.searchParams.get("returnTo");
  const returnTo = workspaceReturnPath(requested);
  try {
    return NextResponse.redirect(await getSignInUrl({ returnTo, redirectUri: getWorkOSRedirectUri() }));
  } catch {
    return NextResponse.redirect(new URL("/events?error=sign-in", request.url));
  }
}
