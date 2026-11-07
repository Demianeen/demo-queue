#!/usr/bin/env node
// Crisp evidence for a page that needs no sign-in (submit form, presentation
// view, status and judge links): a 2x PNG, an ARIA snapshot and the console
// errors, written next to each other.
//
//   node .agents/skills/verify-demo-queue/scripts/shot.mjs <url> <out-prefix> [--mobile] [--wait-text "<text>"]
//
// Writes <out-prefix>.png, <out-prefix>.aria.txt and <out-prefix>.console.json.
// Organiser pages need a WorkOS session this headless browser does not have:
// drive those in the agent's own browser instead (see SKILL.md).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args.splice(index, 2)[1];
};
const mobile = args.includes("--mobile");
if (mobile) args.splice(args.indexOf("--mobile"), 1);
const waitText = flag("--wait-text");
const [url, prefix] = args;
if (!url || !prefix) {
  console.error("usage: shot.mjs <url> <out-prefix> [--mobile] [--wait-text \"<text>\"]");
  process.exit(2);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  const response = await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  // Pages render skeletons (`.skeleton`, aria-busy) until Convex answers over
  // its websocket, so "network idle" alone shows the loading state.
  await page.waitForFunction(
    () => !document.querySelector('.skeleton, [aria-busy="true"]'),
    undefined,
    { timeout: 45_000 },
  );
  if (waitText) await page.getByText(waitText, { exact: false }).first().waitFor({ timeout: 30_000 });
  await mkdir(dirname(prefix), { recursive: true });
  await page.screenshot({ path: `${prefix}.png`, fullPage: true });
  await writeFile(`${prefix}.aria.txt`, await page.locator("body").ariaSnapshot());
  await writeFile(`${prefix}.console.json`, JSON.stringify(consoleErrors, null, 2));
  console.log(JSON.stringify({ status: response?.status(), title: await page.title(), png: `${prefix}.png`, consoleErrors: consoleErrors.length }));
} finally {
  await browser.close();
}
