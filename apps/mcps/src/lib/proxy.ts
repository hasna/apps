import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TOOL_PREFIX_SEPARATOR } from "./config.js";
import { listServers, cacheTools } from "./registry.js";
import { getDb } from "./db.js";
import { assertLocalCommandConsent, type LocalCommandConsent } from "./local-command-consent.js";
import type { McpServerEntry, McpTool, ConnectedServer } from "../types.js";

const connections = new Map<string, ConnectedServer>();
const inflightConnections = new Map<string, Promise<ConnectedServer>>();
const CONNECT_CONCURRENCY = 4;

export interface ConnectOptions {
  localCommandConsent?: LocalCommandConsent;
}

function buildEnv(extra: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") merged[key] = value;
  }
  for (const [key, value] of Object.entries(extra || {})) {
    if (value === undefined || value === null) continue;
    merged[key] = String(value);
  }
  return merged;
}

function requireUrl(entry: McpServerEntry): URL {
  if (!entry.url) {
    throw new Error(`Server "${entry.id}" is missing a URL for ${entry.transport} transport`);
  }
  try {
    return new URL(entry.url);
  } catch {
    throw new Error(`Server "${entry.id}" has an invalid URL: ${entry.url}`);
  }
}

export async function connectToServer(entry: McpServerEntry, options: ConnectOptions = {}): Promise<ConnectedServer> {
  if (connections.has(entry.id)) {
    return connections.get(entry.id)!;
  }
  const inflight = inflightConnections.get(entry.id);
  if (inflight) {
    return inflight;
  }

  const client = new Client({ name: "mcps-proxy", version: "0.0.1" });

  let transport;
  const connectPromise = (async () => {
    try {
      if (entry.transport === "stdio") {
        if (!entry.command?.trim()) {
          throw new Error(`Server "${entry.id}" is missing a command`);
        }
        assertLocalCommandConsent(
          {
            command: entry.command,
            args: entry.args,
            env: entry.env,
            transport: entry.transport,
            operation: "launch",
          },
          options.localCommandConsent,
        );
        transport = new StdioClientTransport({
          command: entry.command,
          args: entry.args,
          env: buildEnv(entry.env),
        });
      } else if (entry.transport === "sse") {
        transport = new SSEClientTransport(requireUrl(entry));
      } else {
        transport = new StreamableHTTPClientTransport(requireUrl(entry));
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
          try {
            await client.close();
          } finally {
            connections.delete(entry.id);
          }
        },
      };

      // Store client on the connected object for tool calls
      (connected as any)._client = client;
      connections.set(entry.id, connected);

      // Record successful connection
      try {
        getDb().prepare("UPDATE servers SET last_connected_at = datetime('now'), last_error = NULL WHERE id = ?").run(entry.id);
      } catch {
        // ignore DB errors — don't fail the connection
      }

      return connected;
    } catch (err) {
      // Record connection failure
      try {
        getDb().prepare("UPDATE servers SET last_error = ? WHERE id = ?").run((err as Error).message, entry.id);
      } catch {
        // ignore DB errors
      }
      try {
        await client.close();
      } catch {
        // ignore cleanup errors
      }
      throw err;
    }
  })();

  inflightConnections.set(entry.id, connectPromise);
  try {
    return await connectPromise;
  } finally {
    inflightConnections.delete(entry.id);
  }
}

export async function disconnectServer(id: string): Promise<void> {
  const conn = connections.get(id);
  if (conn) {
    await conn.disconnect();
    return;
  }
  const inflight = inflightConnections.get(id);
  if (inflight) {
    try {
      const pending = await inflight;
      await pending.disconnect();
    } catch {
      // ignore inflight failures
    }
  }
}

export async function disconnectAll(): Promise<void> {
  const ids = Array.from(connections.keys());
  await Promise.allSettled(ids.map((id) => disconnectServer(id)));
  const inflight = Array.from(inflightConnections.values());
  await Promise.allSettled(
    inflight.map(async (promise) => {
      try {
        const conn = await promise;
        await conn.disconnect();
      } catch {
        // ignore inflight failures
      }
    })
  );
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
  const normalized = prefixedName.trim();
  if (!normalized) {
    throw new Error("Tool name is required");
  }
  const sepIdx = normalized.indexOf(TOOL_PREFIX_SEPARATOR);
  if (sepIdx === -1) {
    throw new Error(`Invalid tool name "${prefixedName}" — expected format: server_id${TOOL_PREFIX_SEPARATOR}tool_name`);
  }

  const serverId = normalized.slice(0, sepIdx).trim();
  const toolName = normalized.slice(sepIdx + TOOL_PREFIX_SEPARATOR.length).trim();
  if (!serverId || !toolName) {
    throw new Error(`Invalid tool name "${prefixedName}" — expected format: server_id${TOOL_PREFIX_SEPARATOR}tool_name`);
  }

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

export async function connectAllEnabled(options: ConnectOptions = {}): Promise<ConnectedServer[]> {
  const servers = listServers().filter((s) => s.enabled);
  const results: ConnectedServer[] = [];

  let index = 0;
  const workerCount = Math.min(CONNECT_CONCURRENCY, servers.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = index++;
      if (current >= servers.length) return;
      const server = servers[current];
      try {
        const conn = await connectToServer(server, options);
        results.push(conn);
      } catch (err) {
        console.error(`Failed to connect to ${server.name}: ${(err as Error).message}`);
      }
    }
  });

  await Promise.all(workers);
  return results;
}
