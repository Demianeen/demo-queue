import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/vercel-build.mjs", import.meta.url));
const branchHost = "demo-queue-git-codex-organizat-d0ac4e-netlyukh-demians-projects.vercel.app";
const preview = {
  VERCEL_ENV: "preview",
  VERCEL_BRANCH_URL: branchHost,
  NEXT_PUBLIC_CONVEX_URL: "https://precious-elk-564.convex.cloud",
  WORKOS_CLIENT_ID: "client_01M1RPKQD8S6KM3Q61N0N2FE4D",
  WORKOS_API_KEY: "test-private-api-key",
  WORKOS_COOKIE_PASSWORD: "test-private-cookie-password-over-32-characters",
  NEXT_PUBLIC_WORKOS_REDIRECT_URI: `https://${branchHost}/callback`,
};

async function runBuild(t, overrides = {}, exitCode = 0) {
  const directory = await mkdtemp(join(tmpdir(), "vercel-build-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = join(directory, "calls.json");
  const pnpm = join(directory, "pnpm");
  await writeFile(pnpm, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(calls)}, JSON.stringify({
  args: process.argv.slice(2),
  convexVariables: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("CONVEX_") || key.startsWith("NEXT_PUBLIC_CONVEX_"))),
  client: process.env.WORKOS_CLIENT_ID,
  callback: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  apiKeyPresent: process.env.WORKOS_API_KEY === "test-private-api-key",
  cookiePresent: process.env.WORKOS_COOKIE_PASSWORD === "test-private-cookie-password-over-32-characters"
}));
process.exit(${exitCode});
`);
  await chmod(pnpm, 0o700);
  const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith("VERCEL_") && !key.startsWith("CONVEX_") &&
    !key.startsWith("NEXT_PUBLIC_CONVEX_") && !key.startsWith("WORKOS_") &&
    key !== "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  ));
  const result = spawnSync(process.execPath, [script], {
    cwd: directory,
    // An override of undefined leaves the variable unset.
    env: Object.fromEntries(Object.entries({ ...cleanEnvironment, ...preview, ...overrides, PATH: `${directory}:${process.env.PATH}` })
      .filter(([, value]) => value !== undefined)),
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.ifError(result.error);
  const call = await readFile(calls, "utf8").then(JSON.parse).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  for (const secret of [preview.WORKOS_API_KEY, preview.WORKOS_COOKIE_PASSWORD, "inherited-production-deploy-secret"]) {
    assert.equal(`${result.stdout}${result.stderr}`.includes(secret), false);
  }
  return { ...result, call };
}

test("Preview builds Next.js with canonical auth and removes inherited Convex credentials", async (t) => {
  const result = await runBuild(t, {
    CONVEX_DEPLOY_KEY: "inherited-production-deploy-secret",
    CONVEX_DEPLOYMENT: "preview:unrelated-deployment",
    CONVEX_OVERRIDE_ACCESS_TOKEN: "test-private-override",
    NEXT_PUBLIC_CONVEX_SITE_URL: "https://unrelated-deployment.convex.site",
  });
  assert.equal(result.status, 0);
  assert.deepEqual(result.call, {
    args: ["run", "build"],
    convexVariables: { NEXT_PUBLIC_CONVEX_URL: "https://precious-elk-564.convex.cloud" },
    client: "client_01M1RPKQD8S6KM3Q61N0N2FE4D",
    callback: `https://${branchHost}/callback`,
    apiKeyPresent: true,
    cookiePresent: true,
  });
});

test("Preview derives the callback from the branch host when none is set", async (t) => {
  for (const callback of [undefined, ""]) {
    const result = await runBuild(t, { NEXT_PUBLIC_WORKOS_REDIRECT_URI: callback });
    assert.equal(result.status, 0);
    assert.equal(result.call.callback, `https://${branchHost}/callback`);
  }
});

