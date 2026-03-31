#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { registerCloudTools } from "@hasna/cloud";
import { ConnectorNotInstalledError, ConnectorAuthError } from "../lib/connector.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import { allHandlers } from "./handlers/index.js";

const server = new Server(
  { name: "contacts", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    const handler = allHandlers[name];
    if (!handler) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    return await handler(a);
  } catch (err) {
    const msg = err instanceof ConnectorNotInstalledError || err instanceof ConnectorAuthError
      ? err.message
      : `Error: ${err instanceof Error ? err.message : String(err)}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
});

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
