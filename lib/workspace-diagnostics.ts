export type WorkspaceLoadPhase = "authentication" | "memberships" | "events-and-styles" | "organization-check";

export function workspaceFailureDiagnostic(phase: WorkspaceLoadPhase, error: unknown) {
  const status = error !== null && typeof error === "object" && "status" in error && typeof error.status === "number" && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined;
  return { phase, status, reason: phase === "organization-check" ? "organization-mismatch" : "request-failed" };
}
