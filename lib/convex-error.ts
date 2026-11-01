import { ConvexError } from "convex/values";

/**
 * The text a Convex function threw with `new ConvexError("...")`, or null.
 * Production deployments redact the error's message to "[Request ID: ...]
 * Server Error" and keep the text only in `data`, so never read it from the
 * message alone: that works on dev and silently fails on prod.
 */
export function convexErrorText(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  const message = error instanceof Error ? error.message : "";
  return message.includes("ConvexError: ") ? message.split("ConvexError: ").pop()!.split("\n")[0] : null;
}
