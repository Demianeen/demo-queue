import assert from "node:assert/strict";
import { chdir } from "node:process";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  localProcessEnv,
  parseArgs,
  parseAdminUrl,
  readLocalEnv,
  toModelContext,
  trustedDeploymentFlags,
  runConvex,
  loadAdmin,
} from "../scripts/demo-queue-ops.mjs";

function withTempCwd(fn) {
  const previousCwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "demo-queue-env-"));
  chdir(dir);
  try {
    fn();
  } finally {
    chdir(previousCwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("readLocalEnv handles Convex generated inline comments", () => {
  withTempCwd(() => {
    writeFileSync(
      ".env.local",
      [
        "CONVEX_DEPLOYMENT=dev:precious-elk-564 # team: feliche-demian-netliukh, project: demo-queue",
        'QUOTED_VALUE="keep # inside quotes"',
      ].join("\n"),
    );

    assert.deepEqual(readLocalEnv(), {
      CONVEX_DEPLOYMENT: "dev:precious-elk-564",
      QUOTED_VALUE: "keep # inside quotes",
    });
  });
});

test("localProcessEnv preserves canonical configuration and allows unrelated overrides", () => {
  withTempCwd(() => {
    writeFileSync(
      ".env",
      [
        "CONVEX_DEPLOYMENT=dev:precious-elk-564",
        "DEMO_QUEUE_SITE_URL=https://from-env.example",
      ].join("\n"),
    );
    writeFileSync(
      ".env.local",
      [
        "CONVEX_DEPLOYMENT=dev:precious-elk-564",
        "DEMO_QUEUE_SITE_URL=https://from-local.example",
      ].join("\n"),
    );

    assert.equal(readLocalEnv().CONVEX_DEPLOYMENT, "dev:precious-elk-564");
    assert.equal(readLocalEnv().DEMO_QUEUE_SITE_URL, "https://from-local.example");

    const env = localProcessEnv({
      CONVEX_DEPLOYMENT: "dev:precious-elk-564",
      DEMO_QUEUE_SITE_URL: "https://from-process.example",
    });

    assert.equal(env.CONVEX_DEPLOYMENT, "dev:precious-elk-564");
    assert.equal(env.DEMO_QUEUE_SITE_URL, "https://from-process.example");
  });
});

test("process overrides and masked wrong env files cannot select another deployment", () => {
  withTempCwd(() => {
    writeFileSync(".env.local", "CONVEX_DEPLOYMENT=dev:precious-elk-564\n");
    assert.throws(() => localProcessEnv({ CONVEX_DEPLOYMENT: "prod:giant-egret-456" }), /conflicting/);
    writeFileSync(".env", "CONVEX_DEPLOYMENT=dev:anonymous\n");
    assert.throws(() => localProcessEnv({}), /not canonical/);
    writeFileSync(".env", "CONVEX_OVERRIDE_ACCESS_TOKEN=must-not-print\n");
    assert.throws(() => localProcessEnv({}), /conflicting/);
  });
});

test("parseAdminUrl keeps the workspace admin origin without a capability", () => {
  assert.deepEqual(
    parseAdminUrl("https://demo-queue-tau.vercel.app/events/event-slug/admin"),
    {
      slug: "event-slug",
      adminSiteUrl: "https://demo-queue-tau.vercel.app",
    },
  );
});

test("legacy URLs and admin token arguments are rejected before fetching data", () => {
  assert.throws(() => parseAdminUrl("https://demo-queue-tau.vercel.app/admin/event/leaked-token"), /no longer supported/);
  assert.throws(() => parseArgs(["snapshot", "--admin-token", "leaked-token"]), /no longer supported/);
});

test("CLI queue fallback requires an explicit canonical selector or configured canonical development", () => {
  assert.throws(() => trustedDeploymentFlags({}, {}), /not configured/);
  assert.throws(() => trustedDeploymentFlags({ deployment: "anonymous-other" }, {}), /canonical/);
  assert.throws(() => trustedDeploymentFlags({ prod: true }, { CONVEX_DEPLOYMENT: "dev:anonymous-other" }), /not canonical/);
  assert.deepEqual(trustedDeploymentFlags({}, { CONVEX_DEPLOYMENT: "dev:precious-elk-564" }, true), ["--deployment-name", "precious-elk-564"]);
  assert.deepEqual(trustedDeploymentFlags({ prod: true }, {}, false), ["--deployment-name", "giant-egret-456"]);
  assert.deepEqual(trustedDeploymentFlags({ deployment: "precious-elk-564" }, {}, false), ["--deployment-name", "precious-elk-564"]);
});

test("remote admin locators require an explicit deployment and production locators reject development", async () => {
  const env = { CONVEX_DEPLOYMENT: "dev:precious-elk-564" };
  let calls = 0;
  const options = { env, envLocalExists: true, run: () => { calls++; throw new Error("must not run"); } };
  const production = parseAdminUrl("https://demo-queue-tau.vercel.app/events/night/admin");
  await assert.rejects(loadAdmin(production, options), /explicit canonical/);
  await assert.rejects(loadAdmin({ ...production, deployment: "precious-elk-564" }, options), /conflicts/);
  await assert.rejects(loadAdmin({ ...parseAdminUrl("https://production.example/events/night/admin"), deployment: "precious-elk-564" }, { ...options, env: { ...env, VERCEL_PROJECT_PRODUCTION_URL: "production.example" } }), /conflicts/);
  await assert.rejects(loadAdmin({ ...parseAdminUrl("https://preview.example/events/night/admin") }, options), /explicit canonical/);
  assert.equal(calls, 0);
  assert.deepEqual(trustedDeploymentFlags(parseAdminUrl("http://localhost:3000/events/night/admin"), env, true), ["--deployment-name", "precious-elk-564"]);
  assert.deepEqual(trustedDeploymentFlags(parseAdminUrl("http://127.0.0.1:3000/events/night/admin"), env, true), ["--deployment-name", "precious-elk-564"]);
});

test("production reads use explicit canonical names and emit only safe command diagnostics", async () => {
  const calls = [];
  const diagnostics = [];
  const admin = await loadAdmin({ prod: true, ...parseAdminUrl("https://demo-queue-tau.vercel.app/events/night/admin") }, {
    env: { CONVEX_DEPLOYMENT: "dev:precious-elk-564", NEXT_PUBLIC_CONVEX_URL: "https://precious-elk-564.convex.cloud" },
    envLocalExists: true,
    diagnostic: (line) => diagnostics.push(JSON.parse(line)),
    run: (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: JSON.stringify(args.includes("events") ? [{ _id: "event1", slug: "night", name: "Night", queuePublished: false }] : []), stderr: "" };
    },
  });
  assert.equal(admin.event.slug, "night");
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.command, "pnpm");
    assert.deepEqual(call.args.slice(-2), ["--deployment-name", "giant-egret-456"]);
    assert.equal(call.args.includes("--prod"), false);
  }
  assert.deepEqual(diagnostics, Array(2).fill({ envLocalExists: true, selector: "--deployment-name giant-egret-456" }));
});

