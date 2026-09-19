import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerAgent, isAgentConflict, releaseAgent, getAgent, getAgentByName, listAgents, updateAgent, updateAgentActivity, archiveAgent, unarchiveAgent, getAvailableNamesFromPool } from "../../db/agents.js";
import { getAgentPoolForProject } from "../../lib/config.js";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import { IdentityAliasAmbiguousError } from "../../types/index.js";
import { getTodosCloudClient, cloudListAgents, cloudRegisterAgent, cloudHeartbeatAgent, cloudReleaseAgent, cloudGetAgent } from "../../cli/cloud-router.js";
import { compactJson } from "../token-utils.js";
import { buildCollectionPage, legacyCollectionText, MAX_MCP_COLLECTION_LIMIT, truncateUtf8 } from "../collection-page.js";

interface AgentFocus {
  agent_id: string;
  project_id?: string;
  task_list_id?: string;
}

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (id: string, table?: string) => string;
  formatError: (e: unknown) => string;
  agentFocusMap: Map<string, AgentFocus>;
  getAgentFocus: (agentId: string) => AgentFocus | undefined;
};

function compactAgentRow(agent: any): Record<string, unknown> {
  return {
    id: truncateUtf8(agent.id, 128),
    name: truncateUtf8(agent.name, 120),
    status: truncateUtf8(agent.status ?? "active", 32),
    description: truncateUtf8(agent.description, 240),
    role: truncateUtf8(agent.role, 120),
    title: truncateUtf8(agent.title, 120),
    active_project_id: truncateUtf8(agent.active_project_id, 128),
    last_seen_at: truncateUtf8(agent.last_seen_at, 64),
  };
}

