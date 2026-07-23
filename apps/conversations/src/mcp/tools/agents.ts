/**
 * Agent/presence tools: register_agent, heartbeat, list_agents, remove_agent,
 * rename_agent, set_focus, get_focus, unfocus, get_session_activity, get_blockers
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveIdentity, updateCachedAutoName } from "../../lib/identity.js";
import { heartbeat, registerAgent, listAgents, removePresence, renameAgent, getPresence, setPresenceProject } from "../../lib/presence.js";
import { setSessionAgent, setClaudeSessionId } from "../channel.js";
import { getSessionActivity } from "../../lib/sessions.js";
import { getUnreadBlockers } from "../../lib/messages.js";
import { compactQueriedMessages, compactWindowedAgents, jsonText, resolveMcpWindow } from "../compact.js";
import type { Database } from "../../lib/db.js";

export interface AgentToolDependencies {
  database?: Database;
  resolveIdentity?: typeof resolveIdentity;
  resolveClaudeSessionId?: () => string | null;
  setSessionAgent?: typeof setSessionAgent;
  setClaudeSessionId?: typeof setClaudeSessionId;
  updateCachedAutoName?: typeof updateCachedAutoName;
}

export function registerAgentTools(
  server: McpServer,
  agentFocus: Map<string, { project_id: string | null }>,
  getAgentFocus: (agentId: string) => string | null,
  dependencies: AgentToolDependencies = {},
): void {
  const database = dependencies.database;
  const resolveAgentIdentity = dependencies.resolveIdentity ?? resolveIdentity;
  const resolveClaudeSessionId = dependencies.resolveClaudeSessionId
    ?? (() => process.env.CONVERSATIONS_SESSION_ID || null);
  const rememberSessionAgent = dependencies.setSessionAgent ?? setSessionAgent;
  const rememberClaudeSessionId = dependencies.setClaudeSessionId ?? setClaudeSessionId;
  const rememberAutoName = dependencies.updateCachedAutoName ?? updateCachedAutoName;

  server.registerTool("register_agent", {
    description: "Register an agent. Just provide the name — session_id is auto-detected.",
    inputSchema: {
      name: z.string().optional().describe("Agent name"),
      agent_name: z.string().optional().describe("Agent name (alias)"),
      agent_id: z.string().optional().describe("Agent name (alias)"),
      session_id: z.string().optional().describe("Auto-detected from environment, do not set manually"),
      role: z.string().optional(),
      project_id: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { name: nameParam, agent_name, agent_id, session_id: manualSid, role, project_id } = args;
    const name = nameParam || agent_name || agent_id;
    if (!name) return { content: [{ type: "text", text: "Error: name is required" }], isError: true };
    // Auto-detect session_id from environment (set by agent-claude MCP subprocess)
    const claudeSid = resolveClaudeSessionId();
    const session_id = manualSid || claudeSid || `${name}-${Date.now()}`;
    try {
      const result = registerAgent(name, session_id, role, project_id, database);
      rememberSessionAgent(name); // Bridge now knows who we are
      if (claudeSid) rememberClaudeSessionId(claudeSid); // Track for channel bridge polling
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
    description: "Send presence heartbeat. Use 'from' or 'name' to set agent identity.",
    inputSchema: {
      from: z.string().optional().describe("Agent name"),
      name: z.string().optional().describe("Agent name (alias for from)"),
      agent_name: z.string().optional().describe("Agent name (alias for from)"),
      status: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam, name: nameParam, agent_name, status } = args;
    const agent = resolveAgentIdentity(fromParam || nameParam || agent_name);
    heartbeat(agent, status, undefined, undefined, undefined, database);
    rememberSessionAgent(agent); // Bridge now knows who we are

    return {
      content: [{ type: "text", text: JSON.stringify({ agent, status: status || "online", heartbeat: true }) }],
    };
  });

  server.registerTool("list_agents", {
    description: "List agents with presence status.",
    inputSchema: {
      online_only: z.coerce.boolean().optional(),
      limit: z.coerce.number().optional(),
      cursor: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Return legacy raw agent array"),
    },
  }, async (args: Record<string, any>) => {
    const { online_only } = args;
    const agents = listAgents({ online_only }, database);

    return {
      content: [{ type: "text", text: jsonText(args.verbose ? agents : compactWindowedAgents(agents, args)) }],
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
    const agent = targetAgent?.trim() || resolveAgentIdentity(fromParam);

    const removed = removePresence(agent, database);
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
    const oldName = resolveAgentIdentity(fromParam);
    const newName = new_name.trim();

    if (!newName) {
      return {
        content: [{ type: "text", text: "new name cannot be empty" }],
        isError: true,
      };
    }

    try {
      const renamed = renameAgent(oldName, newName, database);
      if (!renamed) {
        return {
          content: [{ type: "text", text: `agent "${oldName}" not found` }],
          isError: true,
        };
      }

      // Update cached identity so subsequent calls resolve to the new name
      if (!fromParam) {
        rememberAutoName(newName);
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
    const agent = resolveAgentIdentity(fromParam);
    agentFocus.set(agent, { project_id });

    // Also persist to DB
    setPresenceProject(agent, project_id, database);

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
    const agent = resolveAgentIdentity(args.from);
    const sessionFocus = agentFocus.get(agent) ?? null;
    const presence = getPresence(agent, database);
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
    const agent = resolveAgentIdentity(args.from);
    agentFocus.delete(agent);

    // Clear from DB too
    setPresenceProject(agent, null, database);

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
    const activity = getSessionActivity(args.session_id, database);
    if (!activity) {
      return { content: [{ type: "text", text: `session "${args.session_id}" not found` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(activity) }] };
  });

  server.registerTool("get_blockers", {
    description: "Check for unread blocking messages.",
    inputSchema: {
      from: z.string().optional(),
      limit: z.coerce.number().optional(),
      cursor: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Return full raw blocker messages instead of previews"),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam } = args;
    const agent = resolveAgentIdentity(fromParam);
    const window = resolveMcpWindow(args);
    const blockers = getUnreadBlockers(
      agent,
      args.verbose ? undefined : { limit: window.limit + 1, offset: window.offset },
      database,
    );

    return {
      content: [{ type: "text", text: jsonText(args.verbose ? blockers : compactQueriedMessages(blockers, args)) }],
    };
  });
}
