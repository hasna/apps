// MCP Server for terminal — exposes terminal capabilities to AI agents

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createSession } from "../sessions-db.js";
import { getPackageVersion } from "../package-info.js";
import { createHelpers } from "./tools/helpers.js";
import { truncateText } from "../compact-output.js";

// Tool registration modules
import { registerExecuteTools } from "./tools/execute.js";
import { registerGitTools } from "./tools/git.js";
import { registerSearchTools } from "./tools/search.js";
import { registerFileTools } from "./tools/files.js";
import { registerProjectTools } from "./tools/project.js";
import { registerProcessTools } from "./tools/process.js";
import { registerBatchTools } from "./tools/batch.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerMetaTools } from "./tools/meta.js";

// ── server ───────────────────────────────────────────────────────────────────

export function createServer(): McpServer {
  const server = new McpServer({
    name: "terminal",
    version: getPackageVersion(),
  });

  // Create a session for this MCP server instance
  const sessionId = createSession(process.cwd(), "mcp");

  // ── Mementos: cross-session project memory ────────────────────────────────
  try {
    const mementos = require("@hasna/mementos");
    const projectName = process.cwd().split("/").pop() ?? "unknown";
    const project = mementos.registerProject(projectName, process.cwd());
    const mementosProjectId = project?.id ?? null;
    mementos.registerAgent("terminal-mcp");
    if (mementosProjectId) mementos.setFocus(mementosProjectId);
  } catch {} // mementos optional — works without it

  // Create shared helpers and register all tool groups
  const h = createHelpers(sessionId);

  registerExecuteTools(server, h);
  registerGitTools(server, h);
  registerSearchTools(server, h);
  registerFileTools(server, h);
  registerProjectTools(server, h);
  registerProcessTools(server, h);
  registerBatchTools(server, h);
  registerMemoryTools(server, h);
  registerMetaTools(server, h);

  // ── Agent Tools ──────────────────────────────────────────────────────────
  const _agentReg = new Map<string, { id: string; name: string; last_seen_at: string; project_id?: string }>();

  server.tool(
    "register_agent",
    "Register an agent session (idempotent). Auto-updates last_seen_at on re-register.",
    { name: z.string(), session_id: z.string().optional() },
    async (a) => {
      const existing = [..._agentReg.values()].find(x => x.name === a.name);
      if (existing) { existing.last_seen_at = new Date().toISOString(); return { content: [{ type: "text" as const, text: JSON.stringify(existing) }] }; }
      const id = Math.random().toString(36).slice(2, 10);
      const ag = { id, name: a.name, last_seen_at: new Date().toISOString() };
      _agentReg.set(id, ag);
      return { content: [{ type: "text" as const, text: JSON.stringify(ag) }] };
    }
  );

  server.tool(
    "heartbeat",
    "Update last_seen_at to signal agent is active.",
    { agent_id: z.string() },
    async (a) => {
      const ag = _agentReg.get(a.agent_id);
      if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${a.agent_id}` }], isError: true };
      ag.last_seen_at = new Date().toISOString();
      return { content: [{ type: "text" as const, text: JSON.stringify({ id: ag.id, name: ag.name, last_seen_at: ag.last_seen_at }) }] };
    }
  );

  server.tool(
    "set_focus",
    "Set active project context for this agent session.",
    { agent_id: z.string(), project_id: z.string().nullable().optional() },
    async (a) => {
      const ag = _agentReg.get(a.agent_id);
      if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${a.agent_id}` }], isError: true };
      (ag as any).project_id = a.project_id ?? undefined;
      return { content: [{ type: "text" as const, text: a.project_id ? `Focus: ${a.project_id}` : "Focus cleared" }] };
    }
  );

  server.tool(
    "list_agents",
    "List all registered agents.",
    { limit: z.number().optional().describe("Max agents to return (default: 20)") },
    async ({ limit }) => {
      const agents = [..._agentReg.values()];
      const pageSize = Math.min(limit ?? 20, 100);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        agents: agents.slice(0, pageSize).map((agent) => ({
          ...agent,
          name: truncateText(agent.name, 80),
          project_id: agent.project_id ? truncateText(agent.project_id, 100) : undefined,
        })),
        total: agents.length,
        returned: Math.min(agents.length, pageSize),
        hint: agents.length === 0 ? "No agents registered." : undefined,
      }) }] };
    }
  );

  return server;
}

// ── main: start MCP server via stdio ─────────────────────────────────────────

export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("terminal MCP server running on stdio");
}
