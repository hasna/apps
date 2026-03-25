/**
 * Agent/presence tools: register_agent, heartbeat, list_agents, remove_agent,
 * rename_agent, set_focus, get_focus, unfocus, get_session_activity, get_blockers
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveIdentity, updateCachedAutoName } from "../../lib/identity.js";
import { heartbeat, registerAgent, listAgents, removePresence, renameAgent, getPresence } from "../../lib/presence.js";
import { getSessionActivity } from "../../lib/sessions.js";
import { getUnreadBlockers } from "../../lib/messages.js";

export function registerAgentTools(
  server: McpServer,
  agentFocus: Map<string, { project_id: string | null }>,
  getAgentFocus: (agentId: string) => string | null,
): void {

  server.registerTool("register_agent", {
    description: "Register an agent with conflict detection. Returns AgentConflictError if another active session exists (active = heartbeat within last 30 min). Optional project_id locks agent to a project for the session.",
    inputSchema: {
      name: z.string(),
      session_id: z.string(),
      role: z.string().optional(),
      project_id: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { name, session_id, role, project_id } = args;
    try {
      const result = registerAgent(name, session_id, role, project_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (e: any) {
      if (e.message?.includes("UNIQUE constraint")) {
        return {
          content: [{ type: "text", text: `Agent "${name}" already registered. Use heartbeat to update presence, or list_agents to see active agents.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: e.message ?? String(e) }], isError: true };
    }
  });

  server.registerTool("heartbeat", {
    description: "Send presence heartbeat.",
    inputSchema: {
      from: z.string().optional(),
      status: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam, status } = args;
    const agent = resolveIdentity(fromParam);
    heartbeat(agent, status);

    return {
      content: [{ type: "text", text: JSON.stringify({ agent, status: status || "online", heartbeat: true }) }],
    };
  });

  server.registerTool("list_agents", {
    description: "List agents with presence status.",
    inputSchema: {
      online_only: z.coerce.boolean().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { online_only } = args;
    const agents = listAgents({ online_only });

    return {
      content: [{ type: "text", text: JSON.stringify(agents) }],
    };
  });

  server.registerTool("remove_agent", {
    description: "Remove an agent from presence.",
    inputSchema: {
      from: z.string().optional(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam, agent: targetAgent } = args;
    const self = resolveIdentity(fromParam);
    const agent = targetAgent?.trim() || self;

    const removed = removePresence(agent);
    if (!removed) {
      return {
        content: [{ type: "text", text: `agent "${agent}" not found` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ agent, removed: true }) }],
    };
  });

  server.registerTool("rename_agent", {
    description: "Rename your agent in presence.",
    inputSchema: {
      new_name: z.string(),
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam, new_name } = args;
    const oldName = resolveIdentity(fromParam);
    const newName = new_name.trim();

    if (!newName) {
      return {
        content: [{ type: "text", text: "new name cannot be empty" }],
        isError: true,
      };
    }

    try {
      const renamed = renameAgent(oldName, newName);
      if (!renamed) {
        return {
          content: [{ type: "text", text: `agent "${oldName}" not found` }],
          isError: true,
        };
      }

      // Update cached identity so subsequent calls resolve to the new name
      if (!fromParam) {
        updateCachedAutoName(newName);
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ old_name: oldName, new_name: newName, renamed: true }) }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: e.message }],
        isError: true,
      };
    }
  });

  server.registerTool("set_focus", {
    description: "Set agent focus to a project. All read-heavy tools will default to this project scope. Stores in MCP session memory AND updates agent_presence.project_id in DB.",
    inputSchema: {
      project_id: z.string(),
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { project_id, from: fromParam } = args;
    const agent = resolveIdentity(fromParam);
    agentFocus.set(agent, { project_id });

    // Also persist to DB
    const db = (await import("../../lib/db.js")).getDb();
    db.prepare("UPDATE agent_presence SET project_id = ? WHERE agent = ?").run(project_id, agent);

    return {
      content: [{ type: "text", text: JSON.stringify({ agent, focused: true, project_id }) }],
    };
  });

  server.registerTool("get_focus", {
    description: "Get the current focus state for an agent. Returns session focus, DB project_id, and effective project_id used for filtering.",
    inputSchema: {
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = resolveIdentity(args.from);
    const sessionFocus = agentFocus.get(agent) ?? null;
    const presence = getPresence(agent);
    const effective = getAgentFocus(agent);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          agent,
          session_focus: sessionFocus?.project_id ?? null,
          db_project_id: presence?.project_id ?? null,
          effective_project_id: effective,
        }),
      }],
    };
  });

  server.registerTool("unfocus", {
    description: "Clear agent focus. Removes session focus and clears agent_presence.project_id in DB.",
    inputSchema: {
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = resolveIdentity(args.from);
    agentFocus.delete(agent);

    // Clear from DB too
    const db = (await import("../../lib/db.js")).getDb();
    db.prepare("UPDATE agent_presence SET project_id = NULL WHERE agent = ?").run(agent);

    return {
      content: [{ type: "text", text: JSON.stringify({ agent, focused: false, project_id: null }) }],
    };
  });

  server.registerTool("get_session_activity", {
    description: "Get activity metrics for a session: message velocity, unique agents, reply ratio, reaction count, trending status.",
    inputSchema: {
      session_id: z.string(),
    },
  }, async (args: Record<string, any>) => {
    const activity = getSessionActivity(args.session_id);
    if (!activity) {
      return { content: [{ type: "text", text: `session "${args.session_id}" not found` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(activity) }] };
  });

  server.registerTool("get_blockers", {
    description: "Check for unread blocking messages.",
    inputSchema: {
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam } = args;
    const agent = resolveIdentity(fromParam);
    const blockers = getUnreadBlockers(agent);

    return {
      content: [{ type: "text", text: JSON.stringify(blockers) }],
    };
  });
}
