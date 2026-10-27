import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main, manifestHash, parseManifest, planOwnership, safeInventory, validateEnvironment } from "../scripts/event-ownership.mjs";

const deployment = "giant-egret-456";
const row = { eventId: "event-one", slug: "history", expectedOrganizationId: null, organizationId: "org_outpost" };
const manifest = { deployment, rows: [row] };
const raw = [{ _id: row.eventId, slug: row.slug, name: "History", adminToken: "secret-admin-token", meetUrl: "secret-meet-url", email: "secret-email" }];

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "event-ownership-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, ".env.local"), "CONVEX_DEPLOYMENT=dev:precious-elk-564\nNEXT_PUBLIC_CONVEX_URL=https://precious-elk-564.convex.cloud\n");
  mkdirSync(join(cwd, "node_modules/convex/bin"), { recursive: true });
  writeFileSync(join(cwd, "node_modules/convex/bin/main.js"), "");
  const path = join(cwd, "manifest.json");
  writeFileSync(path, JSON.stringify(manifest));
  const calls = [];
  const output = [];
  const options = { cwd, env: {}, emit: (value) => output.push(value), run: (exec, args, options) => { calls.push({ exec, args, options }); return { status: 0, stdout: JSON.stringify(raw) }; } };
  return { cwd, path, calls, output, options };
}

test("manifest validation rejects duplicates, unknown fields, foreign transfers and wrong deployments", () => {
  assert.deepEqual(parseManifest(manifest, deployment), manifest);
  for (const value of [
    { ...manifest, rows: [row, row] },
    { ...manifest, rows: [{ ...row, adminToken: "secret" }] },
    { ...manifest, rows: [{ ...row, organizationId: "bad" }] },
    { ...manifest, rows: [{ ...row, expectedOrganizationId: "org_foreign" }] },
    { ...manifest, deployment: "wrong" },
    { ...manifest, rows: [] },
    { ...manifest, rows: Array.from({ length: 101 }, () => row) },
  ]) assert.throws(() => parseManifest(value, deployment));
  assert.throws(() => parseManifest(manifest, "precious-elk-564"), /manifest_deployment_mismatch/);
});

test("inventory strips all private fields and fails closed at the read limit", () => {
  assert.deepEqual(safeInventory(raw), [{ eventId: row.eventId, name: "History", slug: row.slug, organizationId: null }]);
  assert.throws(() => safeInventory(Array.from({ length: 1000 }, () => raw[0])), /inventory_limit_reached/);
  assert.throws(() => safeInventory([{ ...raw[0], workosOrganizationId: "wrong" }]), /invalid_inventory/);
});

test("local plans are idempotent and preserve input records", () => {
  const before = structuredClone(raw);
  assert.deepEqual(planOwnership(manifest, safeInventory(raw)), [{ ...row, currentOrganizationId: null, kind: "change" }]);
  assert.deepEqual(planOwnership(manifest, safeInventory([{ ...raw[0], workosOrganizationId: row.organizationId }])), [{ ...row, currentOrganizationId: row.organizationId, kind: "noop" }]);
  assert.deepEqual(raw, before);
  assert.throws(() => planOwnership(manifest, []), /event_identity_precondition_failed/);
  assert.throws(() => planOwnership(manifest, safeInventory([{ ...raw[0], workosOrganizationId: "org_foreign" }])), /event_ownership_precondition_failed/);
});

test("production plan defaults to a single readonly command and safe output", (t) => {
  const f = fixture(t);
  main(["plan", "--prod", "--manifest", f.path], f.options);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].args.slice(1, 7), ["data", "events", "--limit", "1000", "--format", "json"]);
  assert.deepEqual(f.calls[0].args.slice(7), ["--deployment-name", deployment, "--env-file", join(f.cwd, ".env.local")]);
  assert.equal(f.output.at(-1).dryRun, true);
  assert.equal(f.output.at(-1).manifestSha256, manifestHash(manifest));
  assert.doesNotMatch(JSON.stringify(f.output), /secret/);
});

test("production apply requires exact reviewed manifest hash before any command", (t) => {
  const f = fixture(t);
  for (const extra of [[], ["--approved-manifest-sha256", "wrong"]]) {
    assert.throws(() => main(["plan", "--prod", "--manifest", f.path, "--apply", ...extra], f.options), /matching_manifest_approval_required/);
  }
  assert.equal(f.calls.length, 0);
  assert.throws(() => main(["plan", "--prod", "--manifest", f.path, "--approved-manifest-sha256", manifestHash(manifest)], f.options), /approval_requires_apply/);
  main(["plan", "--prod", "--manifest", f.path, "--apply", "--approved-manifest-sha256", manifestHash(manifest)], f.options);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].args[1], "run");
  assert.equal(f.calls[1].args[2], "eventOwnership:assign");
  assert.deepEqual(JSON.parse(f.calls[1].args[3]), { rows: manifest.rows, dryRun: false });
  assert.ok(!f.calls[1].args.includes("--push"));
});

test("missing environment, noncanonical selectors and credential overrides stop before commands", (t) => {
  const f = fixture(t);
  assert.throws(() => main(["inventory"], f.options), /explicit_selector_required/);
  assert.throws(() => main(["inventory", "--dev", "--prod"], f.options), /conflicting_selector/);
  assert.throws(() => main(["inventory", "--deployment-name", "wrong"], f.options), /unknown_flag/);
  assert.throws(() => validateEnvironment({ cwd: f.cwd, env: { CONVEX_DEPLOY_KEY: "secret" } }), /conflicting_override/);
  writeFileSync(join(f.cwd, ".env"), "CONVEX_DEPLOYMENT=dev:wrong\n");
  assert.throws(() => main(["inventory", "--prod"], f.options), /deployment_mismatch/);
  rmSync(join(f.cwd, ".env.local"));
  assert.throws(() => main(["inventory", "--prod"], f.options), /env_local_missing/);
  assert.equal(f.calls.length, 0);
});

test("credentialed command failure exposes only an allowlisted reason", (t) => {
  const f = fixture(t);
  const options = { ...f.options, run: () => ({ status: 1, stdout: "secret-token", stderr: "secret-admin-token" }) };
  assert.throws(() => main(["inventory", "--prod"], options), { message: "convex_command_failed" });
  assert.doesNotMatch(JSON.stringify(f.output), /secret/);
});
