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
  return ["/mcp", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]
    .map((source) => ({ source, destination: `${origin}${source}` }));
}
