import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/convex-dev.mjs", import.meta.url));
const canonicalEnv = "CONVEX_DEPLOYMENT=dev:precious-elk-564\nNEXT_PUBLIC_CONVEX_URL=https://precious-elk-564.convex.cloud\n";
const secret = "private-token-that-must-never-be-printed";

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "convex-dev-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".convex"));
  await mkdir(join(root, "node_modules/convex/bin"), { recursive: true });
  if (options.env !== null) await writeFile(join(root, ".env.local"), options.env ?? canonicalEnv);
  if (options.fallbackEnv) await writeFile(join(root, ".env"), options.fallbackEnv);
  if (options.token !== null) {
    await writeFile(join(root, ".convex/config.json"), options.config ?? JSON.stringify({ accessToken: secret }));
  }
  const callsFile = join(root, "calls.jsonl");
  await writeFile(join(root, "node_modules/convex/bin/main.js"), [
    "const fs = require('node:fs');",
    "fs.appendFileSync(" + JSON.stringify(callsFile) + ", JSON.stringify({ args: process.argv.slice(2), deployment: process.env.CONVEX_DEPLOYMENT }) + '\\n');",
    "if (process.argv[2] === 'login') {",
    "console.error(" + JSON.stringify(options.loginOutput ?? "Status: Logged in\n" + secret) + ");",
    "process.exit(" + (options.loginExit ?? 0) + "); }",
    options.changeEnv ? "fs.appendFileSync('.env.local', '\\nCHANGED=true\\n');" : "",
    "console.error(" + JSON.stringify(options.syncOutput ?? secret) + ");",
    "process.exit(" + (options.syncExit ?? 0) + ");",
  ].join("\n"));
  const preload = join(root, "fetch.mjs");
  await writeFile(preload, [
    "import { appendFileSync } from 'node:fs';",
    "const replies = " + JSON.stringify(options.replies ?? [200]) + ";",
    "let count = 0;",
    "globalThis.fetch = async (url, init) => {",
    "if (url !== 'https://api.convex.dev/api/deployment/precious-elk-564/team_and_project') throw Error('wrong URL');",
    "if (init.headers.Authorization !== 'Bearer " + secret + "' || init.redirect !== 'error' || !init.signal) throw Error('unsafe request');",
    "const status = replies[Math.min(count++, replies.length - 1)];",
    "appendFileSync(" + JSON.stringify(callsFile) + ", JSON.stringify({ lookup: status }) + '\\n');",
    "if (status === 'network') throw Error('" + secret + " private error');",
    "return { status, ok: status === 200, json: async () => (" + JSON.stringify(options.body ?? { team: "team", project: "demo-queue" }) + ") };",
    "};",
  ].join("\n"));
  const env = { ...process.env, HOME: root, USERPROFILE: root, NODE_OPTIONS: "" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("CONVEX_") || key.startsWith("NEXT_PUBLIC_CONVEX_")) delete env[key];
  }
  const run = async (command = "check", overrides = {}) => {
    const result = spawnSync(process.execPath, ["--import", preload, "--", script, ...(Array.isArray(command) ? command : [command])], {
      cwd: root, env: { ...env, ...overrides }, encoding: "utf8", timeout: 8_000,
    });
    assert.ifError(result.error);
    assert.equal(result.stderr, "");
    assert.ok(!result.stdout.includes(secret), "credentials and child output must stay private");
    const reports = result.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const rows = reports.filter((row) => row.status !== "preflight_started");
    const calls = await readFile(callsFile, "utf8").catch(() => "");
    return { code: result.status, rows, reports, calls: calls.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
  };
  return { run, root };
}

test("check uses shared credentials and retries stale lookup once", async (t) => {
  const { run, root } = await fixture(t, { replies: [404, 200], loginOutput: "Status: Not logged in " + secret });
  const result = await run();
  assert.equal(result.code, 0);
  assert.equal(result.rows[0].status, "ready");
  assert.equal(result.rows[0].cliLoginStatus, "inconclusive");
  assert.equal(result.rows[0].attempts, 2);
  assert.equal(result.reports[0].status, "preflight_started");
  assert.equal(result.reports[0].envLocalExists, true);
  assert.equal(result.reports[0].deployment, "dev:precious-elk-564");
  assert.ok(!Number.isNaN(Date.parse(result.rows[0].checkedAt)));
  assert.deepEqual(result.calls.map((call) => call.lookup ?? call.args), [["login", "status"], 404, 200]);
  assert.equal(await readFile(join(root, ".env.local"), "utf8"), canonicalEnv);
});

