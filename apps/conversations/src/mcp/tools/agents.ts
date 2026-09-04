/**
 * Agent/presence tools: register_agent, heartbeat, list_agents, remove_agent,
 * rename_agent, set_focus, get_focus, unfocus, get_session_activity, get_blockers
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { registerMcpTool } from "../tool-compat.js";
import { getStore } from "../../lib/store/index.js";
import { updateCachedAutoName, readPersistedIdentity, isSelfRename } from "../../lib/identity.js";
import { identityFor } from "../identity.js";
import { env } from "../../lib/env.js";
import { normalizeAgentName } from "../../lib/presence.js";
import { getSessionAgent, setSessionAgent, setClaudeSessionId } from "../channel.js";
import { compactQueriedMessages, compactWindowedAgents, jsonText, resolveMcpWindow } from "../compact.js";
import { BLOCKERS_LIST_ORDER } from "../../lib/list-order.js";

export function registerAgentTools(
  server: McpServer,
  agentFocus: Map<string, { project_id: string | null }>,
  getAgentFocus: (agentId: string) => Promise<string | null>,
): void {
  // Bound to this connection: see ../identity.ts.
  const resolveIdentity = identityFor(server);

  registerMcpTool(server, "register_agent", {
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
    const claudeSid = env.sessionId() || null;
    const session_id = manualSid || claudeSid || `${name}-${Date.now()}`;
    try {
      const result = await getStore().registerAgent(name, session_id, role, project_id);
      // Normalized, because that is the form presence stores: implicit
      // attribution must name the row that exists, not the caller's casing.
      setSessionAgent(server, normalizeAgentName(name)); // Bridge and implicit attribution now know who we are
      if (claudeSid) setClaudeSessionId(server, claudeSid); // Track for channel bridge polling

      // Seed-if-absent, NOT last-writer-wins. A box with no identity of its own
      // adopts the first agent that deliberately registers, so this connection,
      // the CLI, and `conversations-hook` all resolve to the same name. Without
      // this, a fresh install splits in two: the MCP session speaks as `name`
      // while every CLI/hook process falls through to getAutoName(), which
      // invents a pool name, persists it, and then polls blockers addressed to
      // an agent nobody is. An identity that already exists is left alone —
      // overwriting it is the machine-identity hijack this file stopped doing.
      // A failed write leaves both the file and the cache untouched (see
      // updateCachedAutoName), so the next register_agent simply tries again.
      if (readPersistedIdentity() === null) updateCachedAutoName(normalizeAgentName(name));
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

  registerMcpTool(server, "heartbeat", {
    description: "Send presence heartbeat. Use 'from' or 'name' to set agent identity.",
    inputSchema: {
      from: z.string().optional().describe("Agent name"),
      name: z.string().optional().describe("Agent name (alias for from)"),
      agent_name: z.string().optional().describe("Agent name (alias for from)"),
      status: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam, name: nameParam, agent_name, status } = args;
    const agent = resolveIdentity(fromParam || nameParam || agent_name);
    await getStore().heartbeat(agent, status);
    setSessionAgent(server, normalizeAgentName(agent)); // Bridge and implicit attribution now know who we are

    return {
      content: [{ type: "text", text: JSON.stringify({ agent, status: status || "online", heartbeat: true }) }],
    };
  });

  registerMcpTool(server, "list_agents", {
    description: "List agents with presence status.",
    inputSchema: {
      online_only: z.coerce.boolean().optional(),
      limit: z.coerce.number().optional(),
      cursor: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Return legacy raw agent array"),
    },
  }, async (args: Record<string, any>) => {
    const { online_only } = args;
    const agents = await getStore().listAgents({ online_only });

    return {
      content: [{ type: "text", text: jsonText(args.verbose ? agents : compactWindowedAgents(agents, args)) }],
    };
  });

  registerMcpTool(server, "remove_agent", {
    description: "Remove an agent from presence.",
    inputSchema: {
      from: z.string().optional(),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam, agent: targetAgent } = args;
    const self = resolveIdentity(fromParam);
    const agent = targetAgent?.trim() || self;

    const removed = await getStore().removePresence(agent);
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

  registerMcpTool(server, "rename_agent", {
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
      const renamed = await getStore().renameAgent(oldName, newName);
      if (!renamed) {
        return {
          content: [{ type: "text", text: `agent "${oldName}" not found` }],
          isError: true,
        };
      }

      // Move this installation's identity only when we renamed the installation's
      // OWN identity. The previous check ("no `from` was passed") was wrong in the
      // other direction: it silently skipped the update whenever a caller passed an
      // explicit `from` that WAS its own name, which is how station01 was left
      // pinned to a discarded test name while presence said otherwise.
      //
      // Compare against the file, NOT getAutoName(): this server is a long-lived
      // daemon whose cached name can be days stale, and acting on a stale cache
      // would let one client overwrite another client's identity.
      const isSelf = isSelfRename(oldName, readPersistedIdentity());
      const identityAdopted = isSelf ? updateCachedAutoName(normalizeAgentName(newName)) : false;

      // Independently of the machine identity: if this connection was speaking
      // as the renamed agent, its implicit attribution has to follow, or every
      // later tool call stamps a presence row that no longer exists.
      if (isSelfRename(oldName, getSessionAgent(server))) {
        setSessionAgent(server, normalizeAgentName(newName));
      }

      return {
        content: [{ type: "text", text: JSON.stringify({
          old_name: oldName,
          new_name: newName,
          renamed: true,
          identity_adopted: identityAdopted,
          identity_write_failed: isSelf && !identityAdopted,
        }) }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: e.message }],
        isError: true,
      };
    }
  });

  registerMcpTool(server, "set_focus", {
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
    await getStore().setPresenceProject(agent, project_id);

    return {
      content: [{ type: "text", text: JSON.stringify({ agent, focused: true, project_id }) }],
    };
  });

  registerMcpTool(server, "get_focus", {
    description: "Get the current focus state for an agent. Returns session focus, DB project_id, and effective project_id used for filtering.",
    inputSchema: {
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = resolveIdentity(args.from);
    const sessionFocus = agentFocus.get(agent) ?? null;
    const presence = await getStore().getPresence(agent);
    const effective = await getAgentFocus(agent);

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

  registerMcpTool(server, "unfocus", {
    description: "Clear agent focus. Removes session focus and clears agent_presence.project_id in DB.",
    inputSchema: {
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = resolveIdentity(args.from);
    agentFocus.delete(agent);

    // Clear from DB too
    await getStore().setPresenceProject(agent, null);

    return {
      content: [{ type: "text", text: JSON.stringify({ agent, focused: false, project_id: null }) }],
    };
  });

  registerMcpTool(server, "get_session_activity", {
    description: "Get activity metrics for a session: message velocity, unique agents, reply ratio, reaction count, trending status.",
    inputSchema: {
      session_id: z.string(),
    },
  }, async (args: Record<string, any>) => {
    const activity = await getStore().getSessionActivity(args.session_id);
    if (!activity) {
      return { content: [{ type: "text", text: `session "${args.session_id}" not found` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(activity) }] };
  });

  registerMcpTool(server, "get_blockers", {
    description: "Check for unread blocking messages.",
    inputSchema: {
      from: z.string().optional(),
      limit: z.coerce.number().optional(),
      cursor: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Return full raw blocker messages instead of previews"),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam } = args;
    const agent = resolveIdentity(fromParam);
    // The resolved byline (from, or the connection default) is forwarded
    // unconditionally: the API key authorizes, the byline scopes (task
    // 1871c67f). Omitting the default identity was the fleet-wide unscoped
    // read.
    const window = resolveMcpWindow(args);
    const blockers = await getStore().getUnreadBlockers(
      agent,
      args.verbose ? undefined : { limit: window.limit + 1, offset: window.offset },
    );

    return {
      // getUnreadBlockers() orders created_at ASC — oldest blocker first,
      // because it is a backlog and not a recency window.
      content: [{ type: "text", text: jsonText(args.verbose ? blockers : compactQueriedMessages(blockers, args, BLOCKERS_LIST_ORDER)) }],
    };
  });
}
