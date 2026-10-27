#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";

const deployments = { "--prod": "giant-egret-456", "--dev": "precious-elk-564" };
const organization = z.string().regex(/^org_[A-Za-z0-9]+$/);
const rowSchema = z.object({ eventId: z.string().min(1), slug: z.string().min(1), expectedOrganizationId: organization.nullable(), organizationId: organization }).strict();
const manifestSchema = z.object({ deployment: z.enum(["giant-egret-456", "precious-elk-564"]), rows: z.array(rowSchema).min(1).max(100) }).strict();
const inventorySchema = z.array(z.object({ _id: z.string(), name: z.string(), slug: z.string(), workosOrganizationId: organization.optional() }));
const forbidden = ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_OVERRIDE_ACCESS_TOKEN", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_PROVISION_HOST", "CONVEX_AGENT_MODE"];

function fail(reason) { throw new Error(reason); }

export function parseManifest(value, deployment) {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) fail("invalid_manifest");
  const manifest = parsed.data;
  if (manifest.deployment !== deployment) fail("manifest_deployment_mismatch");
  const ids = new Set();
  for (const row of manifest.rows) {
    if (ids.has(row.eventId)) fail("duplicate_event_id");
    ids.add(row.eventId);
    if (row.expectedOrganizationId !== null && row.expectedOrganizationId !== row.organizationId) fail("ownership_reassignment_forbidden");
  }
  return manifest;
}