for (const [reply, status, reason] of [
  [401, "login_required", "token_rejected"],
  [403, "access_unverified", "project_access_denied"],
  [404, "access_unverified", "project_access_denied"],
  ["network", "access_unverified", "project_lookup_failed"],
]) {
  test(String(reply) + " is classified safely and never permits sync", async (t) => {
    const { run } = await fixture(t, { replies: [reply] });
    const result = await run("sync");
    assert.equal(result.code, 1);
    assert.equal(result.rows.at(-1).status, status);
    assert.equal(result.rows.at(-1).reason, reason);
    assert.equal(result.calls.filter((call) => "lookup" in call).length, 2);
    assert.ok(result.calls.every((call) => call.args?.[0] !== "dev"));
  });
}

for (const [name, options, reason] of [
  ["missing env", { env: null }, "env_local_missing"],
  ["wrong deployment", { env: canonicalEnv.replace("dev:precious-elk-564", "prod:giant-egret-456") }, "deployment_mismatch"],
  ["wrong public URL", { env: canonicalEnv.replace("precious-elk-564.convex.cloud", "wrong.convex.cloud") }, "deployment_mismatch"],
  ["local secret override", { env: canonicalEnv + "CONVEX_DEPLOY_KEY=" + secret }, "conflicting_override"],
  ["local token alias", { env: canonicalEnv + "CONVEX_DEPLOYMENT_TOKEN=" + secret }, "conflicting_override"],
  ["fallback deployment key", { fallbackEnv: "CONVEX_DEPLOY_KEY=" + secret }, "conflicting_override"],
  ["fallback token alias", { fallbackEnv: "CONVEX_DEPLOYMENT_TOKEN=" + secret }, "conflicting_override"],
  ["malformed global config", { config: "{" + secret }, "global_config_unreadable"],
]) {
  test(name + " blocks before any command or request", async (t) => {
    const { run } = await fixture(t, options);
    const result = await run("sync");
    assert.equal(result.code, 1);
    assert.equal(result.rows[0].status, "configuration_error");
    assert.equal(result.rows[0].reason, reason);
    assert.deepEqual(result.calls, []);
  });
}

test("process deployment token alias blocks before any request or command", async (t) => {
  const { run } = await fixture(t);
  const result = await run("sync", { CONVEX_DEPLOYMENT_TOKEN: secret });
  assert.equal(result.rows[0].reason, "conflicting_override");
  assert.deepEqual(result.calls, []);
});

test("missing local token is the only local login blocker", async (t) => {
  const { run } = await fixture(t, { token: null });
  const result = await run("sync");
  assert.equal(result.rows[0].status, "login_required");
  assert.equal(result.rows[0].reason, "local_token_absent");
  assert.deepEqual(result.calls, []);
});

test("process secret overrides and target conflicts fail closed", async (t) => {
  const { run } = await fixture(t);
  for (const override of [
    { CONVEX_OVERRIDE_ACCESS_TOKEN: secret },
    { CONVEX_DEPLOY_KEY: secret },
    { CONVEX_PROVISION_HOST: "https://wrong.example" },
    { CONVEX_DEPLOYMENT: "dev:wrong" },
  ]) {
    const result = await run("sync", override);
    assert.equal(result.rows[0].status, "configuration_error");
    assert.deepEqual(result.calls, []);
  }
});

test("sync runs only the canonical existing development command", async (t) => {
  const { run } = await fixture(t);
  const result = await run("sync");
  assert.equal(result.code, 0);
  assert.equal(result.rows.at(-1).status, "synced");
  assert.deepEqual(result.calls.at(-1), {
    args: ["dev", "--once", "--tail-logs", "disable"], deployment: "dev:precious-elk-564",
  });
});

