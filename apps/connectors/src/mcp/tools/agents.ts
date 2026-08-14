import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerAgent, listAgents, isAgentConflict, heartbeat as dbHeartbeat, setFocus as dbSetFocus } from "../../db/agents.js";
import { DEFAULT_MCP_LIMIT, normalizeLimit, pageItems, parseCursor } from "../../lib/compact-output.js";

export function registerAgentTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
  // --- Tool: register_agent ---
  server.registerTool(
    "register_agent",
    {
      title: "Register Agent",
      description: "Register or heartbeat an agent. Returns agent or conflict error.",
      inputSchema: {
        name: z.string(),
        session_id: z.string().optional(),
        role: z.string().optional(),
      },
    },
    async ({ name, session_id, role }) => {
      const result = registerAgent({ name, session_id, role });
      if (isAgentConflict(result)) {
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool: list_agents ---
  server.registerTool(
    "list_agents",
    {
      title: "List Agents",
      description: "List registered agents with compact, paged defaults.",
      inputSchema: {
        limit: z.number().optional(),
        cursor: z.string().optional(),
        verbose: z.boolean().optional(),
      },
    },
    async ({ limit, cursor, verbose }) => {
      const parsedCursor = parseCursor(cursor);
      if (parsedCursor.error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: parsedCursor.error }) }], isError: true };
      }
      const agents = listAgents();
      const page = pageItems(agents, {
        offset: parsedCursor.value ?? 0,
        limit: normalizeLimit(limit, DEFAULT_MCP_LIMIT),
      });
      const data = verbose
        ? page.items
        : page.items.map((agent) => ({
            id: agent.id,
            name: agent.name,
            role: agent.role,
            lastSeenAt: agent.last_seen_at,
            projectId: agent.project_id,
          }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          agents: data,
          total: agents.length,
          count: data.length,
          nextCursor: page.nextOffset === null ? null : String(page.nextOffset),
          hint: "Use verbose=true for full agent records.",
        }, null, 2) }],
      };
    }
  );

  // --- Tool: heartbeat ---
  server.registerTool(
    "heartbeat",
    {
      title: "Heartbeat",
      description: "Update last_seen_at to signal agent is active.",
      inputSchema: {
        agent_id: z.string(),
      },
    },
    async ({ agent_id }) => {
      const agent = dbHeartbeat(agent_id);
      if (!agent) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Agent not found: ${agent_id}` }) }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(agent, null, 2) }] };
    }
  );

  // --- Tool: set_focus ---
  server.registerTool(
    "set_focus",
    {
      title: "Set Focus",
      description: "Set active project context for this agent session.",
      inputSchema: {
        agent_id: z.string(),
        project_id: z.string().optional(),
      },
    },
    async ({ agent_id, project_id }) => {
      const agent = dbSetFocus(agent_id, project_id ?? null);
      if (!agent) return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Agent not found: ${agent_id}` }) }] };
      return { content: [{ type: "text" as const, text: JSON.stringify(agent, null, 2) }] };
    }
  );
}
