import { spawnSync } from "node:child_process";

function previewEnvironment(env) {
  if (env.NEXT_PUBLIC_CONVEX_URL !== "https://precious-elk-564.convex.cloud") {
    throw new Error("preview_convex_url_mismatch");
  }
  if (env.WORKOS_CLIENT_ID !== "client_01M1RPKQD8S6KM3Q61N0N2FE4D") {
    throw new Error("preview_workos_client_mismatch");
  }
  if (!env.WORKOS_API_KEY?.trim()) throw new Error("preview_workos_api_key_missing");
  if (!env.WORKOS_COOKIE_PASSWORD || env.WORKOS_COOKIE_PASSWORD.trim().length < 32) {
    throw new Error("preview_workos_cookie_password_invalid");
  }
  const host = env.VERCEL_BRANCH_URL;
  if (!host || !/^demo-queue-git-[a-z0-9-]+-netlyukh-demians-projects\.vercel\.app$/.test(host)) {
    throw new Error("preview_branch_host_invalid");
  }
  // Every branch shares one Preview environment, so the callback comes from the branch host.
  const callback = `https://${host}/callback`;
  if (env.NEXT_PUBLIC_WORKOS_REDIRECT_URI && env.NEXT_PUBLIC_WORKOS_REDIRECT_URI !== callback) {
    throw new Error("preview_callback_mismatch");
  }
  return {
    ...Object.fromEntries(Object.entries(env).filter(([key]) =>
      !key.startsWith("CONVEX_") &&
      (!key.startsWith("NEXT_PUBLIC_CONVEX_") || key === "NEXT_PUBLIC_CONVEX_URL"),
    )),
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: callback,
  };
}

function main() {
  let args;
  let env;
  try {
    if (process.env.VERCEL_ENV === "production") {
      args = ["exec", "convex", "deploy", "--cmd-url-env-var-name", "NEXT_PUBLIC_CONVEX_URL", "--cmd", "pnpm run build"];
      env = process.env;
    } else if (process.env.VERCEL_ENV === "preview") {
      args = ["run", "build"];
      env = previewEnvironment(process.env);
    } else {
      throw new Error("unsupported_vercel_environment");
    }
  } catch (error) {
    console.error(JSON.stringify({ status: "configuration_error", reason: error.message }));
    process.exitCode = 1;
    return;
  }
  const result = spawnSync("pnpm", args, { env, stdio: "inherit" });
  if (result.error) {
    console.error(JSON.stringify({ status: "build_error", reason: "build_process_failed" }));
  }
  process.exitCode = result.status ?? 1;
}

main();
