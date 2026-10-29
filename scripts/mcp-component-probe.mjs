import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const site = process.env.DEMO_QUEUE_MCP_URL;
assert.equal(site, "https://precious-elk-564.convex.site/mcp", "Probe requires the canonical development MCP endpoint.");
assert.ok(process.env.DEMO_QUEUE_MCP_KEY_FILE, "Provide the temporary read-only key file.");
const token = readFileSync(process.env.DEMO_QUEUE_MCP_KEY_FILE, "utf8").trim();
assert.ok(token.length > 32, "Temporary key is missing.");
const mode = process.argv[2] ?? "verify";
assert.ok(["verify", "after-revoke"].includes(mode), "Unknown probe mode.");

async function rpc(method, params = {}, headers = {}) {
  const response = await fetch(site, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "MCP-Protocol-Version": "2025-06-18", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: response.status, body: await response.json() };
}

function value(result) {
  const text = result.body.result?.content?.find((block) => block.type === "text")?.text;
  return text ? JSON.parse(text) : null;
}

const receipt = { mode, checkedAt: new Date().toISOString(), endpoint: site, checks: [] };
try {
  const discovery = await rpc("tools/list");
  if (mode === "after-revoke") {
    assert.equal(discovery.status, 401, "Revoked key must fail authentication.");
    receipt.checks.push("revoked-key-denied");
  } else {
    assert.equal(discovery.status, 200, "Read-only key must authenticate.");
    const tools = discovery.body.result?.tools;
    assert.ok(Array.isArray(tools) && tools.some((tool) => tool.name === "list_events"), "Read tool must be listed.");
    assert.ok(!tools.some((tool) => ["create_event", "get_submission_contacts", "list_judge_links"].includes(tool.name)), "Write and sensitive tools must be hidden.");
    receipt.checks.push("read-only-discovery");
    const organizationId = process.env.DEMO_QUEUE_MCP_ALLOWED_ORG;
    const deniedOrg = process.env.DEMO_QUEUE_MCP_DENIED_ORG;
    assert.ok(organizationId && deniedOrg && organizationId !== deniedOrg, "Provide distinct approved and unapproved development organizations.");
    const events = await rpc("tools/call", { name: "list_events", arguments: { organizationId, limit: 50 } });
    assert.equal(events.status, 200, "Approved organization read must reach the tool.");
    assert.ok(!events.body.result?.isError && value(events)?.page?.every((event) => event.organizationId === organizationId), "Approved read must return only its organization's events.");
    receipt.checks.push("approved-organization-read");
    const denied = await rpc("tools/call", { name: "list_events", arguments: { organizationId: deniedOrg, limit: 50 } });
    assert.ok(denied.body.result?.isError && value(denied)?.error === "access_denied", "Active but unapproved organization must be denied.");
    receipt.checks.push("unapproved-organization-denied");
    const write = await rpc("tools/call", { name: "create_event", arguments: { organizationId, name: "Forbidden read-only probe", slug: "forbidden-read-only-probe", eventType: "demo", meetUrl: "https://example.com" } });
    assert.equal(write.status, 403, "Direct write must fail before domain execution.");
    receipt.checks.push("direct-write-denied");
    const foreign = await rpc("tools/list", {}, { Origin: "https://attacker.example" });
    assert.equal(foreign.status, 403, "Foreign browser origin must be denied.");
    receipt.checks.push("foreign-origin-denied");
    const after = await rpc("tools/call", { name: "list_events", arguments: { organizationId, limit: 50 } });
    assert.ok(JSON.stringify(value(after)) === JSON.stringify(value(events)), "Denied writes must leave the event list unchanged.");
    receipt.checks.push("denied-write-has-no-effects");
  }
  receipt.verdict = "PASS";
  if (process.env.DEMO_QUEUE_MCP_RECEIPT) writeFileSync(process.env.DEMO_QUEUE_MCP_RECEIPT, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(receipt));
} catch {
  console.error(JSON.stringify({ mode, verdict: "FAIL", completedChecks: receipt.checks }));
  process.exitCode = 1;
}