export function manifestHash(manifest) {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export function safeInventory(value) {
  const parsed = inventorySchema.safeParse(value);
  if (!parsed.success) fail("invalid_inventory");
  if (parsed.data.length >= 1000) fail("inventory_limit_reached");
  return parsed.data.map((event) => ({ eventId: event._id, name: event.name, slug: event.slug, organizationId: event.workosOrganizationId ?? null }));
}

export function planOwnership(manifest, inventory) {
  return manifest.rows.map((row) => {
    const event = inventory.find((event) => event.eventId === row.eventId);
    if (!event || event.slug !== row.slug) fail("event_identity_precondition_failed");
    const kind = event.organizationId === row.organizationId ? "noop" : "change";
    if (kind === "change" && (event.organizationId !== row.expectedOrganizationId || event.organizationId !== null)) fail("event_ownership_precondition_failed");
    return { ...row, currentOrganizationId: event.organizationId, kind };
  });
}

export function validateEnvironment({ cwd, env }) {
  const envPath = join(cwd, ".env.local");
  if (!existsSync(envPath)) fail("env_local_missing");
  let local;
  let fallback;
  try {
    local = parseEnv(readFileSync(envPath, "utf8"));
    fallback = existsSync(join(cwd, ".env")) ? parseEnv(readFileSync(join(cwd, ".env"), "utf8")) : {};
  } catch { fail("env_unreadable"); }
  for (const source of [fallback, local, env]) {
    if (forbidden.some((key) => source[key])) fail("conflicting_override");
    if (source.CONVEX_DEPLOYMENT && !/^(dev:precious-elk-564|prod:giant-egret-456)$/.test(source.CONVEX_DEPLOYMENT)) fail("deployment_mismatch");
    for (const key of ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL"]) {
      if (source[key] && !["https://precious-elk-564.convex.cloud", "https://giant-egret-456.convex.cloud"].includes(source[key])) fail("deployment_mismatch");
    }
  }
  if (!local.CONVEX_DEPLOYMENT) fail("deployment_missing");
  const expectedUrl = `https://${local.CONVEX_DEPLOYMENT.split(":")[1]}.convex.cloud`;
  if (local.NEXT_PUBLIC_CONVEX_URL !== expectedUrl || (local.CONVEX_URL && local.CONVEX_URL !== expectedUrl)) fail("deployment_mismatch");
  if (env.CONVEX_DEPLOYMENT && env.CONVEX_DEPLOYMENT !== local.CONVEX_DEPLOYMENT) fail("conflicting_environment");
  for (const key of ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL"]) {
    if (env[key] && env[key] !== expectedUrl) fail("conflicting_environment");
  }
  return envPath;
}

const help = `Usage:
  node scripts/event-ownership.mjs inventory --prod|--dev
  node scripts/event-ownership.mjs plan --prod|--dev --manifest FILE
  node scripts/event-ownership.mjs plan --prod|--dev --manifest FILE --apply --approved-manifest-sha256 HASH

Manifest JSON has deployment and rows. Each row has eventId, slug,
expectedOrganizationId (null for unowned), and organizationId (org_...).
Only explicit unowned assignments and already-target noops are allowed.
Plan is read-only by default. Review its complete rows and SHA-256 before apply.
Apply requires an already-deployed eventOwnership:assign internal mutation.
This tool never deploys functions, configures Convex, or starts authentication.
Production writes require separate explicit authorization for that manifest.
Existing canonical .env.local and authorized Convex CLI access are required.
`;

export function main(argv, { cwd = process.cwd(), env = process.env, run = spawnSync, emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`) } = {}) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) { process.stdout.write(help); return; }
  const [command, ...flags] = argv;
  if (!["inventory", "plan"].includes(command)) fail("invalid_command");
  let deployment;
  let manifestPath;
  let apply = false;
  let approvedHash;
  const seen = new Set();
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (seen.has(flag)) fail("duplicate_flag");
    seen.add(flag);
    if (Object.hasOwn(deployments, flag)) { if (deployment) fail("conflicting_selector"); deployment = deployments[flag]; }
    else if (flag === "--manifest") manifestPath = flags[++i];
    else if (flag === "--apply") apply = true;
    else if (flag === "--approved-manifest-sha256") approvedHash = flags[++i];
    else fail("unknown_flag");
  }
  if (!deployment) fail("explicit_selector_required");
  if (command === "inventory" && (manifestPath || apply || approvedHash)) fail("invalid_inventory_flags");
  if (approvedHash && !apply) fail("approval_requires_apply");
  let manifest;
  let hash;
  if (command === "plan") {
    if (!manifestPath) fail("manifest_required");
    let value;
    try { value = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { fail("manifest_unreadable"); }
    manifest = parseManifest(value, deployment);
    hash = manifestHash(manifest);
    if (apply && approvedHash !== hash) fail("matching_manifest_approval_required");
  }
  const envPath = validateEnvironment({ cwd, env });
  const cli = join(cwd, "node_modules/convex/bin/main.js");
  if (!existsSync(cli)) fail("convex_cli_missing");
  const execute = (args) => {
    emit({ status: "preflight", envLocalExists: true, deployment, selector: `--deployment-name ${deployment}` });
    const result = run(process.execPath, [cli, ...args, "--deployment-name", deployment, "--env-file", envPath], { cwd, env: { ...env, CI: "1", CONVEX_ALLOW_ANONYMOUS: "false" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error || result.status !== 0) fail("convex_command_failed");
    return result.stdout;
  };
  let raw;
  try { raw = JSON.parse(execute(["data", "events", "--limit", "1000", "--format", "json"])); } catch (error) { if (error.message === "convex_command_failed") throw error; fail("invalid_inventory_output"); }
  const inventory = safeInventory(raw);
  if (command === "inventory") { emit({ status: "inventory", deployment, rows: inventory }); return; }
  const rows = planOwnership(manifest, inventory);
  emit({ status: "plan", deployment, dryRun: !apply, manifestSha256: hash, rows });
  if (apply) {
    execute(["run", "eventOwnership:assign", JSON.stringify({ rows: manifest.rows, dryRun: false })]);
    emit({ status: "applied", deployment, manifestSha256: hash });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) {
    const reasons = new Set(["invalid_manifest", "manifest_deployment_mismatch", "duplicate_event_id", "ownership_reassignment_forbidden", "invalid_inventory", "inventory_limit_reached", "event_identity_precondition_failed", "event_ownership_precondition_failed", "env_local_missing", "env_unreadable", "conflicting_override", "deployment_mismatch", "deployment_missing", "conflicting_environment", "invalid_command", "duplicate_flag", "conflicting_selector", "unknown_flag", "explicit_selector_required", "invalid_inventory_flags", "approval_requires_apply", "manifest_required", "manifest_unreadable", "matching_manifest_approval_required", "convex_cli_missing", "convex_command_failed", "invalid_inventory_output"]);
    process.stderr.write(`${JSON.stringify({ status: "error", reason: reasons.has(error.message) ? error.message : "operation_failed" })}\n`);
    process.exitCode = 1;
  }
}
