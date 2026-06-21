#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const STATUS_ORDER = new Map([
  ["queued", 0],
  ["candidate", 1],
  ["hidden", 2],
  ["done", 3],
  ["no_show", 4],
  ["withdrawn", 5],
]);

const TEST_EVENT_RE = /\b(qa|layout|smoke|local-test|e2e|test)\b/i;
const STRONG_HOOK_RE = /\b(live|demo|no slides|3-min|workflow|onboarding|ships?|show)\b/i;
const WEAK_PLACEHOLDER_RE = /\b(test|whatever|placeholder|lorem|sample)\b/i;
const DEFAULT_SITE_URL = "https://demo-queue-tau.vercel.app";
const DEFAULT_LOCAL_SITE_URL = "http://localhost:3000";

function usage(exitCode = 1) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`Usage:
  pnpm queue:prod -- snapshot [--admin-url URL | --slug SLUG --admin-token TOKEN]
  pnpm queue:prod -- rank [--count 5] [--admin-url URL | --slug SLUG --admin-token TOKEN]
  pnpm queue:prod -- set-lineup --ids ID1,ID2,... [--admin-url URL | --slug SLUG --admin-token TOKEN] --yes
  pnpm queue:prod -- set-best [--count 5] [--admin-url URL | --slug SLUG --admin-token TOKEN] --yes
  pnpm queue -- snapshot
  pnpm queue -- snapshot --deployment PREVIEW_REFERENCE --site-url https://preview-url.vercel.app

Notes:
  --prod is added by the package script.
  --deployment is passed through to Convex for dev, preview, staging, local, or named deployments.
  --show-admin-url prints a full URL using --site-url, DEMO_QUEUE_SITE_URL, Vercel URL env vars, or a deployment-specific default.
  Mutations require --yes.
  Normal output omits phone numbers, emails, participant tokens, and admin tokens.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    prod: false,
    yes: false,
    count: 5,
    showAdminUrl: false,
  };
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--prod") {
      args.prod = true;
    } else if (arg === "--deployment") {
      args.deployment = argv[++i];
    } else if (arg === "--yes") {
      args.yes = true;
    } else if (arg === "--show-admin-url") {
      args.showAdminUrl = true;
    } else if (arg === "--count") {
      args.count = Number(argv[++i]);
    } else if (arg === "--admin-url") {
      Object.assign(args, parseAdminUrl(argv[++i]));
    } else if (arg === "--slug") {
      args.slug = argv[++i];
    } else if (arg === "--admin-token") {
      args.adminToken = argv[++i];
    } else if (arg === "--site-url") {
      args.siteUrl = argv[++i];
    } else if (arg === "--ids") {
      args.ids = argv[++i].split(",").map((id) => id.trim()).filter(Boolean);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  args.command = positionals[0] ?? "snapshot";
  if (!Number.isFinite(args.count) || args.count < 1) {
    throw new Error("--count must be a positive number");
  }
  args.count = Math.round(args.count);
  validateDeploymentSelector(args);
  return args;
}

function validateDeploymentSelector(args) {
  const selectors = [
    args.prod ? "--prod" : null,
    args.deployment ? "--deployment" : null,
  ].filter(Boolean);
  if (selectors.length > 1) {
    throw new Error(`Choose only one Convex deployment selector: ${selectors.join(", ")}`);
  }
}

function parseAdminUrl(value) {
  if (!value) throw new Error("--admin-url requires a value");
  let pathname = value;
  let adminSiteUrl;
  try {
    const parsed = new URL(value);
    pathname = parsed.pathname;
    adminSiteUrl = parsed.origin;
  } catch {
    // Accept a raw /admin/:slug/:token path too.
  }
  const match = pathname.match(/\/admin\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new Error("Admin URL must include /admin/:slug/:token");
  }
  return {
    slug: decodeURIComponent(match[1]),
    adminToken: decodeURIComponent(match[2]),
    adminSiteUrl,
  };
}

function runConvex(args, { json = true } = {}) {
  const fullArgs = ["exec", "convex", ...args];
  const result = spawnSync("pnpm", fullArgs, {
    encoding: "utf8",
    env: localProcessEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    if (detail.includes("No CONVEX_DEPLOYMENT set")) {
      throw new Error(
        "CONVEX_DEPLOYMENT is not configured. Copy/create .env.local with CONVEX_DEPLOYMENT or choose a deployment with --prod/--deployment.",
      );
    }
    throw new Error(
      `pnpm ${redactSensitiveArgs(fullArgs).join(" ")} failed\n${redactSensitiveText(detail)}`,
    );
  }

  const stdout = result.stdout.trim();
  if (!json) return stdout;
  if (!stdout) return null;

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Could not parse Convex JSON output: ${error.message}\n${stdout}`);
  }
}

