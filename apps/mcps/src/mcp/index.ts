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
} from "../lib/registry.js";
import { searchRegistry, installFromRegistry } from "../lib/remote.js";
import {
  connectAllEnabled,
  connectToServer,
  listAllTools,
  callTool,
  disconnectAll,
} from "../lib/proxy.js";
import { TOOL_PREFIX_SEPARATOR } from "../lib/config.js";

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
