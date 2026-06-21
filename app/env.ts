import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const convexDeploymentUrl = z
  .string()
  .url()
  .refine(isConvexClientDeploymentUrl, {
    message: "Use the Convex client deployment URL ending in .convex.cloud, or a local Convex URL, not the HTTP actions URL ending in .convex.site.",
  });

function isConvexClientDeploymentUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const isHostedConvex = url.protocol === "https:" && url.hostname.endsWith(".convex.cloud");
  if (isHostedConvex) return true;

  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
  );
}

export const env = createEnv({
  client: {
    NEXT_PUBLIC_CONVEX_URL: convexDeploymentUrl,
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  },
});
