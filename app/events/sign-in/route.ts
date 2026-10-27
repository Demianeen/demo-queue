import { getSignInUrl, getWorkOS } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import { getWorkOSRedirectUri, isAuthConfigured } from "@/lib/auth-config";
import { workspaceReturnPath } from "@/lib/workspace-routes";
import { googleSignInUrl } from "@/lib/google-sign-in";

export async function GET(request: NextRequest) {
  if (!isAuthConfigured()) return NextResponse.redirect(new URL("/events", request.url));
  const requested = request.nextUrl.searchParams.get("returnTo");
  const returnTo = workspaceReturnPath(requested);
  try {
    const authkitUrl = await getSignInUrl({ returnTo, redirectUri: getWorkOSRedirectUri() });
    return NextResponse.redirect(googleSignInUrl(authkitUrl, (options) => getWorkOS().userManagement.getAuthorizationUrl(options)));
  } catch {
    return NextResponse.redirect(new URL("/events?error=sign-in", request.url));
  }
}
