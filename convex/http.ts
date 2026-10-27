import { httpRouter } from "convex/server";
import { mcp, metadata } from "./mcp";

const http = httpRouter();
for (const method of ["POST", "GET", "DELETE", "OPTIONS"] as const) http.route({ path: "/mcp", method, handler: mcp });
for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) http.route({ path, method: "GET", handler: metadata });
export default http;
