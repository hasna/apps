// ─── Agent and Project tools ─────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
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

server.tool(
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

server.tool(
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

server.tool(
  "list_agents",
  "List all registered agents.",
  { project_id: z.string().optional() },
  async ({ project_id }) => {
    try {
      return json({ agents: listAgents(project_id) });
    } catch (e) { return err(e); }
  }
);

server.tool(
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

server.tool(
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

server.tool(
  "browser_project_list",
  "List all registered projects",
  {},
  async () => {
    try {
      return json({ projects: listProjects() });
    } catch (e) { return err(e); }
  }
);

}