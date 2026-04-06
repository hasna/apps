import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerAgent, listAgents, isAgentConflict, heartbeat as dbHeartbeat, setFocus as dbSetFocus } from "../../db/agents.js";

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
      description: "List all registered agents.",
      inputSchema: {},
    },
    async () => {
      const agents = listAgents();
      return { content: [{ type: "text" as const, text: JSON.stringify(agents, null, 2) }] };
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
