import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConnectorAuthError, ConnectorNotInstalledError } from "../lib/connector.js";
import { allHandlers } from "./handlers/index.js";
import { jsonSchemaToZodObject } from "./schema.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import { shouldRegisterContactsTool, type ContactsMcpProfile } from "./profile.js";

function formatToolError(err: unknown): string {
  if (err instanceof ConnectorNotInstalledError || err instanceof ConnectorAuthError) {
    return err.message;
  }

  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}

export function registerContactsTools(server: McpServer, profile: ContactsMcpProfile = "full") {
  for (const tool of TOOL_DEFINITIONS) {
    if (!shouldRegisterContactsTool(tool.name, profile)) continue;
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


export function registerContactsDiscoveryTools(server: McpServer): void {
  server.tool(
    "search_tools",
    "Search the complete Contacts MCP inventory by tool name or description without loading every schema.",
    {
      query: z.string().optional().describe("Optional name/description filter"),
      limit: z.number().int().positive().max(100).optional().describe("Maximum matches (default 20, max 100)"),
      cursor: z.number().int().nonnegative().optional().describe("Zero-based result cursor"),
    },
    async (args: { query?: string; limit?: number; cursor?: number }) => {
      const query = String(args.query ?? "").trim().toLowerCase();
      const limit = Math.max(1, Math.min(100, Math.trunc(args.limit ?? 20)));
      const cursor = Math.max(0, Math.trunc(args.cursor ?? 0));
      const matches = TOOL_DEFINITIONS.filter((tool) => !query || tool.name.includes(query) || (tool.description ?? "").toLowerCase().includes(query));
      const items = matches.slice(cursor, cursor + limit).map((tool) => ({ name: tool.name, description: tool.description ?? "" }));
      const nextCursor = cursor + items.length < matches.length ? cursor + items.length : null;
      return { content: [{ type: "text" as const, text: JSON.stringify({ items, count: items.length, total: matches.length, cursor, next_cursor: nextCursor, has_more: nextCursor !== null, hint: "Restart with HASNA_CONTACTS_MCP_PROFILE=full to expose the complete callable inventory." }) }] };
    },
  );

  server.tool(
    "describe_tools",
    "Describe selected Contacts tools on demand.",
    { names: z.array(z.string()).max(20).describe("Tool names (max 20)") },
    async (args: { names?: string[] }) => {
      const names = Array.isArray(args.names) ? args.names.slice(0, 20) : [];
      const wanted = new Set(names);
      const items = TOOL_DEFINITIONS.filter((tool) => wanted.has(tool.name)).map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        parameters: Object.keys(tool.inputSchema?.properties ?? {}),
        required: [...(((tool.inputSchema as { required?: readonly string[] } | undefined)?.required) ?? [])],
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify({ items, count: items.length, requested: names.length, hint: "Restart with HASNA_CONTACTS_MCP_PROFILE=full for callable non-core tools and their full JSON Schemas." }) }] };
    },
  );
}
