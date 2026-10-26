import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

const deployment = "dev:precious-elk-564";
const publicUrl = "https://precious-elk-564.convex.cloud";
const apiUrl = "https://api.convex.dev/api/deployment/precious-elk-564/team_and_project";
const forbiddenOverrides = [
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_OVERRIDE_ACCESS_TOKEN",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CONVEX_PROVISION_HOST",
  "CONVEX_AGENT_MODE",
];

function emit(result) {
  console.log(JSON.stringify(result));
  return result;
}

function runCli(args, timeout = 20_000) {
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), "node_modules/convex/bin/main.js"), ...args],
    {
      env: { ...process.env, CONVEX_DEPLOYMENT: deployment, CI: "1" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      killSignal: "SIGKILL",
    },
  );
  return {
    ok: result.status === 0 && !result.error,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    timedOut: result.error?.code === "ETIMEDOUT",
  };
}

async function preflight() {
  const base = {
    checkedAt: new Date().toISOString(),
    envLocalExists: false,
    deployment,
    publicUrl,
  };
  const finish = (status, fields = {}) => emit({ ...base, status, ...fields });
  let local;
  let fallback;
  try {
    local = parseEnv(await readFile(join(process.cwd(), ".env.local"), "utf8"));
    base.envLocalExists = true;
  } catch (error) {
    return finish("configuration_error", {
      reason: error.code === "ENOENT" ? "env_local_missing" : "env_local_unreadable",
    });
  }
  try {
    fallback = parseEnv(await readFile(join(process.cwd(), ".env"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") return finish("configuration_error", { reason: "env_unreadable" });
    fallback = {};
  }
  const effective = { ...fallback, ...local, ...process.env };
  if (
    local.CONVEX_DEPLOYMENT !== deployment ||
    local.NEXT_PUBLIC_CONVEX_URL !== publicUrl ||
    (local.CONVEX_URL && local.CONVEX_URL !== publicUrl) ||
    (process.env.CONVEX_DEPLOYMENT && process.env.CONVEX_DEPLOYMENT !== deployment) ||
    (process.env.NEXT_PUBLIC_CONVEX_URL && process.env.NEXT_PUBLIC_CONVEX_URL !== publicUrl) ||
    (process.env.CONVEX_URL && process.env.CONVEX_URL !== publicUrl)
  ) {
    return finish("configuration_error", { reason: "deployment_mismatch" });
  }
  if (forbiddenOverrides.some((key) => effective[key])) {
    return finish("configuration_error", { reason: "conflicting_override" });
  }
  let token;
  try {
    const config = JSON.parse(await readFile(join(homedir(), ".convex/config.json"), "utf8"));
    token = config.accessToken;
    if (token === undefined || token === null || token === "") {
      return finish("login_required", { reason: "local_token_absent" });
    }
    if (typeof token !== "string" || !token.trim()) {
      return finish("configuration_error", { reason: "global_config_invalid" });
    }
  } catch (error) {
    return error.code === "ENOENT"
      ? finish("login_required", { reason: "local_token_absent" })
      : finish("configuration_error", { reason: "global_config_unreadable" });
  }

  emit({ ...base, status: "preflight_started" });
  const cli = runCli(["login", "status"]);
  const cliLoginStatus = cli.ok && /Status: Logged in\b/.test(cli.output)
    ? "authenticated"
    : "inconclusive";
  let lookup;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      lookup = { httpStatus: response.status, attempts: attempt, cliLoginStatus };
      if (response.status === 401) {
        lookup = { ...lookup, status: "login_required", reason: "token_rejected" };
      } else if (response.ok) {
        const body = await response.json();
        lookup = typeof body.team === "string" && body.team.trim() &&
          typeof body.project === "string" && body.project.trim()
          ? { ...lookup, status: "ready", reason: "project_access_verified" }
          : { ...lookup, status: "access_unverified", reason: "invalid_project_response" };
      } else {
        lookup = {
          ...lookup,
          status: "access_unverified",
          reason: response.status === 403 || response.status === 404
            ? "project_access_denied"
            : "project_lookup_failed",
        };
      }
    } catch {
      lookup = {
        status: "access_unverified",
        reason: "project_lookup_failed",
        attempts: attempt,
        cliLoginStatus,
      };
    }
    if (lookup.status === "ready") break;
  }
  const { status, ...fields } = lookup;
  return finish(status, fields);
}

function classifySyncFailure(output, timedOut) {
  if (/schema (?:validation|change)|does not match the (?:schema|validator)|schema.*not valid|SchemaValidationError/i.test(output)) {
    const table = output.match(/(?:table\s+["'`]?)([A-Za-z][A-Za-z0-9_]{0,63})/i)?.[1];
    const field = output.match(/(?:Path|field):?\s+["'`]?\.?([A-Za-z][A-Za-z0-9_.]{0,127})/i)?.[1];
    return { status: "schema_error", reason: "schema_validation_failed", ...(table ? { table } : {}), ...(field ? { field } : {}) };
  }
  if (/non.interactive|cannot prompt|could not prompt|configure|choose.*project|select.*project/i.test(output)) {
    return { status: "configuration_error", reason: "noninteractive_configuration_required" };
  }
  return { status: "sync_failed", reason: timedOut ? "sync_timeout" : "cli_failed" };
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.length !== 1 || !["check", "sync"].includes(args[0])) {
    emit({ status: "usage_error", reason: "expected_check_or_sync" });
    process.exitCode = 1;
    return;
  }
  const before = await preflight();
  if (before.status !== "ready") {
    process.exitCode = 1;
    return;
  }
  if (args[0] === "check") return;
  const envBefore = await readFile(join(process.cwd(), ".env.local"), "utf8");
  emit({ status: "sync_started", envLocalExists: true, deployment, publicUrl });
  const sync = runCli([
    "dev", "--once", "--tail-logs", "disable",
  ], 120_000);
  const envAfter = await readFile(join(process.cwd(), ".env.local"), "utf8").catch(() => null);
  if (envAfter !== envBefore) {
    emit({ status: "configuration_error", reason: "env_local_changed", deployment });
    process.exitCode = 1;
    return;
  }
  if (sync.ok) {
    emit({ status: "synced", deployment });
    return;
  }
  const failure = classifySyncFailure(sync.output, sync.timedOut);
  if (failure.status === "sync_failed" || failure.status === "configuration_error") {
    const after = await preflight();
    if (after.status !== "ready") {
      process.exitCode = 1;
      return;
    }
  }
  emit({ ...failure, deployment });
  process.exitCode = 1;
}

await main().catch(() => {
  emit({ status: "check_failed", reason: "unexpected_error" });
  process.exitCode = 1;
});
