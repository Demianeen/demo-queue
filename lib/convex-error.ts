/**
 * The text a Convex function threw with `new ConvexError("...")`, or null.
 * Production deployments redact the error's message to "[Request ID: ...]
 * Server Error" and keep the text only in `data`, so never read it from the
 * message alone: that works on dev and silently fails on prod. Checked by
 * name rather than `instanceof`, which fails when the error comes from
 * another copy of the convex package (ESM and CommonJS builds side by side).
 */
export function convexErrorText(error: unknown) {
  const data = error instanceof Error && error.name === "ConvexError" ? (error as Error & { data?: unknown }).data : undefined;
  if (typeof data === "string") return data;
  const message = error instanceof Error ? error.message : "";
  return message.includes("ConvexError: ") ? message.split("ConvexError: ").pop()!.split("\n")[0] : null;
}
