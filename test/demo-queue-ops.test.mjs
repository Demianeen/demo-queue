import assert from "node:assert/strict";
import { chdir } from "node:process";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  convexUrlForArgs,
  extractScriptSrcs,
  findConvexUrlCandidates,
  findRuntimeConvexUrl,
  localProcessEnv,
  parseArgs,
  parseAdminUrl,
  readLocalEnv,
  toModelContext,
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

async function withTempCwdAsync(fn) {
  const previousCwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "demo-queue-env-"));
  chdir(dir);
  try {
    await fn();
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

test("localProcessEnv lets command environment override env files", () => {
  withTempCwd(() => {
    writeFileSync(
      ".env",
      [
        "CONVEX_DEPLOYMENT=dev:from-env",
        "DEMO_QUEUE_SITE_URL=https://from-env.example",
      ].join("\n"),
    );
    writeFileSync(
      ".env.local",
      [
        "CONVEX_DEPLOYMENT=dev:from-local",
        "DEMO_QUEUE_SITE_URL=https://from-local.example",
      ].join("\n"),
    );

    assert.equal(readLocalEnv().CONVEX_DEPLOYMENT, "dev:from-local");
    assert.equal(readLocalEnv().DEMO_QUEUE_SITE_URL, "https://from-local.example");

    const env = localProcessEnv({
      CONVEX_DEPLOYMENT: "dev:from-process",
      DEMO_QUEUE_SITE_URL: "https://from-process.example",
    });

    assert.equal(env.CONVEX_DEPLOYMENT, "dev:from-process");
    assert.equal(env.DEMO_QUEUE_SITE_URL, "https://from-process.example");
  });
});

test("parseAdminUrl keeps the admin site origin for direct HTTP fallback", () => {
  assert.deepEqual(
    parseAdminUrl("https://demo-queue-tau.vercel.app/admin/event-slug/admin-token"),
    {
      slug: "event-slug",
      adminToken: "admin-token",
      adminSiteUrl: "https://demo-queue-tau.vercel.app",
    },
  );
});

test("extractScriptSrcs resolves deployed Next chunks", () => {
  const html = [
    '<script src="/_next/static/chunks/app/layout.js"></script>',
    '<script async="" src="https://cdn.example/chunk.js"></script>',
  ].join("");

  assert.deepEqual(extractScriptSrcs(html, "https://demo-queue-tau.vercel.app"), [
    "https://demo-queue-tau.vercel.app/_next/static/chunks/app/layout.js",
    "https://cdn.example/chunk.js",
  ]);
});

test("findRuntimeConvexUrl prefers the app runtime env value", () => {
  const chunk = [
    'ConvexReactClient requires a URL like "https://happy-otter-123.convex.cloud"',
    'experimental__runtimeEnv:{NEXT_PUBLIC_CONVEX_URL:"https://giant-egret-456.convex.cloud"}',
  ].join(";");

  assert.equal(findRuntimeConvexUrl(chunk), "https://giant-egret-456.convex.cloud");
  assert.deepEqual(findConvexUrlCandidates(chunk), ["https://giant-egret-456.convex.cloud"]);
});

test("convexUrlForArgs treats full admin URLs as authoritative over local env", async (t) => {
  const fetchedUrls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const href = String(url);
    fetchedUrls.push(href);
    if (href === "https://demo-queue-tau.vercel.app/admin/event-slug/admin-token") {
      return new Response('<script src="/_next/static/chunks/app/admin-page.js"></script>');
    }
    if (href === "https://demo-queue-tau.vercel.app/_next/static/chunks/app/admin-page.js") {
      return new Response(
        'experimental__runtimeEnv:{NEXT_PUBLIC_CONVEX_URL:"https://giant-egret-456.convex.cloud"}',
      );
    }
    assert.fail(`Unexpected fetch URL: ${href}`);
  });

  await withTempCwdAsync(async () => {
    writeFileSync(".env.local", "NEXT_PUBLIC_CONVEX_URL=https://precious-elk-564.convex.cloud\n");

    const args = parseAdminUrl("https://demo-queue-tau.vercel.app/admin/event-slug/admin-token");

    assert.equal(await convexUrlForArgs(args), "https://giant-egret-456.convex.cloud");
    assert.deepEqual(fetchedUrls, [
      "https://demo-queue-tau.vercel.app/admin/event-slug/admin-token",
      "https://demo-queue-tau.vercel.app/_next/static/chunks/app/admin-page.js",
    ]);
  });
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