async function runAppFunction(args, type, functionName, payload) {
  const convexUrl = await convexUrlForArgs(args);
  if (convexUrl) {
    return await runConvexHttp(convexUrl, type, functionName, payload);
  }

  return runConvex([
    "run",
    functionName,
    JSON.stringify(payload),
    ...deploymentFlags(args),
  ]);
}

async function runConvexHttp(convexUrl, type, functionName, payload) {
  const endpoint = type === "mutation" ? "mutation" : "query";
  const response = await fetch(`${convexUrl}/api/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Convex-Client": "demo-queue-helper",
    },
    body: JSON.stringify({
      path: functionName,
      format: "convex_encoded_json",
      args: [payload],
    }),
  });
  const body = await response.text();
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error(`Could not parse Convex HTTP response from ${endpoint}: ${redactSensitiveText(body)}`);
  }

  if (!response.ok && response.status !== 560) {
    throw new Error(`Convex HTTP ${endpoint} failed: ${redactSensitiveText(body)}`);
  }
  if (result.status === "success") return result.value;
  if (result.status === "error") {
    throw new Error(result.errorMessage ?? `Convex HTTP ${endpoint} failed`);
  }
  throw new Error(`Invalid Convex HTTP response: ${redactSensitiveText(body)}`);
}

async function convexUrlForArgs(args) {
  if (args.adminSiteUrl) {
    const inferred = await inferConvexUrlFromSite(normalizeSiteUrl(args.adminSiteUrl), args);
    if (!inferred) {
      throw new Error(
        "Could not infer Convex URL from --admin-url. Check that the URL points at a deployed demo-queue app.",
      );
    }
    return inferred;
  }

  const env = localProcessEnv();
  if (env.NEXT_PUBLIC_CONVEX_URL) return env.NEXT_PUBLIC_CONVEX_URL;

  const siteUrl = normalizeSiteUrl(args.siteUrl ?? args.adminSiteUrl ?? env.DEMO_QUEUE_SITE_URL ?? defaultSiteUrl(args, env));
  if (!siteUrl) return null;
  return await inferConvexUrlFromSite(siteUrl, args);
}

async function inferConvexUrlFromSite(siteUrl, args) {
  const pageUrl = args.slug && args.adminToken
    ? `${siteUrl}/admin/${encodeURIComponent(args.slug)}/${encodeURIComponent(args.adminToken)}`
    : siteUrl;

  try {
    const html = await fetchText(pageUrl);
    const scriptUrls = extractScriptSrcs(html, siteUrl);
    const scriptTexts = await Promise.all(scriptUrls.map((url) => fetchText(url).catch(() => "")));
    const runtimeMatch = scriptTexts.map(findRuntimeConvexUrl).find(Boolean);
    if (runtimeMatch) return runtimeMatch;

    const candidates = new Set(scriptTexts.flatMap(findConvexUrlCandidates));
    if (candidates.size === 1) return [...candidates][0];
  } catch {
    return null;
  }
  return null;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed with ${response.status}`);
  return await response.text();
}

function extractScriptSrcs(html, siteUrl) {
  return [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => new URL(match[1], siteUrl).href);
}

function findRuntimeConvexUrl(text) {
  return text.match(/NEXT_PUBLIC_CONVEX_URL:"(https:\/\/[^"\\]+\.convex\.cloud)"/)?.[1] ?? null;
}

