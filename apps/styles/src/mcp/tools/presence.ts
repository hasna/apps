import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAgent, heartbeat, listAgents } from "../../lib/presence.js";
import { getDb } from "../../lib/db.js";
import { pageItems, prettyJson } from "../../lib/format.js";

export function registerPresenceTools(server: McpServer) {
  const agentFocus = new Map<string, { project_id: string }>();

  server.tool(
    "register_agent",
    "Register an agent with conflict detection.",
    {
      name: z.string(),
      session_id: z.string(),
      role: z.string().optional(),
      project_id: z.string().optional(),
    },
    async (params) => {
      try {
        const result = registerAgent(params.name, params.session_id, params.role, params.project_id);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: e.message ?? String(e) }], isError: true };
      }
    }
  );

  server.tool(
    "heartbeat",
    "Send presence heartbeat.",
    {
      from: z.string().optional(),
      status: z.string().optional(),
    },
    async (params) => {
      const agent = params.from || "unknown";
      heartbeat(agent, params.status);
      return { content: [{ type: "text" as const, text: JSON.stringify({ agent, status: params.status || "online", heartbeat: true }) }] };
    }
  );

  server.tool(
    "list_agents",
    "List agents with presence status.",
    {
      online_only: z.boolean().optional(),
      limit: z.number().int().positive().optional().describe("Maximum agents to return in compact output (default: 20)"),
      cursor: z.number().int().nonnegative().optional().describe("Zero-based pagination offset"),
      verbose: z.boolean().optional().describe("Include full agent presence objects"),
    },
    async (params) => {
      const agents = listAgents({ online_only: params.online_only });
      const page = pageItems(agents, { limit: params.limit, cursor: params.cursor, defaultLimit: 20, maxLimit: 100 });
      return { content: [{ type: "text" as const, text: prettyJson({
        agents: params.verbose ? page.items : page.items.map((agent) => ({
          agent: agent.agent,
          role: agent.role,
          status: agent.status,
          project_id: agent.project_id,
          last_seen_at: agent.last_seen_at,
        })),
        total: page.total,
        limit: page.limit,
        cursor: page.cursor,
        nextCursor: page.nextCursor,
        hint: "Pass verbose=true for full presence records.",
      }) }] };
    }
  );

  server.tool(
    "set_focus",
    "Set agent focus to a project.",
    {
      project_id: z.string(),
      from: z.string().optional(),
    },
    async (params) => {
      const agent = params.from || "unknown";
      agentFocus.set(agent, { project_id: params.project_id });
      const db = getDb();
      db.prepare("UPDATE agent_presence SET project_id = ? WHERE agent = ?").run(params.project_id, agent);
      return { content: [{ type: "text" as const, text: JSON.stringify({ agent, focused: true, project_id: params.project_id }) }] };
    }
  );

  server.tool(
    "send_feedback",
    "Send feedback about this service",
    {
      message: z.string(),
      email: z.string().optional(),
      category: z.enum(["bug", "feature", "general"]).optional(),
    },
    async (params) => {
      try {
        const db = getDb();
        db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)").run(params.message, params.email || null, params.category || "general", "0.1.0");
        return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: String(e) }], isError: true };
      }
    }
  );
}
