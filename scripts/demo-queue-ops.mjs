#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const TEST_EVENT_RE = /\b(qa|layout|smoke|local-test|e2e|test)\b/i;
const DEFAULT_SITE_URL = "https://demo-queue-tau.vercel.app";
const DEFAULT_LOCAL_SITE_URL = "http://localhost:3000";
const DATA_COMMANDS = new Set(["model-context", "context", "snapshot"]);

function usage(exitCode = 1) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`Usage:
  pnpm queue:prod -- model-context [--admin-url URL | --slug SLUG]
  pnpm queue:prod -- snapshot [--admin-url URL | --slug SLUG]
  pnpm queue -- model-context
  pnpm queue -- snapshot
  pnpm queue -- model-context --deployment precious-elk-564

Notes:
  --prod is added by the package script.
  --deployment accepts only precious-elk-564 or giant-egret-456.
  Remote admin URLs require --prod or an explicit canonical --deployment.
  Admin URLs locate events. Access uses the existing authenticated Convex CLI.
  --show-admin-url prints a full URL using --site-url, DEMO_QUEUE_SITE_URL, Vercel URL env vars, or a deployment-specific default.
  This helper is read-only. It fetches queue data for the model; it does not rank, choose, or mutate demos.
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
      throw new Error("Legacy admin tokens are no longer supported. Use authenticated Convex CLI reads with --slug.");
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

  args.command = positionals[0] ?? "model-context";
  if (!Number.isFinite(args.count) || args.count < 1) {
    throw new Error("--count must be a positive number");
  }
  args.count = Math.round(args.count);
  validateDeploymentSelector(args);
  validateDataCommand(args.command);
  return args;
}

function validateDataCommand(command) {
  if (DATA_COMMANDS.has(command)) return;
  if (command === "rank" || command === "set-best" || command === "set-lineup") {
    throw new Error(
      `"${command}" is not supported. This helper only fetches queue data for the model. Use "model-context", then let the model rank or choose demos.`,
    );
  }
  throw new Error(`Unknown command: ${command}`);
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
    // Accept a workspace admin path too.
  }
  const match = pathname.match(/^\/events\/([^/]+)\/admin\/?$/);
  if (!match) throw new Error("Legacy admin capability URLs are no longer supported. Use /events/:slug/admin and authenticated Convex CLI reads.");
  return {
    slug: decodeURIComponent(match[1]),
    adminSiteUrl,
  };
}

function runConvex(args, { run = spawnSync, env = localProcessEnv(), envLocalExists = existsSync(".env.local"), diagnostic = (line) => process.stderr.write(line) } = {}) {
  const selector = args[args.indexOf("--deployment-name") + 1];
  if (!args.includes("--deployment-name") || !["precious-elk-564", "giant-egret-456"].includes(selector)) throw new Error("Queue command requires an explicit canonical deployment selector.");
  trustedDeploymentFlags({ deployment: selector }, env, envLocalExists);
  diagnostic(`${JSON.stringify({ envLocalExists, selector: `--deployment-name ${selector}` })}\n`);
  const fullArgs = ["exec", "convex", ...args];
  let result;
  try { result = run("pnpm", fullArgs, {
    encoding: "utf8",
    env: { ...env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  }); } catch { throw new Error("Convex queue read failed: process_start_failed."); }

  if (result.status !== 0) {
    const exit = Number.isInteger(result.status) ? result.status : "unavailable";
    throw new Error(`Convex queue read failed: cli_failed, exit=${exit}.`);
  }

  const stdout = result.stdout.trim();
  if (!stdout) return null;

  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("Convex queue read failed: invalid_json.");
  }
}

function readLocalEnv() {
  const values = {};
  for (const file of [".env", ".env.local"]) {
    const path = join(process.cwd(), file);
    if (!existsSync(path)) continue;
    let parsed;
    try { parsed = parseEnv(readFileSync(path, "utf8")); } catch { throw new Error("Queue reads stopped: environment_unreadable."); }
    validateConvexEnvironment(parsed);
    Object.assign(values, parsed);
  }
  return values;
}

function localProcessEnv(processEnv = process.env) {
  const local = readLocalEnv();
  validateConvexEnvironment(processEnv);
  for (const key of ["CONVEX_DEPLOYMENT", "NEXT_PUBLIC_CONVEX_URL", "CONVEX_URL"]) {
    if (local[key] && processEnv[key] && local[key] !== processEnv[key]) throw new Error("Queue reads stopped because of a conflicting Convex override.");
  }
  return { ...local, ...processEnv };
}

function validateConvexEnvironment(env) {
  const forbidden = ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_OVERRIDE_ACCESS_TOKEN", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_PROVISION_HOST", "CONVEX_AGENT_MODE"];
  if (forbidden.some((key) => env[key])) throw new Error("Queue reads stopped because of a conflicting Convex override.");
  if (env.CONVEX_DEPLOYMENT && !["dev:precious-elk-564", "prod:giant-egret-456"].includes(env.CONVEX_DEPLOYMENT)) {
    throw new Error("The configured Convex deployment is not canonical. Queue reads stopped.");
  }
  const canonicalUrls = ["https://precious-elk-564.convex.cloud", "https://giant-egret-456.convex.cloud"];
  for (const key of ["NEXT_PUBLIC_CONVEX_URL", "CONVEX_URL"]) {
    if (env[key] && !canonicalUrls.includes(env[key])) throw new Error("The configured Convex URL is not canonical. Queue reads stopped.");
    if (env[key] && env.CONVEX_DEPLOYMENT && env[key] !== `https://${env.CONVEX_DEPLOYMENT.split(":")[1]}.convex.cloud`) throw new Error("Conflicting Convex deployment and URL. Queue reads stopped.");
  }
}

