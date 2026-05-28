import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStyleTools } from "./tools/styles.js";
import { registerHealthTools } from "./tools/health.js";
import { registerContextTools } from "./tools/context.js";
import { registerExtractTools } from "./tools/extract.js";
import { registerPresenceTools } from "./tools/presence.js";

export const MCP_NAME = "styles";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "open-styles",
    version: "0.0.1",
  });

  registerStyleTools(server);
  registerHealthTools(server);
  registerContextTools(server);
  registerExtractTools(server);
  registerPresenceTools(server);

  return server;
}
