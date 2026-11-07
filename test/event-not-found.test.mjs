import assert from "node:assert/strict";
import { createServer } from "node:http";
import { register } from "node:module";
import { after, before, test } from "node:test";

// app/metadata.ts imports through the "@/" alias and without file extensions,
// as Next.js resolves them. Node needs both spelled out.
const resolveLikeNext = `
let root;
export function initialize(data) { root = data.root; }
export async function resolve(specifier, context, next) {
  const target = specifier.startsWith("@/") ? new URL(specifier.slice(2), root).href : specifier;
  try {
    return await next(target, context);
  } catch (error) {
    for (const extension of [".ts", ".tsx", ".js"]) {
      try { return await next(target + extension, context); } catch {}
    }
    throw error;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(resolveLikeNext)}`, import.meta.url, {
  data: { root: new URL("../", import.meta.url).href },
});

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const events = { daytona: { name: "Daytona", slug: "daytona", eventType: "demo", visualStyle: "codex", theme: "light" } };
const submissions = { daytona: { "kept-token": { demoTitle: "Sandbox" } } };

/** Answers like the production deployment: a ConvexError's message is redacted, its text is only in errorData. */
function convexFailure(response, text) {
  response.writeHead(560, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: "error", errorMessage: "[Request ID: 0123456789abcdef] Server Error", errorData: text, logLines: [] }));
}

function query({ path, args: [args] }, response) {
  const event = events[args.slug];
  if (args.slug === "broken") return convexFailure(response, undefined);
  if (!event) return convexFailure(response, "Event not found");
  if (path === "events:getEventMeta") return event;
  const submission = submissions[args.slug]?.[args.participantToken];
  if (!submission) return convexFailure(response, "Submission not found");
  return { event: { name: event.name, slug: event.slug, eventType: event.eventType, submissionsClosed: false }, submission };
}

const convex = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const value = query(JSON.parse(body), response);
  if (value === undefined) return;
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: "success", value, logLines: [] }));
});

let metadata;
before(async () => {
  await new Promise((resolve) => convex.listen(0, "127.0.0.1", resolve));
  process.env.NEXT_PUBLIC_CONVEX_URL = `http://127.0.0.1:${convex.address().port}`;
  metadata = await import("../app/metadata.ts");
});
after(() => convex.close());

async function digestOf(promise) {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return error.digest ?? error.message;
  }
}

test("a link to an event that doesn't exist is a 404 page, for its title and its body", async () => {
  assert.equal(await digestOf(metadata.eventTitle("no-such-event")), NOT_FOUND);
  assert.equal(await digestOf(metadata.eventLook("no-such-event")), NOT_FOUND);
  assert.equal(await digestOf(metadata.participantTitle("no-such-event", "kept-token")), NOT_FOUND);
});

test("a link to a real event still reads the event", async () => {
  assert.equal(await metadata.eventTitle("daytona"), "Daytona");
  assert.deepEqual(await metadata.eventLook("daytona"), { name: "Daytona", eventType: "demo", visualStyle: "codex", theme: "light" });
  assert.deepEqual(await metadata.participantTitle("daytona", "kept-token"), { eventName: "Daytona", demoTitle: "Sandbox" });
});

test("a missing submission at a real event keeps its own error page, not a 404", async () => {
  assert.equal(await metadata.participantTitle("daytona", "cleared-token"), null);
});

test("when the event can't be read for another reason, the submit page still loads plain", async () => {
  assert.equal(await metadata.eventLook("broken"), null);
});
