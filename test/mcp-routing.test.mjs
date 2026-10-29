import assert from "node:assert/strict";
import test from "node:test";
import { mcpRewrites } from "../lib/mcp-routing.ts";

test("public MCP and OAuth discovery proxy to the selected canonical HTTP backend", () => {
  for (const deployment of ["precious-elk-564", "giant-egret-456"]) {
    assert.deepEqual(mcpRewrites(`https://${deployment}.convex.cloud`), [
      { source: "/mcp", destination: `https://${deployment}.convex.site/mcp` },
      { source: "/.well-known/oauth-protected-resource/mcp", destination: `https://${deployment}.convex.site/.well-known/oauth-protected-resource/mcp` },
      { source: "/.well-known/oauth-protected-resource", destination: `https://${deployment}.convex.site/.well-known/oauth-protected-resource` },
      { source: "/.well-known/oauth-authorization-server", destination: `https://${deployment}.convex.site/.well-known/oauth-authorization-server` },
      { source: "/mcp/oauth/register", destination: `https://${deployment}.convex.site/mcp/oauth/register` },
      { source: "/mcp/oauth/authorize", destination: `https://${deployment}.convex.site/mcp/oauth/authorize` },
      { source: "/mcp/oauth/token", destination: `https://${deployment}.convex.site/mcp/oauth/token` },
      { source: "/mcp/oauth/device", destination: `https://${deployment}.convex.site/mcp/oauth/device` },
      { source: "/mcp/oauth/revoke", destination: `https://${deployment}.convex.site/mcp/oauth/revoke` },
    ]);
  }
});

test("MCP routing cannot forward bearer credentials to another backend", () => {
  for (const url of [undefined, "", "http://giant-egret-456.convex.cloud", "https://wrong.convex.cloud", "https://giant-egret-456.convex.cloud.attacker.example", "https://user:secret@giant-egret-456.convex.cloud", "https://giant-egret-456.convex.cloud/", "https://giant-egret-456.convex.cloud/path", "https://giant-egret-456.convex.cloud?target=evil", "https://giant-egret-456.convex.cloud#fragment", "https://giant-egret-456.convex.site"]) {
    assert.throws(() => mcpRewrites(url), /canonical/);
  }
});