test("Production retains the exact deploy command and its existing environment", async (t) => {
  const result = await runBuild(t, {
    VERCEL_ENV: "production",
    CONVEX_DEPLOY_KEY: "inherited-production-deploy-secret",
    CONVEX_DEPLOYMENT: "prod:giant-egret-456",
    NEXT_PUBLIC_CONVEX_URL: "https://giant-egret-456.convex.cloud",
    WORKOS_CLIENT_ID: "production-client-kept",
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://demo-queue-tau.vercel.app/callback",
  });
  assert.equal(result.status, 0);
  assert.deepEqual(result.call, {
    args: ["exec", "convex", "deploy", "--cmd-url-env-var-name", "NEXT_PUBLIC_CONVEX_URL", "--cmd", "pnpm run build"],
    convexVariables: {
      CONVEX_DEPLOY_KEY: "inherited-production-deploy-secret",
      CONVEX_DEPLOYMENT: "prod:giant-egret-456",
      NEXT_PUBLIC_CONVEX_URL: "https://giant-egret-456.convex.cloud",
    },
    client: "production-client-kept",
    callback: "https://demo-queue-tau.vercel.app/callback",
    apiKeyPresent: true,
    cookiePresent: true,
  });
});

test("Preview rejects mismatched providers and missing credentials before building", async (t) => {
  const cases = [
    [{ NEXT_PUBLIC_CONVEX_URL: "https://giant-egret-456.convex.cloud" }, "preview_convex_url_mismatch"],
    [{ NEXT_PUBLIC_CONVEX_URL: "" }, "preview_convex_url_mismatch"],
    [{ WORKOS_CLIENT_ID: "client_wrong" }, "preview_workos_client_mismatch"],
    [{ WORKOS_API_KEY: "" }, "preview_workos_api_key_missing"],
    [{ WORKOS_API_KEY: "  " }, "preview_workos_api_key_missing"],
    [{ WORKOS_COOKIE_PASSWORD: "short" }, "preview_workos_cookie_password_invalid"],
  ];
  for (const [overrides, reason] of cases) {
    const result = await runBuild(t, overrides);
    assert.equal(result.status, 1);
    assert.equal(result.call, null);
    assert.deepEqual(JSON.parse(result.stderr), { status: "configuration_error", reason });
  }
});

test("Preview requires this project's stable branch host and its exact callback", async (t) => {
  for (const host of ["", "unrelated.vercel.app", "demo-queue-git-first-other-team.vercel.app", `https://${branchHost}`, `${branchHost}@evil.example`, `${branchHost}/path`]) {
    const result = await runBuild(t, { VERCEL_BRANCH_URL: host });
    assert.equal(result.status, 1);
    assert.equal(result.call, null);
    assert.deepEqual(JSON.parse(result.stderr), { status: "configuration_error", reason: "preview_branch_host_invalid" });
  }
  for (const callback of ["http://localhost:3000/callback", "https://demo-queue-tau.vercel.app/callback", `https://${branchHost}/other`, `https://${branchHost}/callback?code=private`]) {
    const result = await runBuild(t, { NEXT_PUBLIC_WORKOS_REDIRECT_URI: callback });
    assert.equal(result.status, 1);
    assert.equal(result.call, null);
    assert.deepEqual(JSON.parse(result.stderr), { status: "configuration_error", reason: "preview_callback_mismatch" });
  }
});

test("Unknown build environments fail closed and child failures propagate", async (t) => {
  for (const environment of ["", "development", "unknown"]) {
    const result = await runBuild(t, { VERCEL_ENV: environment });
    assert.equal(result.status, 1);
    assert.equal(result.call, null);
    assert.deepEqual(JSON.parse(result.stderr), { status: "configuration_error", reason: "unsupported_vercel_environment" });
  }
  const failed = await runBuild(t, {}, 23);
  assert.equal(failed.status, 23);
  assert.deepEqual(failed.call.args, ["run", "build"]);
});
