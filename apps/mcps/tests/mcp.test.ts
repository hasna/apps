import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import "./setup";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "fs";
import { addServer, getServer } from "../src/lib/registry";
import { getDb, closeDb } from "../src/lib/db";
import { DEFAULT_PROVIDER_PROFILE_SEEDS } from "../src/lib/provider-profile-seeds";
import { createMcpServer, listTools, tools } from "../src/mcp/index";

function clearDb() {
  const db = getDb();
  db.exec("DELETE FROM tool_cache");
  db.exec("DELETE FROM servers");
}

async function createClientServer() {
  const server = createMcpServer({ name: "mcps-test", version: "0.0.1", cloudTools: false });
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

    const rejected = await client.callTool({
      name: "add_server",
      arguments: { command: "npx", name: "RejectedMCP" },
    });
    expect(rejected.isError).toBe(true);
    expect((rejected.content as any)[0].text).toContain("local stdio command approval is required");

    // Add
    const addResult = await client.callTool({
      name: "add_server",
      arguments: { command: "npx", name: "TestMCP", description: "Test", allow_local_stdio: true },
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

  it("add_server handles credential refs without exposing raw secrets", async () => {
    const { client } = await createClientServer();

    const rejected = await client.callTool({
      name: "add_server",
      arguments: {
        command: "npx",
        name: "RejectedCredentialMCP",
        env: { API_KEY: "sk_live_should_not_be_stored" },
        allow_local_stdio: true,
      },
    });
    expect(rejected.isError).toBe(true);
    expect((rejected.content as any)[0].text).toContain("credential reference");

    const addResult = await client.callTool({
      name: "add_server",
      arguments: {
        command: "npx",
        name: "CredentialMCP",
        env: { DEBUG: "1" },
        credential_refs: {
          API_KEY: { source: "env", name: "UPSTREAM_API_KEY" },
        },
        allow_local_stdio: true,
      },
    });
    const added = JSON.parse((addResult.content as any)[0].text);
    expect(added.env).toEqual({ DEBUG: "1" });
    expect(added.credentialRefs.API_KEY).toEqual({
      source: "env",
      name: "UPSTREAM_API_KEY",
      required: true,
    });

    const listResult = await client.callTool({ name: "list_servers", arguments: {} });
    const listed = JSON.parse((listResult.content as any)[0].text);
    expect(listed[0].env).toEqual({});
    expect(JSON.stringify(listed)).not.toContain("sk_live_should_not_be_stored");
    expect(JSON.stringify(getServer("rejectedcredentialmcp"))).not.toContain("sk_live_should_not_be_stored");

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

  it("lists, searches, inspects, and installs provider profiles", async () => {
    const { client } = await createClientServer();

    const listResult = await client.callTool({ name: "list_provider_profiles", arguments: {} });
    const profiles = JSON.parse((listResult.content as any)[0].text);
    const expectedIds = [...DEFAULT_PROVIDER_PROFILE_SEEDS]
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .map((profile) => profile.id);
    expect(profiles.map((profile: { id: string }) => profile.id)).toEqual(expectedIds);
    expect(profiles.map((profile: { id: string }) => profile.id)).toContain("stripe");
    expect(profiles.map((profile: { id: string }) => profile.id)).toContain("cloudflare");

    const searchResult = await client.callTool({ name: "search_provider_profiles", arguments: { query: "notion" } });
    const searchProfiles = JSON.parse((searchResult.content as any)[0].text);
    expect(searchProfiles).toHaveLength(1);
    expect(searchProfiles[0].endpoint).toBe("https://mcp.notion.com/mcp");

    const infoResult = await client.callTool({ name: "get_provider_profile", arguments: { id: "linear" } });
    const linear = JSON.parse((infoResult.content as any)[0].text);
    expect(linear.authMetadata.bearerToken).toBe("optional");

    const installResult = await client.callTool({ name: "install_provider_profile", arguments: { id: "linear" } });
    const server = JSON.parse((installResult.content as any)[0].text);
    expect(server.id).toBe("linear");
    expect(server.transport).toBe("streamable-http");
    expect(server.url).toBe("https://mcp.linear.app/mcp");
    expect(server.env).toEqual({});

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
    expect(toolNames).toContain("list_provider_profiles");
    expect(toolNames).toContain("install_provider_profile");
    await client.close();
  });

  it("exports package-mode tool definitions without starting stdio", async () => {
    const listed = await listTools();
    const toolNames = listed.map((tool) => tool.name);
    expect(toolNames).toContain("list_servers");
    expect(toolNames).toContain("call_upstream_tool");
    expect(tools.map((tool) => tool.name)).toContain("list_servers");

    const addServerTool = listed.find((tool) => tool.name === "add_server");
    expect(addServerTool?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        command: { type: "string" },
        allow_local_stdio: { type: "boolean" },
      },
      required: ["command"],
      additionalProperties: false,
    });
    expect(JSON.stringify(addServerTool?.inputSchema)).not.toContain("_def");
    expect(addServerTool?.paramsSchema?.command).toBeDefined();
  });

  it("declares the importable MCP package export", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.exports["./mcp"]).toEqual({
      import: "./dist/mcp/index.js",
      types: "./dist/mcp/index.d.ts",
    });
  });
});