function findConvexUrlCandidates(text) {
  return [...text.matchAll(/https:\/\/[^"'`\\\s<>]+\.convex\.cloud/g)]
    .map((match) => match[0])
    .filter((url) => !url.includes("happy-otter-123"));
}

function redactSensitiveArgs(args) {
  return args.map((arg) => redactSensitiveText(arg));
}

function redactSensitiveText(text) {
  return text
    .replace(/"adminToken"\s*:\s*"[^"]+"/g, '"adminToken":"<redacted>"')
    .replace(/\/admin\/([^/\s"]+)\/([^/\s"]+)/g, "/admin/$1/<redacted>");
}

function readLocalEnv() {
  const values = {};
  for (const file of [".env", ".env.local"]) {
    const path = join(process.cwd(), file);
    if (!existsSync(path)) continue;
    Object.assign(values, parseEnv(readFileSync(path, "utf8")));
  }
  return values;
}

function localProcessEnv(processEnv = process.env) {
  return { ...readLocalEnv(), ...processEnv };
}

function deploymentFlags(args) {
  const flags = [];
  if (args.prod) flags.push("--prod");
  if (args.deployment) flags.push("--deployment", args.deployment);
  return flags;
}

function toAdminShape(event, submissions) {
  const eventSubmissions = submissions.filter((submission) => submission.eventId === event._id);
  return {
    event: {
      id: event._id,
      name: event.name,
      slug: event.slug,
      lineupTarget: event.lineupTarget,
      queuePublished: event.queuePublished,
      adminToken: event.adminToken,
    },
    lineup: eventSubmissions
      .filter((submission) => submission.status === "queued")
      .sort((a, b) => (a.queueOrder ?? Number.MAX_SAFE_INTEGER) - (b.queueOrder ?? Number.MAX_SAFE_INTEGER))
      .map(publicFields),
    pool: eventSubmissions
      .filter((submission) => submission.status === "candidate")
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(publicFields),
    hidden: eventSubmissions
      .filter((submission) => submission.status === "hidden")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(publicFields),
    inactive: eventSubmissions
      .filter((submission) => ["done", "no_show", "withdrawn"].includes(submission.status))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(publicFields),
  };
}

function publicFields(submission) {
  return {
    id: submission._id ?? submission.id,
    name: submission.name,
    demoTitle: submission.demoTitle,
    description: submission.description,
    category: submission.category,
    status: submission.status,
    queueOrder: submission.queueOrder,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
  };
}

function pickEvent(events, slug) {
  if (slug) {
    const exact = events.find((event) => event.slug === slug);
    if (!exact) throw new Error(`No event found with slug: ${slug}`);
    return exact;
  }

  const realEvents = events.filter((event) => !TEST_EVENT_RE.test(`${event.name} ${event.slug}`));
  const candidates = (realEvents.length > 0 ? realEvents : events).slice();
  candidates.sort((a, b) => {
    const publishedDelta = Number(Boolean(b.queuePublished)) - Number(Boolean(a.queuePublished));
    if (publishedDelta !== 0) return publishedDelta;
    return (b.updatedAt ?? b._creationTime ?? 0) - (a.updatedAt ?? a._creationTime ?? 0);
  });

  const event = candidates[0];
  if (!event) throw new Error("No events found");
  return event;
}

async function loadAdmin(args) {
  if (args.slug && args.adminToken) {
    const admin = await runAppFunction(
      args,
      "query",
      "events:getAdmin",
      { slug: args.slug, adminToken: args.adminToken },
    );
    return {
      ...admin,
      event: {
        ...admin.event,
        adminToken: args.adminToken,
      },
    };
  }

  const events = runConvex(["data", "events", "--format", "json", ...deploymentFlags(args)]);
  const event = pickEvent(events, args.slug);
  const submissions = runConvex([
    "data",
    "submissions",
    "--limit",
    "1000",
    "--format",
    "json",
    ...deploymentFlags(args),
  ]);
  return toAdminShape(event, submissions);
}

function scoreSubmission(submission, selectedCategories) {
  const title = submission.demoTitle ?? "";
  const description = submission.description ?? "";
  const category = submission.category ?? "";
  let score = 0;
  const reasons = [];

  if (submission.status === "queued") {
    score += 1000 - (submission.queueOrder ?? 99);
    reasons.push("already queued");
  }
  if (STRONG_HOOK_RE.test(`${title} ${description}`)) {
    score += 45;
    reasons.push("clear live-demo hook");
  }
  if (description.length >= 70) {
    score += 20;
    reasons.push("concrete description");
  }
  if (category && !selectedCategories.has(category)) {
    score += 12;
    reasons.push("adds category variety");
  }
  if (WEAK_PLACEHOLDER_RE.test(`${title} ${description}`)) {
    score -= 80;
    reasons.push("placeholder-like wording");
  }
  if (submission.status !== "queued" && submission.status !== "candidate") {
    score -= 10000;
    reasons.push(`inactive status: ${submission.status}`);
  }

  return { score, reasons };
}

function rankSubmissions(admin, count) {
  const eligible = [...admin.lineup, ...admin.pool].map(publicFields);
  const selected = [];
  const selectedCategories = new Set();

  while (eligible.length > 0 && selected.length < count) {
    eligible.sort((a, b) => {
      const scoredB = scoreSubmission(b, selectedCategories).score;
      const scoredA = scoreSubmission(a, selectedCategories).score;
      if (scoredB !== scoredA) return scoredB - scoredA;

      const statusDelta =
        (STATUS_ORDER.get(a.status) ?? 99) - (STATUS_ORDER.get(b.status) ?? 99);
      if (statusDelta !== 0) return statusDelta;

      return (a.queueOrder ?? Number.MAX_SAFE_INTEGER) - (b.queueOrder ?? Number.MAX_SAFE_INTEGER);
    });

    const next = eligible.shift();
    if (!next) break;
    const { score, reasons } = scoreSubmission(next, selectedCategories);
    selected.push({ ...next, score, reasons });
    if (next.category) selectedCategories.add(next.category);
  }

  return selected;
}

function printSnapshot(admin, args) {
  console.log(`Event: ${admin.event.name} (${admin.event.slug})`);
  console.log(`Published: ${admin.event.queuePublished ? "yes" : "no"}`);
  console.log(`Lineup target: ${admin.event.lineupTarget ?? "not set"}`);
  console.log(`Lineup: ${admin.lineup.length}`);
  printList(admin.lineup);
  console.log(`Pool: ${admin.pool.length}`);
  printList(admin.pool);
  if (args.showAdminUrl && admin.event.adminToken) {
    console.log(`Admin URL: ${adminUrl(admin, args)}`);
  }
}

function adminUrl(admin, args) {
  const env = localProcessEnv();
  const siteUrl = normalizeSiteUrl(args.siteUrl ?? args.adminSiteUrl ?? env.DEMO_QUEUE_SITE_URL ?? defaultSiteUrl(args, env));
  return `${siteUrl}/admin/${admin.event.slug}/${admin.event.adminToken}`;
}

function defaultSiteUrl(args, env) {
  if (args.prod && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (env.VERCEL_BRANCH_URL) return `https://${env.VERCEL_BRANCH_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (args.prod) return DEFAULT_SITE_URL;
  return DEFAULT_LOCAL_SITE_URL;
}

function normalizeSiteUrl(value) {
  if (!value) return DEFAULT_LOCAL_SITE_URL;
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function printList(items) {
  if (items.length === 0) {
    console.log("  (empty)");
    return;
  }
  for (const [index, item] of items.entries()) {
    const order = item.queueOrder ?? index + 1;
    console.log(`  ${order}. ${item.name} - ${item.demoTitle} [${item.status}] ${item.id}`);
  }
}

function printRanked(admin, ranked) {
  console.log(`Event: ${admin.event.name} (${admin.event.slug})`);
  for (const [index, item] of ranked.entries()) {
    console.log(
      `${index + 1}. ${item.name} - ${item.demoTitle} (${item.category ?? "uncategorized"})`,
    );
    console.log(`   id: ${item.id}`);
    console.log(`   status: ${item.status}${item.queueOrder ? `, queueOrder ${item.queueOrder}` : ""}`);
    console.log(`   why: ${item.reasons.join("; ") || "highest remaining score"}`);
  }
}

async function setLineup(admin, args, ids) {
  if (!admin.event.adminToken) {
    throw new Error("set-lineup requires an admin token. Pass --admin-url or --admin-token.");
  }
  const chosen = ids.map((id) => findSubmission(admin, id));
  const invalid = chosen.filter((submission) => submission.status !== "queued" && submission.status !== "candidate");
  if (invalid.length > 0) {
    throw new Error(
      `set-lineup only accepts queued or candidate submissions. Invalid ids: ${invalid
        .map((submission) => `${submission.id} (${submission.status})`)
        .join(", ")}`,
    );
  }
  if (!args.yes) {
    console.log("Dry run only. Add --yes to apply this lineup:");
    printList(chosen);
    return;
  }

  await runAppFunction(
    args,
    "mutation",
    "events:setLineupOrder",
    {
      slug: admin.event.slug,
      adminToken: admin.event.adminToken,
      orderedIds: ids,
    },
  );

  const verified = await runAppFunction(
    args,
    "query",
    "events:getAdmin",
    {
      slug: admin.event.slug,
      adminToken: admin.event.adminToken,
    },
  );
  const stage = await runAppFunction(
    args,
    "query",
    "events:getStage",
    { slug: admin.event.slug },
  );

  console.log(`Applied lineup for ${verified.event.name} (${verified.event.slug})`);
  printList(verified.lineup);
  console.log(`Stage current: ${stage.current?.name ?? "(none)"}`);
  console.log(`Stage up next: ${stage.upNext?.name ?? "(none)"}`);
}

function findSubmission(admin, id) {
  const submission = [...admin.lineup, ...admin.pool, ...admin.hidden, ...admin.inactive].find(
    (item) => item.id === id,
  );
  if (!submission) throw new Error(`Unknown submission id: ${id}`);
  return submission;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const admin = await loadAdmin(args);

  if (args.command === "snapshot") {
    printSnapshot(admin, args);
  } else if (args.command === "rank") {
    printRanked(admin, rankSubmissions(admin, args.count));
  } else if (args.command === "set-lineup") {
    if (!args.ids || args.ids.length === 0) {
      throw new Error("set-lineup requires --ids ID1,ID2,...");
    }
    await setLineup(admin, args, args.ids);
  } else if (args.command === "set-best") {
    const ids = rankSubmissions(admin, args.count).map((item) => item.id);
    await setLineup(admin, args, ids);
  } else {
    throw new Error(`Unknown command: ${args.command}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    usage(1);
  });
}

export {
  extractScriptSrcs,
  findConvexUrlCandidates,
  findRuntimeConvexUrl,
  convexUrlForArgs,
  localProcessEnv,
  parseAdminUrl,
  readLocalEnv,
};
