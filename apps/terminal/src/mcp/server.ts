// MCP Server for terminal — exposes terminal capabilities to AI agents

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSession } from "../sessions-db.js";
import { createHelpers } from "./tools/helpers.js";

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
import { registerCloudTools } from "@hasna/cloud";

// ── server ───────────────────────────────────────────────────────────────────

export function createServer(): McpServer {
  const server = new McpServer({
    name: "terminal",
    version: "4.2.0",
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
  registerCloudTools(server, "terminal");

  return server;
}

// ── main: start MCP server via stdio ─────────────────────────────────────────

export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("terminal MCP server running on stdio");
}
