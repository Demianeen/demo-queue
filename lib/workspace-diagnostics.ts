export type WorkspaceLoadPhase = "authentication" | "memberships" | "events-and-styles" | "organization-check";

export function workspaceFailureDiagnostic(phase: WorkspaceLoadPhase, error: unknown) {
  const status = error !== null && typeof error === "object" && "status" in error && typeof error.status === "number" && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined;
  const message = error instanceof Error ? error.message : "";
  const reason = phase === "organization-check" ? "organization-mismatch"
    : /No auth provider|InvalidAuthHeader|Invalid authentication|JWT|token.*(?:expired|invalid)|could not verify.*token/i.test(message) ? "convex-authentication-rejected"
    : /Could not find (?:public )?function|Function not found/i.test(message) ? "convex-function-unavailable"
    : /ArgumentValidationError|does not match the validator|extra field/i.test(message) ? "convex-arguments-rejected"
    : /Sign in to manage events|Choose an organization to manage events|Unauthorized/i.test(message) ? "organization-access-rejected"
    : /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message) ? "connection-failed"
    : "request-failed";
  return { phase, status, reason };
}