function trustedDeploymentFlags(args, env = localProcessEnv(), envLocalExists = existsSync(".env.local")) {
  validateDeploymentSelector(args);
  validateConvexEnvironment(env);
  if (args.deployment && !["precious-elk-564", "giant-egret-456"].includes(args.deployment)) throw new Error("Queue reads require a canonical Convex deployment.");
  if (!args.prod && !args.deployment && (!envLocalExists || env.CONVEX_DEPLOYMENT !== "dev:precious-elk-564")) throw new Error("The canonical development deployment is not configured. Configure it yourself or select production explicitly with --prod.");
  const deployment = args.prod ? "giant-egret-456" : args.deployment ?? "precious-elk-564";
  if (args.adminSiteUrl) {
    const hostname = new URL(args.adminSiteUrl).hostname;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    if (!local && !args.prod && !args.deployment) throw new Error("Remote admin URLs require an explicit canonical deployment selector.");
    const productionHosts = [new URL(DEFAULT_SITE_URL).hostname, env.VERCEL_PROJECT_PRODUCTION_URL];
    if (productionHosts.includes(hostname) && deployment !== "giant-egret-456") throw new Error("Production admin URL conflicts with the selected deployment.");
  }
  return ["--deployment-name", deployment];
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

async function loadAdmin(args, options = {}) {
  const flags = trustedDeploymentFlags(args, options.env, options.envLocalExists);
  const events = runConvex(["data", "events", "--format", "json", ...flags], options);
  const event = pickEvent(events, args.slug);
  const submissions = runConvex([
    "data",
    "submissions",
    "--limit",
    "1000",
    "--format",
    "json",
    ...flags,
  ], options);
  return toAdminShape(event, submissions);
}

function printSnapshot(admin, args) {
  console.log(`Event: ${admin.event.name} (${admin.event.slug})`);
  console.log(`Published: ${admin.event.queuePublished ? "yes" : "no"}`);
  console.log(`Lineup target: ${admin.event.lineupTarget ?? "not set"}`);
  console.log(`Lineup: ${admin.lineup.length}`);
  printList(admin.lineup);
  console.log(`Pool: ${admin.pool.length}`);
  printList(admin.pool);
  if (args.showAdminUrl) {
    console.log(`Admin URL: ${adminUrl(admin, args)}`);
  }
}

function printModelContext(admin) {
  console.log(JSON.stringify(toModelContext(admin), null, 2));
}

function toModelContext(admin) {
  return {
    event: {
      id: admin.event.id,
      name: admin.event.name,
      slug: admin.event.slug,
      lineupTarget: admin.event.lineupTarget ?? null,
      queuePublished: Boolean(admin.event.queuePublished),
    },
    eligible: {
      lineup: submissionList(admin.lineup).map(modelSubmissionFields),
      pool: submissionList(admin.pool).map(modelSubmissionFields),
    },
    ineligible: {
      hidden: submissionList(admin.hidden).map(modelSubmissionFields),
      inactive: submissionList(admin.inactive).map(modelSubmissionFields),
    },
  };
}

function submissionList(value) {
  return Array.isArray(value) ? value : [];
}

function modelSubmissionFields(submission) {
  return {
    id: submission.id,
    name: redactPublicText(submission.name ?? ""),
    demoTitle: redactPublicText(submission.demoTitle ?? ""),
    description: redactPublicText(submission.description ?? ""),
    category: redactPublicText(submission.category ?? ""),
    status: submission.status,
    queueOrder: submission.queueOrder ?? null,
    createdAt: submission.createdAt ?? null,
    updatedAt: submission.updatedAt ?? null,
  };
}

function redactPublicText(text) {
  return String(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<redacted-email>")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "<redacted-phone>");
}

function adminUrl(admin, args) {
  const env = localProcessEnv();
  const siteUrl = normalizeSiteUrl(args.siteUrl ?? args.adminSiteUrl ?? env.DEMO_QUEUE_SITE_URL ?? defaultSiteUrl(args, env));
  return `${siteUrl}/events/${encodeURIComponent(admin.event.slug)}/admin`;
}

function defaultSiteUrl(args, env) {
  const production = args.prod || args.deployment === "giant-egret-456";
  if (production && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (env.VERCEL_BRANCH_URL) return `https://${env.VERCEL_BRANCH_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (production) return DEFAULT_SITE_URL;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const admin = await loadAdmin(args);

  if (args.command === "model-context" || args.command === "context") {
    printModelContext(admin);
  } else if (args.command === "snapshot") {
    printSnapshot(admin, args);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    usage(1);
  });
}

export {
  localProcessEnv,
  parseArgs,
  parseAdminUrl,
  readLocalEnv,
  toModelContext,
  trustedDeploymentFlags,
  runConvex,
  loadAdmin,
};
