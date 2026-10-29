export function mcpRewrites(deploymentUrl: string) {
  let origin: string;
  switch (deploymentUrl) {
    case "https://precious-elk-564.convex.cloud":
      origin = "https://precious-elk-564.convex.site";
      break;
    case "https://giant-egret-456.convex.cloud":
      origin = "https://giant-egret-456.convex.site";
      break;
    default:
      throw new Error("MCP rewrites require a canonical Convex deployment URL");
  }
  return [
    "/mcp",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
    "/mcp/oauth/register",
    "/mcp/oauth/authorize",
    "/mcp/oauth/token",
    "/mcp/oauth/device",
    "/mcp/oauth/revoke",
  ]
    .map((source) => ({ source, destination: `${origin}${source}` }));
}