test("wrong environments and credential overrides stop before spawning Convex", async () => {
  const badEnvironments = [
    { CONVEX_DEPLOYMENT: "dev:anonymous" },
    { NEXT_PUBLIC_CONVEX_URL: "https://anonymous.convex.cloud" },
    { CONVEX_DEPLOYMENT: "dev:precious-elk-564", CONVEX_URL: "https://giant-egret-456.convex.cloud" },
    ...["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_OVERRIDE_ACCESS_TOKEN", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_PROVISION_HOST", "CONVEX_AGENT_MODE"].map((key) => ({ [key]: "must-not-print" })),
  ];
  let calls = 0;
  for (const env of badEnvironments) await assert.rejects(loadAdmin({ prod: true }, { env, envLocalExists: true, run: () => { calls++; } }), /stopped|override/);
  assert.equal(calls, 0);
});

test("CLI failures and invalid JSON never echo captured credentials or raw output", () => {
  for (const result of [{ status: 7, stdout: "secret-stdout", stderr: "secret-stderr" }, { status: 0, stdout: "secret-json", stderr: "" }]) {
    assert.throws(() => runConvex(["data", "events", "--deployment-name", "giant-egret-456"], { env: {}, envLocalExists: false, diagnostic: () => {}, run: () => result }), (error) => {
      assert.match(error.message, /cli_failed, exit=7|invalid_json/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  }
});

test("toModelContext returns data for model ranking without helper scores", () => {
  const context = toModelContext({
    event: {
      id: "event-id",
      name: "Demo Night",
      slug: "demo-night",
      lineupTarget: 5,
      queuePublished: true,
      adminToken: "secret-admin-token",
    },
    lineup: [
      {
        id: "queued-id",
        name: "Queued Person",
        demoTitle: "Queued Demo",
        description: "A workflow demo. Email me at queued@example.com.",
        category: "Developer Tools",
        status: "queued",
        queueOrder: 1,
        createdAt: 10,
        updatedAt: 20,
      },
    ],
    pool: [
      {
        id: "candidate-id",
        name: "Candidate Person",
        demoTitle: "Candidate Demo",
        description: "Call +44 20 7946 0958 after the show.",
        category: "AI",
        status: "candidate",
        createdAt: 30,
        updatedAt: 40,
      },
    ],
    hidden: [],
    inactive: [],
  });

  assert.deepEqual(context.event, {
    id: "event-id",
    name: "Demo Night",
    slug: "demo-night",
    lineupTarget: 5,
    queuePublished: true,
  });
  assert.equal(context.eligible.lineup[0].description, "A workflow demo. Email me at <redacted-email>.");
  assert.equal(context.eligible.pool[0].description, "Call <redacted-phone> after the show.");
  assert.equal("score" in context.eligible.lineup[0], false);
  assert.equal("reasons" in context.eligible.lineup[0], false);
  assert.equal("adminToken" in context.event, false);
});

test("toModelContext treats missing optional submission groups as empty arrays", () => {
  const context = toModelContext({
    event: {
      id: "event-id",
      name: "Demo Night",
      slug: "demo-night",
      queuePublished: false,
    },
    lineup: [],
    pool: [],
  });

  assert.deepEqual(context.eligible.lineup, []);
  assert.deepEqual(context.eligible.pool, []);
  assert.deepEqual(context.ineligible.hidden, []);
  assert.deepEqual(context.ineligible.inactive, []);
});

test("parseArgs rejects helper-owned ranking and mutation commands", () => {
  assert.throws(
    () => parseArgs(["rank", "--count", "5"]),
    /"rank" is not supported\. This helper only fetches queue data for the model\./,
  );
  assert.throws(
    () => parseArgs(["set-best", "--count", "5", "--yes"]),
    /"set-best" is not supported\. This helper only fetches queue data for the model\./,
  );
  assert.throws(
    () => parseArgs(["set-lineup", "--ids", "abc", "--yes"]),
    /"set-lineup" is not supported\. This helper only fetches queue data for the model\./,
  );
});
