import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConnector } from "../../lib/registry.js";
import { getTopConnectors } from "../../db/usage.js";
import { getPromotedConnectors } from "../../db/promotions.js";
import { promoteConnector, demoteConnector } from "../../db/promotions.js";

export function registerRankingTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
  // --- Tool: get_hot_connectors ---
  server.registerTool(
    "get_hot_connectors",
    {
      title: "Get Hot Connectors",
      description: "Top connectors by usage.",
      inputSchema: {
        limit: z.number().optional(),
        days: z.number().optional(),
      },
    },
    async ({ limit, days }) => {
      const top = getTopConnectors(limit ?? 10, days ?? 7);
      const promoted = new Set(getPromotedConnectors());
      const result = top.map((t) => ({ ...t, promoted: promoted.has(t.connector) }));
      return stripped(JSON.stringify(result, null, 2));
    }
  );

  // --- Tool: promote_connector ---
  server.registerTool(
    "promote_connector",
    {
      title: "Promote Connector",
      description: "Boost a connector in search rankings.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      const meta = getConnector(name);
      if (!meta) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Connector not found" }) }], isError: true };
      promoteConnector(name);
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, connector: name }) }] };
    }
  );

  // --- Tool: demote_connector ---
  server.registerTool(
    "demote_connector",
    {
      title: "Demote Connector",
      description: "Remove search ranking boost.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      const removed = demoteConnector(name);
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: removed, connector: name }) }] };
    }
  );
}
