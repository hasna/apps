import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkRateBudget, getRateBudget } from "../../db/rate.js";

export function registerRateTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
  // --- Tool: check_rate_budget ---
  server.registerTool(
    "check_rate_budget",
    {
      title: "Check Rate Budget",
      description: "Consume one rate budget unit for an agent+connector. Returns budget status or RateExceededError.",
      inputSchema: {
        agent_id: z.string(),
        connector: z.string(),
        limit: z.number().describe("Connector's documented rate limit (calls/min)"),
      },
    },
    async ({ agent_id, connector, limit }) => {
      const result = checkRateBudget(agent_id, connector, limit);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool: get_rate_budget ---
  server.registerTool(
    "get_rate_budget",
    {
      title: "Get Rate Budget",
      description: "Peek at rate budget status without consuming a unit.",
      inputSchema: {
        agent_id: z.string(),
        connector: z.string(),
        limit: z.number().describe("Connector's documented rate limit (calls/min)"),
      },
    },
    async ({ agent_id, connector, limit }) => {
      const result = getRateBudget(agent_id, connector, limit);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