export function registerAgentTools(server: McpServer, { shouldRegisterTool, resolveId, formatError, agentFocusMap, getAgentFocus }: Helpers): void {

  // set_focus
  if (shouldRegisterTool("set_focus")) {
    server.tool(
      "set_focus",
      "Focus this agent on a project. All list/search/status tools will default to this project.",
      {
        agent_id: z.string().describe("Agent ID or name"),
        project_id: z.string().optional().describe("Project to focus on. Omit to clear."),
        task_list_id: z.string().optional().describe("Task list to focus on"),
      },
      async ({ agent_id, project_id, task_list_id }) => {
        try {
          const resolvedProject = project_id ? resolveId(project_id, "projects") : undefined;
          const focus: AgentFocus = { agent_id, project_id: resolvedProject, task_list_id };
          agentFocusMap.set(agent_id, focus);
          // Sync to DB
          try {
            const agent = getAgentByName(agent_id) || getAgent(agent_id);
            if (agent) {
              const db = getDatabase();
              db.run("UPDATE agents SET active_project_id = ? WHERE id = ?", [resolvedProject || null, agent.id]);
            }
          } catch {}
          const projectName = resolvedProject ? ` (${resolvedProject.slice(0, 8)})` : "";
          return { content: [{ type: "text" as const, text: `Focused on project${projectName}. Read tools will default to this scope. Pass explicit project_id to override.` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // get_focus
  if (shouldRegisterTool("get_focus")) {
    server.tool(
      "get_focus",
      "Get the current focus for an agent.",
      { agent_id: z.string().describe("Agent ID or name") },
      async ({ agent_id }) => {
        const focus = getAgentFocus(agent_id);
        if (!focus?.project_id) {
          return { content: [{ type: "text" as const, text: "No focus set. Showing all projects." }] };
        }
        return { content: [{ type: "text" as const, text: `Focused on project: ${focus.project_id}${focus.task_list_id ? `, task list: ${focus.task_list_id}` : ""}` }] };
      },
    );
  }

  // unfocus
  if (shouldRegisterTool("unfocus")) {
    server.tool(
      "unfocus",
      "Clear focus — show all projects and tasks.",
      { agent_id: z.string().describe("Agent ID or name") },
      async ({ agent_id }) => {
        agentFocusMap.delete(agent_id);
        try {
          const agent = getAgentByName(agent_id) || getAgent(agent_id);
          if (agent) {
            const db = getDatabase();
            db.run("UPDATE agents SET active_project_id = NULL WHERE id = ?", [agent.id]);
          }
        } catch {}
        return { content: [{ type: "text" as const, text: "Focus cleared. Showing all projects." }] };
      },
    );
  }

  // register_agent
  if (shouldRegisterTool("register_agent")) {
    server.tool(
      "register_agent",
      "Register an agent with a distinctive one-word name. Generic/generated names like agent, agent-1, assistant, or worker-2 are rejected. Prefer Roman or Greek names from suggest_agent_name.",
      {
        name: z.string().describe("Distinctive one-word agent name. Use suggest_agent_name first; avoid agent, agent-1, and other numbered generated names."),
        description: z.string().optional(),
        role: z.string().optional(),
        title: z.string().optional(),
        level: z.string().optional(),
        permissions: z.array(z.string()).optional(),
        capabilities: z.array(z.string()).optional().describe("Agent capabilities/skills for task routing (e.g. ['typescript', 'testing', 'devops'])"),
        session_id: z.string().optional().describe("Unique ID for this coding session (e.g. process PID + timestamp, or env var). Used to detect name collisions across sessions. Store it and pass on every register_agent call."),
        working_dir: z.string().optional().describe("Working directory of this session — used to look up the project's agent pool and identify who holds the name in a conflict"),
        force: z.boolean().optional().describe("Force takeover of an active agent's name. Use with caution — only when you know the previous session is dead."),
      },
      async ({ name, description, role, title, level, permissions, capabilities, session_id, working_dir, force }) => {
        try {
          // http authority routing: register into the SHARED cloud roster so the
          // agent lands in /v1/agents (not this machine's local sqlite island),
          // fixing the identity misroute where list_agents/tasks read cloud but the
          // agent existed only locally.
          const cloud = getTodosCloudClient();
          if (cloud) {
            const agent = await cloudRegisterAgent(cloud, {
              name, description, role, title, level, permissions, capabilities, session_id, working_dir, force,
            });
            return {
              content: [{
                type: "text" as const,
                text: `Agent registered:\nID: ${agent.id}\nName: ${agent.name}${agent.description ? `\nDescription: ${agent.description}` : ""}\nSession: ${agent.session_id ?? "unbound"}\nCreated: ${agent.created_at}\nLast seen: ${agent.last_seen_at}`,
              }],
            };
          }
          // Look up the pool for this project (from config, based on working_dir) — null = no restriction
          const pool = getAgentPoolForProject(working_dir);
          const result = registerAgent({ name, description, role, title, level, permissions, capabilities, session_id, working_dir, force, pool: pool || undefined });
          if (isAgentConflict(result)) {
            const suggestLine = result.suggestions && result.suggestions.length > 0
              ? `\nAvailable names: ${result.suggestions.join(", ")}`
              : "";
            const hint = `CONFLICT: ${result.message}${suggestLine}`;
            return {
              content: [{ type: "text" as const, text: hint }],
              isError: true,
            };
          }
          const agent = result;
          const poolLine = pool ? `\nPool: [${pool.join(", ")}]` : "";
          return {
            content: [{
              type: "text" as const,
              text: `Agent registered:\nID: ${agent.id}\nName: ${agent.name}${agent.description ? `\nDescription: ${agent.description}` : ""}\nSession: ${agent.session_id ?? "unbound"}${poolLine}\nCreated: ${agent.created_at}\nLast seen: ${agent.last_seen_at}`,
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // suggest_agent_name
  if (shouldRegisterTool("suggest_agent_name")) {
    server.tool(
      "suggest_agent_name",
      "Get available Roman/Greek-style agent names for a project. Use these instead of generic generated names.",
      {
        working_dir: z.string().optional().describe("Your working directory — used to look up the project's allowed name pool from config"),
      },
      async ({ working_dir }) => {
        try {
          const pool = getAgentPoolForProject(working_dir);
          const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          // http authority routing: GET /v1/agents. Suggesting names from the
          // local roster handed out names another station was already holding,
          // because `register_agent` writes to the shared roster.
          const cloud = getTodosCloudClient();
          const roster = cloud ? await cloudListAgents(cloud) : listAgents();
          const allActive = roster.filter(a => (a.last_seen_at ?? "") > cutoff);

          if (!pool) {
            // No pool configured — any name works, just show active agents to avoid conflicts
            const defaultPool = [
              "caesar", "augustus", "marcus", "brutus", "cicero", "cato", "nero", "claudius", "tiberius", "hadrian",
              "athena", "apollo", "artemis", "iris", "hector", "sophia", "thalia", "phoebe", "daphne",
            ];
            const suggestions = cloud
              ? defaultPool.filter((name) => !roster.some((a) => a.name?.toLowerCase() === name))
              : getAvailableNamesFromPool(defaultPool, getDatabase());
            const lines = [
              "No project pool configured. Use a distinctive one-word name; generic generated names are blocked.",
              `Suggested names: ${suggestions.slice(0, 8).join(", ")}`,
              allActive.length > 0
                ? `Active agents (avoid these names): ${allActive.map(a => `${a.name} (seen ${Math.round((Date.now() - new Date(a.last_seen_at).getTime()) / 60000)}m ago)`).join(", ")}`
                : "No active agents.",
              "\nTo restrict names, configure agent_pool or project_pools in the todos data home config file (default <data home>/config.json)",
            ];
            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          }

          const available = cloud
            ? pool.filter((name) => !roster.some((a) => a.name?.toLowerCase() === name.toLowerCase()))
            : getAvailableNamesFromPool(pool, getDatabase());
          const activeInPool = allActive.filter((agent) => pool.map((name) => name.toLowerCase()).includes(agent.name.toLowerCase()));
          const lines = [
            `Project pool: ${pool.join(", ")}`,
            `Available now (${available.length}): ${available.length > 0 ? available.join(", ") : "none — all names in use"}`,
            activeInPool.length > 0 ? `Active agents: ${activeInPool.map(a => `${a.name} (seen ${Math.round((Date.now() - new Date(a.last_seen_at).getTime()) / 60000)}m ago)`).join(", ")}` : "Active agents: none",
            available.length > 0 ? `\nSuggested: ${available[0]}` : "\nNo names available. Wait for an active agent to go stale (30min timeout).",
          ];
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // list_agents
  if (shouldRegisterTool("list_agents")) {
    server.tool(
      "list_agents",
      "List a compact 20-row agent page by default. Continue with next_cursor; pass full/all for the legacy exhaustive prose view.",
      {
        include_archived: z.boolean().optional().describe("Include archived agents in the list (default: false)"),
        limit: z.number().int().min(1).max(MAX_MCP_COLLECTION_LIMIT).optional().describe("Page size (default: 20, max: 500)"),
        offset: z.number().int().min(0).optional().describe("Pagination offset; continue with next_offset"),
        cursor: z.string().min(1).max(1024).optional().describe("Opaque cursor returned as next_cursor; pass cursor or offset, not both"),
        full: z.boolean().optional().describe("Return the legacy exhaustive prose output, subject to safety maxima"),
        all: z.boolean().optional().describe("Compatibility alias for full exhaustive prose output"),
      },
      async ({ include_archived, limit, offset, cursor, full, all }) => {
        try {
          // http authority routing: list agents from the shared <app-host>/v1
          // dataset rather than this machine's local SQLite island.
          const cloud = getTodosCloudClient();
          const agents = cloud
            ? await cloudListAgents(cloud, { include_archived: include_archived ?? false })
            : listAgents({ include_archived: include_archived ?? false });
          if (full || all) {
            const body = agents.map((agent) => {
              const statusTag = agent.status === "archived" ? " [archived]" : "";
              return `${agent.id} | ${agent.name}${statusTag}${agent.description ? ` - ${agent.description}` : ""} (last seen: ${agent.last_seen_at})`;
            }).join("\n");
            const text = agents.length === 0 ? "No agents registered." : `${agents.length} agent(s):\n${body}`;
            return { content: [{ type: "text" as const, text: legacyCollectionText("agents", agents.length, text) }] };
          }
          const page = buildCollectionPage({
            collection: "agents", query: { include_archived: include_archived === true }, order: "name.casefold:asc,id:asc:v1",
            key: "agents", rows: agents, project: compactAgentRow,
            identity: (agent) => agent.id,
            orderKey: (agent) => typeof agent.name === "string" ? agent.name.normalize("NFKC").toLowerCase() : "",
            snapshotValue: (agent) => agent, limit, offset, cursor,
          });
          return { content: [{ type: "text" as const, text: compactJson(page) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // get_agent
  if (shouldRegisterTool("get_agent")) {
    server.tool(
      "get_agent",
      "Get agent details by exact immutable ID. Use list_agents to resolve a name first.",
      {
        agent_id: z.string().optional().describe("Exact immutable agent ID"),
        id: z.string().optional().describe("Compatibility alias for agent_id; exact immutable agent ID"),
      },
      async ({ agent_id, id }) => {
        try {
          const identifier = (agent_id || id || "").trim();
          if (!identifier) {
            return { content: [{ type: "text" as const, text: "Provide the exact agent_id. Use list_agents to resolve a name first." }], isError: true };
          }
          // GET /v1/agents/:id is an exact-ID contract. The previous tool
          // advertised name lookup even though the authority adapter calls
          // store.agents.get(id), which made a name-shaped request a false 404.
          const cloud = getTodosCloudClient();
          const agent = cloud
            ? await cloudGetAgent(cloud, identifier)
            : getAgent(identifier);
          if (!agent) {
            return { content: [{ type: "text" as const, text: `Agent not found by exact ID: ${identifier}` }], isError: true };
          }
          const parts = [
            `ID: ${agent.id}`,
            `Name: ${agent.name}`,
          ];
          if (agent.description) parts.push(`Description: ${agent.description}`);
          if (agent.metadata && Object.keys(agent.metadata).length > 0) parts.push(`Metadata: ${JSON.stringify(agent.metadata)}`);
          parts.push(`Created: ${agent.created_at}`);
          parts.push(`Last seen: ${agent.last_seen_at}`);
          return { content: [{ type: "text" as const, text: parts.join("\n") }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // rename_agent
  if (shouldRegisterTool("rename_agent")) {
    server.tool(
      "rename_agent",
      "Rename an agent. Resolve by id or current name.",
      {
        id: z.string().optional(),
        name: z.string().optional(),
        new_name: z.string(),
      },
      async ({ id, name, new_name }) => {
        try {
          if (!id && !name) {
            return { content: [{ type: "text" as const, text: "Provide either id or name." }], isError: true };
          }
          const agent = id ? getAgent(id) : getAgentByName(name!);
          if (!agent) {
            return { content: [{ type: "text" as const, text: `Agent not found: ${id || name}` }], isError: true };
          }
          const oldName = agent.name;
          const db = getDatabase();
          let oldNameUniquelyIdentifiesAgent = false;
          try {
            oldNameUniquelyIdentifiesAgent = resolvePartialId(db, "agents", oldName) === agent.id;
          } catch (error) {
            if (!(error instanceof IdentityAliasAmbiguousError)) throw error;
          }
          const updated = updateAgent(agent.id, { name: new_name });

          // Update differently cased task aliases only when the old name
          // uniquely identified this agent before the rename.
          // Legacy databases can contain two distinct agents whose names differ
          // only by case. A case-insensitive UPDATE would transfer both agents'
          // tasks to the renamed agent. The agent's id form is unaffected by a
          // rename and is intentionally not part of this UPDATE.
          const tasksResult = db.run(
            oldNameUniquelyIdentifiesAgent
              ? "UPDATE tasks SET assigned_to = ? WHERE LOWER(assigned_to) = LOWER(?)"
              : "UPDATE tasks SET assigned_to = ? WHERE assigned_to = ?",
            [new_name, oldName],
          );

          const taskNote = tasksResult.changes > 0
            ? `\nUpdated assigned_to on ${tasksResult.changes} task(s).`
            : "";

          return {
            content: [{
              type: "text" as const,
              text: `Agent renamed: ${oldName} -> ${updated.name}\nID: ${updated.id}${taskNote}`,
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // update_agent
  if (shouldRegisterTool("update_agent")) {
    server.tool(
      "update_agent",
      "Update an agent's description, role, title, or other metadata. Resolve by id or name.",
      {
        agent_id: z.string().optional(),
        id: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        role: z.string().optional(),
        title: z.string().optional(),
        level: z.string().optional(),
        capabilities: z.array(z.string()).optional(),
        permissions: z.array(z.string()).optional(),
        metadata: z.record(z.unknown()).optional(),
      },
      async ({ agent_id, id, name, ...updates }) => {
        try {
          const identifier = agent_id || id || name;
          if (!identifier) {
            return { content: [{ type: "text" as const, text: "Provide agent_id, id, or name." }], isError: true };
          }
          const agent = getAgent(identifier) || getAgentByName(identifier);
          if (!agent) {
            return { content: [{ type: "text" as const, text: `Agent not found: ${identifier}` }], isError: true };
          }
          const updated = updateAgent(agent.id, updates);
          return { content: [{ type: "text" as const, text: `Agent updated: ${updated.name} (${updated.id.slice(0, 8)})` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // delete_agent
  if (shouldRegisterTool("delete_agent")) {
    server.tool(
      "delete_agent",
      "Archive an agent (soft delete). The agent is hidden from list_agents but preserved for task history. Use unarchive_agent to restore. Resolve by id or name.",
      {
        agent_id: z.string().optional(),
        id: z.string().optional(),
        name: z.string().optional(),
      },
      async ({ agent_id, id, name }) => {
        try {
          const identifier = agent_id || id || name;
          if (!identifier) {
            return { content: [{ type: "text" as const, text: "Provide agent_id, id, or name." }], isError: true };
          }
          const agent = getAgent(identifier) || getAgentByName(identifier);
          if (!agent) {
            return { content: [{ type: "text" as const, text: `Agent not found: ${identifier}` }], isError: true };
          }
          const archived = archiveAgent(agent.id);
          return {
            content: [{
              type: "text" as const,
              text: archived ? `Agent archived: ${agent.name} (${agent.id}). Use unarchive_agent to restore.` : `Failed to archive agent: ${agent.name}`,
            }],
            isError: !archived,
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // unarchive_agent
  if (shouldRegisterTool("unarchive_agent")) {
    server.tool(
      "unarchive_agent",
      "Restore an archived agent back to active status. Resolve by id or name.",
      {
        agent_id: z.string().optional(),
        id: z.string().optional(),
        name: z.string().optional(),
      },
      async ({ agent_id, id, name }) => {
        try {
          const identifier = agent_id || id || name;
          if (!identifier) {
            return { content: [{ type: "text" as const, text: "Provide agent_id, id, or name." }], isError: true };
          }
          const agent = getAgent(identifier) || getAgentByName(identifier);
          if (!agent) {
            return { content: [{ type: "text" as const, text: `Agent not found: ${identifier}` }], isError: true };
          }
          if (agent.status === "active") {
            return { content: [{ type: "text" as const, text: `Agent ${agent.name} is already active.` }] };
          }
          const restored = unarchiveAgent(agent.id);
          return {
            content: [{
              type: "text" as const,
              text: restored ? `Agent restored: ${agent.name} (${agent.id}) is now active.` : `Failed to restore agent: ${agent.name}`,
            }],
            isError: !restored,
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // heartbeat
  if (shouldRegisterTool("heartbeat")) {
    server.tool(
      "heartbeat",
      "Update your last_seen_at timestamp to signal you're still active. Call periodically during long tasks to prevent being marked stale.",
      {
        agent_id: z.string().describe("Your agent ID or name."),
      },
      async ({ agent_id }) => {
        try {
          // http authority routing: heartbeat the SHARED cloud roster so a
          // flipped machine refreshes the same agent every other agent sees. The
          // local path 404'd cloud-only agents ("Agent not found").
          const cloud = getTodosCloudClient();
          if (cloud) {
            const a = await cloudHeartbeatAgent(cloud, agent_id);
            if (!a) {
              return { content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }], isError: true };
            }
            return {
              content: [{
                type: "text" as const,
                text: `Heartbeat: ${a.name} (${a.id}) — last_seen_at updated to ${a.last_seen_at}`,
              }],
            };
          }
          const agent = getAgent(agent_id) || getAgentByName(agent_id);
          if (!agent) {
            return { content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }], isError: true };
          }
          updateAgentActivity(agent.id);
          return {
            content: [{
              type: "text" as const,
              text: `Heartbeat: ${agent.name} (${agent.id}) — last_seen_at updated to ${new Date().toISOString()}`,
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  // release_agent
  if (shouldRegisterTool("release_agent")) {
    server.tool(
      "release_agent",
      "Explicitly release/logout an agent — clears session binding and makes the name immediately available. Call this when your session ends instead of waiting for the 30-minute stale timeout.",
      {
        agent_id: z.string().describe("Your agent ID or name."),
        session_id: z.string().optional().describe("Your session ID — if provided, release only succeeds if it matches (prevents other sessions from releasing your agent)."),
      },
      async ({ agent_id, session_id }) => {
        try {
          // http authority routing: release in the SHARED cloud roster so the
          // name frees up for every agent. The local path 404'd cloud-only agents.
          const cloud = getTodosCloudClient();
          if (cloud) {
            const result = await cloudReleaseAgent(cloud, agent_id, session_id);
            if (!result.agent) {
              return { content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }], isError: true };
            }
            if (!result.released) {
              return { content: [{ type: "text" as const, text: `Release denied: session_id does not match agent's current session.` }], isError: true };
            }
            return {
              content: [{
                type: "text" as const,
                text: `Agent released: ${result.agent.name} (${result.agent.id}) — session cleared, name is now available.`,
              }],
            };
          }
          const agent = getAgent(agent_id) || getAgentByName(agent_id);
          if (!agent) {
            return { content: [{ type: "text" as const, text: `Agent not found: ${agent_id}` }], isError: true };
          }
          const released = releaseAgent(agent.id, session_id);
          if (!released) {
            return { content: [{ type: "text" as const, text: `Release denied: session_id does not match agent's current session.` }], isError: true };
          }
          return {
            content: [{
              type: "text" as const,
              text: `Agent released: ${agent.name} (${agent.id}) — session cleared, name is now available.`,
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
