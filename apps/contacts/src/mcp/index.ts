#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCloudTools } from "@hasna/cloud";
import { ConnectorNotInstalledError, ConnectorAuthError } from "../lib/connector.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import { allHandlers } from "./handlers/index.js";

const server = new McpServer({ name: "contacts", version: "0.6.12" });

for (const tool of TOOL_DEFINITIONS) {
  const handler = allHandlers[tool.name];
  if (!handler) continue;

  server.tool(
    tool.name,
    tool.description ?? "",
    (tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
    async (args) => {
      try {
        return await handler(args as Record<string, unknown>);
      } catch (err) {
        const msg = err instanceof ConnectorNotInstalledError || err instanceof ConnectorAuthError
          ? err.message
          : `Error: ${err instanceof Error ? err.message : String(err)}`;
        return { content: [{ type: "text", text: msg }], isError: true };
      }
    }
  );
}

async function main() {
  const transport = new StdioServerTransport();
  registerCloudTools(server, "contacts");
  await server.connect(transport);
  console.error("Contacts MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
