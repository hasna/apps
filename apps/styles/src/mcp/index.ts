import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerStyleTools } from "./tools/styles.js";
import { registerHealthTools } from "./tools/health.js";
import { registerContextTools } from "./tools/context.js";
import { registerExtractTools } from "./tools/extract.js";
import { registerPresenceTools } from "./tools/presence.js";

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "open-styles",
    version: "0.0.1",
  });

  registerStyleTools(server);
  registerHealthTools(server);
  registerContextTools(server);
  registerExtractTools(server);
  registerPresenceTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  startMcpServer().catch((err) => {
    process.stderr.write("MCP server error: " + String(err) + "\n");
    process.exit(1);
  });
}
