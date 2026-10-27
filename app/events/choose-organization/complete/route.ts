import { getWorkOS, saveSession } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import { organizationSelectionChoice, organizationSelectionCookieName, organizationSelectionCookieOptions, organizationSelectionFlowId, readOrganizationSelection } from "@/lib/google-auth-flow";

export async function POST(request: NextRequest) {
  let destination: string;
  const flowId = organizationSelectionFlowId(request.nextUrl);
  try {
    const password = process.env.WORKOS_COOKIE_PASSWORD;
    const clientId = process.env.WORKOS_CLIENT_ID;
    if (!password || !clientId || !flowId) throw new Error("Authentication is unavailable");
    if (Number(request.headers.get("content-length")) > 4096) throw new Error("Invalid organization selection");
    const selection = await readOrganizationSelection({ sealed: request.cookies.get(organizationSelectionCookieName(flowId))?.value, flowId, password });
    const choice = organizationSelectionChoice({ selection, form: await request.formData(), origin: request.headers.get("origin"), requestUrl: request.url });
    if (!choice) throw new Error("Invalid organization selection");
    const session = await getWorkOS().userManagement.authenticateWithOrganizationSelection({ clientId, organizationId: choice.organizationId, pendingAuthenticationToken: choice.pendingAuthenticationToken });
    if (!session.accessToken || !session.refreshToken || session.organizationId !== choice.organizationId) throw new Error("Invalid authentication response");
    await saveSession(session, request);
    destination = choice.returnTo;
  } catch {
    destination = "/events?error=sign-in";
  }
  const response = NextResponse.redirect(new URL(destination, request.url), 303);
  if (flowId) response.cookies.set(organizationSelectionCookieName(flowId), "", { ...organizationSelectionCookieOptions(request.url), maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
