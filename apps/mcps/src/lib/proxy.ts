import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TOOL_PREFIX_SEPARATOR } from "./config.js";
import { listServers, cacheTools } from "./registry.js";
import type { McpServerEntry, McpTool, ConnectedServer } from "../types.js";

const connections = new Map<string, ConnectedServer>();

export async function connectToServer(entry: McpServerEntry): Promise<ConnectedServer> {
  if (connections.has(entry.id)) {
    return connections.get(entry.id)!;
  }

  const client = new Client({ name: "mcps-proxy", version: "0.0.1" });

  let transport;
  if (entry.transport === "stdio") {
    transport = new StdioClientTransport({
      command: entry.command,
      args: entry.args,
      env: { ...process.env, ...entry.env } as Record<string, string>,
    });
  } else if (entry.transport === "sse") {
    transport = new SSEClientTransport(new URL(entry.url!));
  } else {
    transport = new StreamableHTTPClientTransport(new URL(entry.url!));
  }

  await client.connect(transport);

  const result = await client.listTools();
  const tools: McpTool[] = (result.tools || []).map((t) => ({
    server_id: entry.id,
    name: t.name,
    description: t.description || "",
    input_schema: (t.inputSchema as Record<string, unknown>) || {},
  }));

  cacheTools(
    entry.id,
    tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
  );

  const connected: ConnectedServer = {
    entry,
    tools,
    disconnect: async () => {
      await client.close();
      connections.delete(entry.id);
    },
  };

  // Store client on the connected object for tool calls
  (connected as any)._client = client;
  connections.set(entry.id, connected);

  return connected;
}

export async function disconnectServer(id: string): Promise<void> {
  const conn = connections.get(id);
  if (conn) {
    await conn.disconnect();
  }
}

export async function disconnectAll(): Promise<void> {
  const ids = Array.from(connections.keys());
  await Promise.all(ids.map((id) => disconnectServer(id)));
}

export function listAllTools(): McpTool[] {
  const tools: McpTool[] = [];
  for (const conn of connections.values()) {
    for (const tool of conn.tools) {
      tools.push({
        ...tool,
        name: `${conn.entry.id}${TOOL_PREFIX_SEPARATOR}${tool.name}`,
      });
    }
  }
  return tools;
}

export async function callTool(
  prefixedName: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const sepIdx = prefixedName.indexOf(TOOL_PREFIX_SEPARATOR);
  if (sepIdx === -1) {
    throw new Error(`Invalid tool name "${prefixedName}" — expected format: server_id${TOOL_PREFIX_SEPARATOR}tool_name`);
  }

  const serverId = prefixedName.slice(0, sepIdx);
  const toolName = prefixedName.slice(sepIdx + TOOL_PREFIX_SEPARATOR.length);

  const conn = connections.get(serverId);
  if (!conn) {
    throw new Error(`Server "${serverId}" is not connected`);
  }

  const client = (conn as any)._client as Client;
  const result = await client.callTool({ name: toolName, arguments: args });

  return {
    content: (result.content as Array<{ type: string; text: string }>) || [
      { type: "text", text: JSON.stringify(result) },
    ],
  };
}

export async function refreshTools(id: string): Promise<McpTool[]> {
  const conn = connections.get(id);
  if (!conn) {
    throw new Error(`Server "${id}" is not connected`);
  }

  const client = (conn as any)._client as Client;
  const result = await client.listTools();
  const tools: McpTool[] = (result.tools || []).map((t) => ({
    server_id: id,
    name: t.name,
    description: t.description || "",
    input_schema: (t.inputSchema as Record<string, unknown>) || {},
  }));

  conn.tools = tools;
  cacheTools(
    id,
    tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
  );

  return tools;
}

export async function connectAllEnabled(): Promise<ConnectedServer[]> {
  const servers = listServers().filter((s) => s.enabled);
  const results: ConnectedServer[] = [];

  for (const server of servers) {
    try {
      const conn = await connectToServer(server);
      results.push(conn);
    } catch (err) {
      console.error(`Failed to connect to ${server.name}: ${(err as Error).message}`);
    }
  }

  return results;
}
