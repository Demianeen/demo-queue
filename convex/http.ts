import { httpRouter } from "convex/server";
import { mcp } from "./mcp";

const http = httpRouter();
mcp.registerRoutes(http);
export default http;
