import { handleAuth } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import { isAuthConfigured } from "@/lib/auth-config";

export async function GET(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.redirect(new URL("/events", request.url));
  }
  return handleAuth({
    returnPathname: "/events",
    onError: () => NextResponse.redirect(new URL("/events?error=sign-in", request.url)),
  })(request);
}
