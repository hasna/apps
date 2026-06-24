// ─── Agent and Project tools ─────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { compactList, truncateText } from "./compact.js";
import {
  registerTool,
  z,
  json,
  err,
  registerAgent,
  heartbeat,
  listAgents,
  ensureProject,
  listProjects,
} from "./helpers.js";

export function registerAgentsAndProjects(server: McpServer) {

// ── Agent Tools ───────────────────────────────────────────────────────────────

registerTool(server,
  "register_agent",
  "Register an agent session. Returns agent_id. Auto-triggers a heartbeat.",
  {
    name: z.string(),
    description: z.string().optional(),
    session_id: z.string().optional(),
    project_id: z.string().optional(),
    working_dir: z.string().optional(),
  },
  async ({ name, description, session_id, project_id, working_dir }) => {
    try {
      const agent = registerAgent(name, { description, sessionId: session_id, projectId: project_id, workingDir: working_dir });
      return json({ agent });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "heartbeat",
  "Update last_seen_at to signal agent is active.",
  { agent_id: z.string() },
  async ({ agent_id }) => {
    try {
      heartbeat(agent_id);
      return json({ ok: true, agent_id, timestamp: new Date().toISOString() });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "list_agents",
  "List registered agents. Compact by default; set verbose=true for full records.",
  { project_id: z.string().optional(), limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ project_id, limit, offset, verbose }) => {
    try {
      const agents = listAgents(project_id);
      if (verbose) {
        const page = compactList(agents, limit, (agent) => agent, { offset });
        return json({ agents: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(agents, limit, (agent) => ({
        id: agent.id,
        name: agent.name,
        description: truncateText(agent.description, 120) || undefined,
        session_id: agent.session_id,
        project_id: agent.project_id,
        last_seen: agent.last_seen,
      }), {
        offset,
        hint: "Set verbose=true for full agent records.",
      });
      return json({ agents: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "set_focus",
  "Set active project context for this agent session.",
  { agent_id: z.string(), project_id: z.string().optional() },
  async ({ agent_id, project_id }) => {
    try {
      const { updateAgent: update } = await import("../lib/agents.js");
      update(agent_id, { project_id: project_id ?? undefined });
      return json({ ok: true, agent_id, project_id });
    } catch (e) { return err(e); }
  }
);

// ── Project Tools ─────────────────────────────────────────────────────────────

registerTool(server,
  "browser_project_create",
  "Create or ensure a project exists",
  { name: z.string(), path: z.string(), description: z.string().optional() },
  async ({ name, path, description }) => {
    try {
      const project = ensureProject(name, path, description);
      return json({ project });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_project_list",
  "List registered projects. Compact by default; set verbose=true for full records.",
  { limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ limit, offset, verbose }) => {
    try {
      const projects = listProjects();
      if (verbose) {
        const page = compactList(projects, limit, (project) => project, { offset });
        return json({ projects: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(projects, limit, (project) => ({
        id: project.id,
        name: project.name,
        path: truncateText(project.path, 140),
        description: truncateText(project.description, 120) || undefined,
        created_at: project.created_at,
      }), {
        offset,
        hint: "Set verbose=true for full project paths and descriptions.",
      });
      return json({ projects: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

}
