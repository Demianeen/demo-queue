import { AuthenticationException } from "@workos-inc/node";
import { sealData, unsealData } from "iron-session";
import { z } from "zod";
// @ts-expect-error Node's strip-types test runner resolves the source extension directly.
import { workspaceReturnPath } from "./workspace-routes.ts";

export const organizationSelectionPath = "/events/choose-organization";
export const organizationSelectionLifetime = 300;

const organization = z.object({ id: z.string().regex(/^org_[A-Za-z0-9]+$/), name: z.string().min(1).max(200) });
const organizations = z.array(organization).min(1).max(100).refine((items) => new Set(items.map((item) => item.id)).size === items.length);
const pendingSelection = z.object({
  kind: z.literal("google-organization-selection"),
  flowId: z.string().uuid(),
  pendingAuthenticationToken: z.string().min(1).max(6000),
  organizations,
  csrf: z.string().uuid(),
  expiresAt: z.number().int().positive(),
  returnTo: z.string().transform(workspaceReturnPath),
});
const organizationError = z.object({
  code: z.literal("organization_selection_required"),
  pending_authentication_token: z.string().min(1).max(6000),
  organizations,
});
const pkceState = z.object({
  nonce: z.string().min(1),
  codeVerifier: z.string().min(43).max(128),
  returnPathname: z.string().optional(),
});
export type PendingOrganizationSelection = z.infer<typeof pendingSelection>;
export type OrganizationSelectionView = Pick<PendingOrganizationSelection, "organizations" | "csrf" | "returnTo" | "flowId">;

export function organizationSelectionFlowId(url: URL) {
  const values = url.searchParams.getAll("flow");
  if (values.length !== 1) return null;
  const parsed = z.string().uuid().safeParse(values[0]);
  return parsed.success ? parsed.data : null;
}

export function organizationSelectionCookieName(flowId: string) {
  return `dq-google-organization-${z.string().uuid().parse(flowId)}`;
}

// AuthKit 4 derives a separate verifier cookie for each sealed OAuth state.
export function googlePKCECookieName(state: string) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(state)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return `wos-auth-verifier-${hash.toString(16).padStart(8, "0")}`;
}

export function callbackCookieName(url: URL) {
  const states = url.searchParams.getAll("state");
  return states.length === 1 && states[0].length > 0 && states[0].length <= 8192 ? googlePKCECookieName(states[0]) : null;
}

export async function readGoogleCallback({ url, cookies, password }: {
  url: URL;
  cookies: { get(name: string): { value: string } | undefined };
  password: string;
}) {
  const codes = url.searchParams.getAll("code");
  const states = url.searchParams.getAll("state");
  const cookieName = callbackCookieName(url);
  if (!cookieName || codes.length !== 1 || !codes[0] || codes[0].length > 4096) throw new Error("Invalid OAuth callback");
  const flowCookie = cookies.get(cookieName) ?? cookies.get("wos-auth-verifier");
  if (!flowCookie || flowCookie.value !== states[0]) throw new Error("Invalid OAuth state");
  const state = pkceState.parse(await unsealData(flowCookie.value, { password }));
  return { code: codes[0], codeVerifier: state.codeVerifier, returnTo: workspaceReturnPath(state.returnPathname ?? null) };
}

export async function beginOrganizationSelection({ error, returnTo, password, now = Date.now() }: {
  error: unknown;
  returnTo: string;
  password: string;
  now?: number;
}) {
  if (!(error instanceof AuthenticationException)) return null;
  const parsed = organizationError.safeParse(error.rawData);
  if (!parsed.success) return null;
  const selection = pendingSelection.parse({
    kind: "google-organization-selection",
    flowId: crypto.randomUUID(),
    pendingAuthenticationToken: parsed.data.pending_authentication_token,
    organizations: parsed.data.organizations,
    csrf: crypto.randomUUID(),
    expiresAt: now + organizationSelectionLifetime * 1000,
    returnTo,
  });
  const sealed = await sealData(selection, { password: `${password}:google-organization-selection`, ttl: organizationSelectionLifetime });
  if (sealed.length > 3800) throw new Error("Organization selection exceeds cookie limit");
  return { flowId: selection.flowId, sealed };
}

export async function readOrganizationSelection({ sealed, flowId, password, now = Date.now() }: { sealed: string | undefined; flowId: string; password: string; now?: number }) {
  if (!sealed || sealed.length > 3800) return null;
  try {
    const selection = pendingSelection.parse(await unsealData(sealed, { password: `${password}:google-organization-selection` }));
    return selection.flowId === flowId && selection.expiresAt > now && selection.expiresAt <= now + organizationSelectionLifetime * 1000 ? selection : null;
  } catch {
    return null;
  }
}

export function organizationSelectionChoice({ selection, form, origin, requestUrl }: {
  selection: PendingOrganizationSelection | null;
  form: FormData;
  origin: string | null;
  requestUrl: string;
}) {
  if (!selection || origin !== new URL(requestUrl).origin || form.getAll("csrf").length !== 1 || form.getAll("organizationId").length !== 1) return null;
  const csrf = form.get("csrf");
  const organizationId = form.get("organizationId");
  if (typeof csrf !== "string" || csrf !== selection.csrf || typeof organizationId !== "string" || !selection.organizations.some((item) => item.id === organizationId)) return null;
  return { pendingAuthenticationToken: selection.pendingAuthenticationToken, organizationId, returnTo: selection.returnTo };
}

export function organizationSelectionCookieOptions(requestUrl: string) {
  return { httpOnly: true, sameSite: "lax" as const, secure: new URL(requestUrl).protocol === "https:", path: organizationSelectionPath, maxAge: organizationSelectionLifetime };
}
