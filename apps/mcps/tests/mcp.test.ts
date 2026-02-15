import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import "./setup";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addServer, listServers, getServer, removeServer } from "../src/lib/registry";
import { getDb, closeDb } from "../src/lib/db";

// We can't import the module-level `server` from mcp/index.ts without
// triggering auto-run logic. Instead we re-create the tool registrations
// using the same pattern. This tests the tool handler logic end-to-end.

function clearDb() {
  const db = getDb();
  db.exec("DELETE FROM tool_cache");
  db.exec("DELETE FROM servers");
}

function createMcpServer() {
  const server = new McpServer({ name: "mcps-test", version: "0.0.1" });

  server.tool("list_servers", "List all registered MCP servers", {}, async () => {
    const servers = listServers();
    return { content: [{ type: "text", text: JSON.stringify(servers, null, 2) }] };
  });

  server.tool(
    "add_server",
    "Register a new MCP server",
    {
      command: z.string(),
      args: z.array(z.string()).optional(),
      name: z.string().optional(),
      description: z.string().optional(),
    },
    async ({ command, args, name, description }) => {
      const entry = addServer({ command, args: args || [], name, description });
      return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
    }
  );

  server.tool(
    "remove_server",
    "Remove a registered MCP server",
    { id: z.string() },
    async ({ id }) => {
      const existing = getServer(id);
      if (!existing) {
        return { content: [{ type: "text", text: `Server "${id}" not found.` }], isError: true };
      }
      removeServer(id);
      return { content: [{ type: "text", text: `Removed server: ${existing.name} [${id}]` }] };
    }
  );

  server.tool(
    "get_server_info",
    "Get server info",
    { id: z.string() },
    async ({ id }) => {
      const entry = getServer(id);
      if (!entry) {
        return { content: [{ type: "text", text: `Server "${id}" not found.` }], isError: true };
      }
      return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
    }
  );

  return server;
}

async function createClientServer() {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("MCP server tools", () => {
  beforeEach(() => {
    clearDb();
  });

  afterAll(() => {
    closeDb();
  });

  it("list_servers returns empty when no servers", async () => {
    const { client } = await createClientServer();
    const result = await client.callTool({ name: "list_servers", arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual([]);
    await client.close();
  });

  it("add_server creates a server and list_servers returns it", async () => {
    const { client } = await createClientServer();

    // Add
    const addResult = await client.callTool({
      name: "add_server",
      arguments: { command: "npx", name: "TestMCP", description: "Test" },
    });
    const added = JSON.parse((addResult.content as any)[0].text);
    expect(added.name).toBe("TestMCP");
    expect(added.id).toBe("testmcp");

    // List
    const listResult = await client.callTool({ name: "list_servers", arguments: {} });
    const servers = JSON.parse((listResult.content as any)[0].text);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("TestMCP");

    await client.close();
  });

  it("remove_server removes a server", async () => {
    const { client } = await createClientServer();

    addServer({ command: "npx", name: "removable" });

    const result = await client.callTool({
      name: "remove_server",
      arguments: { id: "removable" },
    });
    const text = (result.content as any)[0].text;
    expect(text).toContain("Removed server");

    expect(getServer("removable")).toBeNull();
    await client.close();
  });

  it("remove_server returns error for non-existent server", async () => {
    const { client } = await createClientServer();

    const result = await client.callTool({
      name: "remove_server",
      arguments: { id: "ghost" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any)[0].text;
    expect(text).toContain("not found");
    await client.close();
  });

  it("get_server_info returns server details", async () => {
    const { client } = await createClientServer();

    addServer({ command: "npx", name: "infotest", description: "Info test server" });

    const result = await client.callTool({
      name: "get_server_info",
      arguments: { id: "infotest" },
    });
    const info = JSON.parse((result.content as any)[0].text);
    expect(info.name).toBe("infotest");
    expect(info.description).toBe("Info test server");
    await client.close();
  });

  it("get_server_info returns error for non-existent server", async () => {
    const { client } = await createClientServer();

    const result = await client.callTool({
      name: "get_server_info",
      arguments: { id: "ghost" },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("lists available tools", async () => {
    const { client } = await createClientServer();
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("list_servers");
    expect(toolNames).toContain("add_server");
    expect(toolNames).toContain("remove_server");
    expect(toolNames).toContain("get_server_info");
    await client.close();
  });
});