test("generic auth-looking sync failure gets a fresh successful preflight", async (t) => {
  const { run } = await fixture(t, { replies: [200, 404, 200], syncExit: 1, syncOutput: "Not logged in " + secret });
  const result = await run("sync");
  assert.equal(result.code, 1);
  assert.deepEqual(result.rows.map((row) => row.status), ["ready", "sync_started", "ready", "sync_failed"]);
  assert.notEqual(result.rows[0].checkedAt, result.rows[2].checkedAt);
  assert.equal(result.calls.filter((call) => call.args?.[0] === "login").length, 2);
});

test("fresh definitive rejection after sync failure reports login required", async (t) => {
  const { run } = await fixture(t, { replies: [200, 401, 401], syncExit: 1 });
  const result = await run("sync");
  assert.equal(result.rows.at(-1).status, "login_required");
  assert.equal(result.rows.at(-1).attempts, 2);
});

test("noninteractive configuration prompt remains a configuration error", async (t) => {
  const { run } = await fixture(t, { syncExit: 1, syncOutput: "Cannot prompt for input in non-interactive terminals. Choose project. " + secret });
  const result = await run("sync");
  assert.equal(result.rows.at(-1).status, "configuration_error");
  assert.equal(result.rows.at(-1).reason, "noninteractive_configuration_required");
});

test("schema failure prints only table and field diagnostics", async (t) => {
  const { run } = await fixture(t, { syncExit: 1, syncOutput: "Schema validation failed. Document in table events does not match the validator. Path: .organizationId\nObject: {email: 'person@example.com', token: '" + secret + "'}" });
  const result = await run("sync");
  assert.equal(result.rows.at(-1).status, "schema_error");
  assert.equal(result.rows.at(-1).table, "events");
  assert.equal(result.rows.at(-1).field, "organizationId");
  assert.ok(!JSON.stringify(result.rows).includes("person@example.com"));
  assert.equal(result.calls.filter((call) => "lookup" in call).length, 1);
});

test("unexpected env mutation fails without overwriting the user's file", async (t) => {
  const { run, root } = await fixture(t, { changeEnv: true });
  const result = await run("sync");
  assert.equal(result.rows.at(-1).reason, "env_local_changed");
  assert.match(await readFile(join(root, ".env.local"), "utf8"), /CHANGED=true/);
});

test("invalid project response cannot permit writes", async (t) => {
  const { run } = await fixture(t, { body: { error: secret } });
  const result = await run("sync");
  assert.equal(result.rows.at(-1).status, "access_unverified");
  assert.equal(result.rows.at(-1).reason, "invalid_project_response");
  assert.ok(result.calls.every((call) => call.args?.[0] !== "dev"));
});

test("watch uses only the existing canonical development command", async (t) => {
  const { run } = await fixture(t, { syncOutput: "Convex functions ready! " + secret });
  const result = await run("watch");
  assert.equal(result.code, 0);
  assert.deepEqual(result.rows.map((row) => row.status), ["ready", "watch_started", "watch_ready", "watch_stopped"]);
  assert.deepEqual(result.calls.at(-1), { args: ["dev"], deployment: "dev:precious-elk-564" });
});

for (const command of [["check", "--prod"], ["sync", "--configure"], ["watch", "--prod"], ["watch", "--env-file", "other.env"]]) {
  test(command.join(" ") + " cannot forward target or configuration arguments", async (t) => {
    const { run } = await fixture(t);
    const result = await run(command);
    assert.equal(result.rows[0].status, "usage_error");
    assert.deepEqual(result.calls, []);
  });
}

test("development scripts reject Node options and never forward deployment flags", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["dev:convex"], "node -- scripts/convex-dev.mjs watch");
  assert.equal(pkg.scripts["convex:check"], "node -- scripts/convex-dev.mjs check");
  assert.equal(pkg.scripts["convex:sync"], "node -- scripts/convex-dev.mjs sync");
  assert.equal(pkg.scripts["convex:dev"], "pnpm dev:convex");
  assert.ok(pkg.scripts.dev.includes("pnpm dev:convex"));
});
