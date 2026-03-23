import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  addServer,
  removeServer,
  listServers,
  getServer,
  enableServer,
  disableServer,
  updateServer,
  getCachedTools,
} from "../lib/registry.js";
import { searchRegistry, installFromRegistry } from "../lib/remote.js";
import { listAwesomeServers } from "../lib/finder.js";
import {
  listSources,
  getSource,
  addSource,
  removeSource,
  enableSource as enableSourceFn,
  disableSource as disableSourceFn,
  findServers,
} from "../lib/sources.js";
import { installToAgents } from "../lib/install.js";
import type { AgentTarget } from "../lib/install.js";
import {
  connectAllEnabled,
  connectToServer,
  listAllTools,
  callTool,
  disconnectAll,
} from "../lib/proxy.js";
import { diagnoseServer } from "../lib/doctor.js";
import { TOOL_PREFIX_SEPARATOR } from "../lib/config.js";
import { getAdapter } from "../lib/db.js";

function redactServerEnv<T extends { env: Record<string, string> }>(server: T): T {
  return { ...server, env: {} };
}

const VERSION = (() => {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version || "0.0.1";
  } catch {
    return "0.0.1";
  }
})();

const server = new McpServer({
  name: "mcps",
  version: VERSION,
});

// --- in-memory agent registry ---
interface _McpsAgent { id: string; name: string; session_id?: string; last_seen_at: string; project_id?: string; }
const _mcpsAgents = new Map<string, _McpsAgent>();

// --- Management Tools ---

server.tool(
  "list_servers",
  "List all registered MCP servers",
  {},
  async () => {
    const servers = listServers();
    return {
      content: [{ type: "text", text: JSON.stringify(servers.map(redactServerEnv), null, 2) }],
    };
  }
);

server.tool(
  "search_registry",
  "Search the official MCP registry for servers",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const results = await searchRegistry(query);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  "add_server",
  "Register a new MCP server",
  {
    command: z.string().describe("Command to run the server (e.g., npx, bunx, node)"),
    args: z.array(z.string()).optional().describe("Arguments for the command"),
    name: z.string().optional().describe("Display name"),
    description: z.string().optional().describe("Description"),
    transport: z
      .enum(["stdio", "sse", "streamable-http"])
      .optional()
      .describe("Transport type"),
    url: z.string().optional().describe("URL for remote transports"),
    env: z
      .record(z.string())
      .optional()
      .describe("Environment variables"),
  },
  async ({ command, args, name, description, transport, url, env }) => {
    const entry = addServer({
      command,
      args: args || [],
      name,
      description,
      transport,
      url,
      env: env || {},
    });
    return {
      content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
    };
  }
);

server.tool(
  "install_from_registry",
  "Install an MCP server from the official registry",
  { id: z.string().describe("Registry server ID") },
  async ({ id }) => {
    const entry = await installFromRegistry(id);
    return {
      content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
    };
  }
);

server.tool(
  "remove_server",
  "Remove a registered MCP server",
  { id: z.string().describe("Server ID to remove") },
  async ({ id }) => {
    const existing = getServer(id);
    if (!existing) {
      return {
        content: [{ type: "text", text: `Server "${id}" not found.` }],
        isError: true,
      };
    }
    removeServer(id);
    return {
      content: [{ type: "text", text: `Removed server: ${existing.name} [${id}]` }],
    };
  }
);

server.tool(
  "enable_server",
  "Enable a registered MCP server",
  { id: z.string().describe("Server ID to enable") },
  async ({ id }) => {
    const existing = getServer(id);
    if (!existing) {
      return {
        content: [{ type: "text", text: `Server "${id}" not found.` }],
        isError: true,
      };
    }
    const entry = enableServer(id);
    return {
      content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
    };
  }
);

server.tool(
  "disable_server",
  "Disable a registered MCP server",
  { id: z.string().describe("Server ID to disable") },
  async ({ id }) => {
    const existing = getServer(id);
    if (!existing) {
      return {
        content: [{ type: "text", text: `Server "${id}" not found.` }],
        isError: true,
      };
    }
    const entry = disableServer(id);
    return {
      content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
    };
  }
);

server.tool(
  "update_server",
  "Update fields of a registered MCP server",
  {
    id: z.string().describe("Server ID to update"),
    name: z.string().optional().describe("New display name"),
    description: z.string().optional().describe("New description"),
    command: z.string().optional().describe("New command"),
    args: z.array(z.string()).optional().describe("New args list"),
    transport: z.enum(["stdio", "sse", "streamable-http"]).optional().describe("New transport type"),
    url: z.string().optional().describe("New URL for remote transports"),
  },
  async ({ id, name, description, command, args, transport, url }) => {
    const existing = getServer(id);
    if (!existing) {
      return {
        content: [{ type: "text", text: `Server "${id}" not found.` }],
        isError: true,
      };
    }
    const fields: Parameters<typeof updateServer>[1] = {};
    if (name !== undefined) fields.name = name;
    if (description !== undefined) fields.description = description;
    if (command !== undefined) fields.command = command;
    if (args !== undefined) fields.args = args;
    if (transport !== undefined) fields.transport = transport;
    if (url !== undefined) fields.url = url;
    const updated = updateServer(id, fields);
    return {
      content: [{ type: "text", text: JSON.stringify(redactServerEnv(updated), null, 2) }],
    };
  }
);

