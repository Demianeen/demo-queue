import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse, NextFetchEvent } from "next/server";
import { isAuthConfigured } from "./lib/auth-config";

const handleAuth = authkitMiddleware();

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (!isAuthConfigured()) return NextResponse.next();
  return handleAuth(request, event);
}

export const config = { matcher: ["/events/:path*", "/styles/:path*", "/callback"] };
