import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectorAuthError, ConnectorNotInstalledError } from "../lib/connector.js";
import { allHandlers } from "./handlers/index.js";
import { jsonSchemaToZodObject } from "./schema.js";
import { TOOL_DEFINITIONS } from "./tools.js";

function formatToolError(err: unknown): string {
  if (err instanceof ConnectorNotInstalledError || err instanceof ConnectorAuthError) {
    return err.message;
  }

  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}

export function registerContactsTools(server: McpServer) {
  for (const tool of TOOL_DEFINITIONS) {
    const handler = allHandlers[tool.name];
    if (!handler) continue;

    server.registerTool(
      tool.name,
      {
        description: tool.description ?? "",
        inputSchema: jsonSchemaToZodObject(tool.inputSchema ?? { type: "object", properties: {} }),
      },
      async (args) => {
        try {
          return await handler((args ?? {}) as Record<string, unknown>);
        } catch (err) {
          return { content: [{ type: "text", text: formatToolError(err) }], isError: true };
        }
      }
    );
  }
}