server.tool(
  "list_tools",
  "List all cached tools across registered servers without connecting. Optionally filter by server_id.",
  { server_id: z.string().optional().describe("Server ID to filter by (optional)") },
  async ({ server_id }) => {
    if (server_id) {
      const tools = getCachedTools(server_id);
      return {
        content: [{ type: "text", text: JSON.stringify(tools.map(t => ({ ...t, server_id })), null, 2) }],
      };
    }
    const servers = listServers();
    const allTools: Array<{ server_id: string; name: string; description: string; input_schema: Record<string, unknown> }> = [];
    for (const s of servers) {
      const tools = getCachedTools(s.id);
      for (const t of tools) {
        allTools.push({ server_id: s.id, ...t });
      }
    }
    return {
      content: [{ type: "text", text: JSON.stringify(allTools, null, 2) }],
    };
  }
);

server.tool(
  "get_server_info",
  "Get detailed information about a registered MCP server",
  { id: z.string().describe("Server ID") },
  async ({ id }) => {
    const entry = getServer(id);
    if (!entry) {
      return {
        content: [{ type: "text", text: `Server "${id}" not found.` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(redactServerEnv(entry), null, 2) }],
    };
  }
);

// --- Finder Tools ---

server.tool(
  "find_mcp_servers",
  "Search for MCP servers across configured sources (official registry, npm, GitHub topics, awesome lists). Use list_sources to see available source IDs.",
  {
    query: z.string().describe("Search query (e.g. 'filesystem', 'postgres', 'browser')"),
    sources: z
      .array(z.string())
      .optional()
      .describe("Source IDs to search (default: all enabled). Use list_sources to get IDs."),
    limit: z.number().optional().describe("Max results per source (default: 20)"),
  },
  async ({ query, sources, limit }) => {
    const results = await findServers(query, { sources, limit });
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  "list_sources",
  "List all configured search sources for finding MCP servers",
  {},
  async () => {
    const sources = listSources();
    return {
      content: [{ type: "text", text: JSON.stringify(sources, null, 2) }],
    };
  }
);

server.tool(
  "add_source",
  "Add a new search source for finding MCP servers",
  {
    name: z.string().describe("Source name"),
    type: z
      .enum(["mcp-registry", "awesome-list", "npm-search", "github-topic"])
      .describe("Source type"),
    url: z.string().describe("Source URL endpoint"),
    description: z.string().optional().describe("Description"),
  },
  async ({ name, type, url, description }) => {
    const source = addSource({ name, type, url, description });
    return {
      content: [{ type: "text", text: JSON.stringify(source, null, 2) }],
    };
  }
);

server.tool(
  "remove_source",
  "Remove a search source by ID",
  { id: z.string().describe("Source ID to remove") },
  async ({ id }) => {
    const existing = getSource(id);
    if (!existing) {
      return {
        content: [{ type: "text", text: `Source "${id}" not found.` }],
        isError: true,
      };
    }
    removeSource(id);
    return {
      content: [{ type: "text", text: `Removed source: ${existing.name} [${id}]` }],
    };
  }
);

server.tool(
  "enable_source_finder",
  "Enable a search source",
  { id: z.string().describe("Source ID to enable") },
  async ({ id }) => {
    const existing = getSource(id);
    if (!existing) {
      return {
        content: [{ type: "text", text: `Source "${id}" not found.` }],
        isError: true,
      };
    }
    enableSourceFn(id);
    return {
      content: [{ type: "text", text: `Enabled source: ${existing.name}` }],
    };
  }
);

server.tool(
  "disable_source_finder",
  "Disable a search source",
  { id: z.string().describe("Source ID to disable") },
  async ({ id }) => {
    const existing = getSource(id);
    if (!existing) {
      return {
        content: [{ type: "text", text: `Source "${id}" not found.` }],
        isError: true,
      };
    }
    disableSourceFn(id);
    return {
      content: [{ type: "text", text: `Disabled source: ${existing.name}` }],
    };
  }
);

server.tool(
  "install_to_agents",
  "Install a registered MCP server into Claude Code, Codex, and/or Gemini",
  {
    id: z.string().describe("Server ID to install (from list_servers)"),
    targets: z
      .array(z.enum(["claude", "codex", "gemini"]))
      .optional()
      .describe("Target agents to install into (default: all)"),
  },
  async ({ id, targets }) => {
    const entry = getServer(id);
    if (!entry) {
      return {
        content: [{ type: "text", text: `Server "${id}" not found.` }],
        isError: true,
      };
    }
    const agentTargets = (targets as AgentTarget[] | undefined) ?? ["claude", "codex", "gemini"];
    const results = installToAgents(entry, agentTargets);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

server.tool(
  "list_awesome_servers",
  "List all MCP servers from the curated punkpeye/awesome-mcp-servers GitHub list",
  {},
  async () => {
    const results = await listAwesomeServers();
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// --- Proxy Tools ---

server.tool(
  "connect_and_list_tools",
  "Connect to all enabled MCP servers and list their available tools",
  {},
  async () => {
    let tools = [];
    try {
      await connectAllEnabled();
      tools = listAllTools();
    } finally {
      await disconnectAll().catch(() => undefined);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(tools, null, 2) }],
    };
  }
);

server.tool(
  "call_upstream_tool",
  `Call a tool on a connected upstream MCP server. Tool name format: server_id${TOOL_PREFIX_SEPARATOR}tool_name`,
  {
    tool_name: z
      .string()
      .describe(`Prefixed tool name (server_id${TOOL_PREFIX_SEPARATOR}tool_name)`),
    arguments: z
      .record(z.unknown())
      .optional()
      .describe("Tool arguments as key-value pairs"),
  },
  async ({ tool_name, arguments: args }) => {
    try {
      const sepIdx = tool_name.indexOf(TOOL_PREFIX_SEPARATOR);
      if (sepIdx === -1) {
        return {
          content: [{ type: "text", text: `Error: Invalid tool name "${tool_name}"` }],
          isError: true,
        };
      }
      const serverId = tool_name.slice(0, sepIdx);
      const entry = getServer(serverId);
      if (!entry) {
        return {
          content: [{ type: "text", text: `Error: Server "${serverId}" not found.` }],
          isError: true,
        };
      }
      if (!entry.enabled) {
        return {
          content: [{ type: "text", text: `Error: Server "${serverId}" is disabled.` }],
          isError: true,
        };
      }
      await connectToServer(entry);
      const result = await callTool(tool_name, args || {});
      return { content: result.content as any };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "diagnose_server",
  "Run health checks on a registered MCP server",
  { id: z.string().describe("Server ID") },
  async ({ id }) => {
    const entry = getServer(id);
    if (!entry) return { content: [{ type: "text", text: `Server "${id}" not found.` }], isError: true };
    const report = await diagnoseServer(entry);
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  }
);

// --- Feedback ---

server.tool(
  "send_feedback",
  "Send feedback about this service",
  {
    message: z.string().describe("Feedback message"),
    email: z.string().optional().describe("Contact email (optional)"),
    category: z.enum(["bug", "feature", "general"]).optional().describe("Feedback category"),
  },
  async (params: { message: string; email?: string; category?: string }) => {
    const adapter = getAdapter();
    adapter.run(
      "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
      params.message, params.email || null, params.category || "general", VERSION
    );
    return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
  },
);

// --- Agent Tools ---

server.tool("register_agent", "Register an agent session. Returns agent_id. Auto-triggers a heartbeat.", {
  name: z.string(),
  session_id: z.string().optional(),
}, async (params) => {
  const existing = [..._mcpsAgents.values()].find(a => a.name === params.name);
  if (existing) { existing.last_seen_at = new Date().toISOString(); if (params.session_id) existing.session_id = params.session_id; return { content: [{ type: "text" as const, text: JSON.stringify(existing) }] }; }
  const id = Math.random().toString(36).slice(2, 10);
  const ag: _McpsAgent = { id, name: params.name, session_id: params.session_id, last_seen_at: new Date().toISOString() };
  _mcpsAgents.set(id, ag);
  return { content: [{ type: "text" as const, text: JSON.stringify(ag) }] };
});

server.tool("heartbeat", "Update last_seen_at to signal agent is active.", {
  agent_id: z.string(),
}, async (params) => {
  const ag = _mcpsAgents.get(params.agent_id);
  if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${params.agent_id}` }], isError: true };
  ag.last_seen_at = new Date().toISOString();
  return { content: [{ type: "text" as const, text: JSON.stringify({ agent_id: ag.id, last_seen_at: ag.last_seen_at }) }] };
});

server.tool("set_focus", "Set active project context for this agent session.", {
  agent_id: z.string(),
  project_id: z.string().optional(),
}, async (params) => {
  const ag = _mcpsAgents.get(params.agent_id);
  if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${params.agent_id}` }], isError: true };
  ag.project_id = params.project_id;
  return { content: [{ type: "text" as const, text: JSON.stringify({ agent_id: ag.id, project_id: ag.project_id ?? null }) }] };
});

server.tool("list_agents", "List all registered agents.", {}, async () => {
  return { content: [{ type: "text" as const, text: JSON.stringify([..._mcpsAgents.values()]) }] };
});

// --- Start ---

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Auto-run if executed directly
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/mcp/index.ts") ||
  process.argv[1]?.endsWith("/bin/mcp.js");

if (isDirectRun) {
  startMcpServer().catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
  });
}
