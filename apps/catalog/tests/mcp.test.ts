import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { App } from "../src/contracts.js";
import { createCatalogMcpServer } from "../src/mcp/index.js";
import { CatalogStore } from "../src/store.js";

// The MCP tool list is a wire contract: names, descriptions, the advertised
// JSON Schema, and argument validation are all things a client depends on. They
// were previously unasserted, so a rename or a dropped inputSchema field could
// ship green. These tests drive a real SDK client over an in-memory transport.

function makeApp(appId: string, overrides: Partial<App> = {}): App {
  return {
    schema: "hasna.app.v1",
    id: `app_${appId.replaceAll("-", "_")}`,
    createdAt: "2026-07-06T08:00:00.000Z",
    appId,
    npmName: `@example/${appId.replace(/^open-/, "")}`,
    repoFolder: appId,
    githubUrl: `https://github.com/example/${appId}`,
    projectSlug: appId,
    surfaces: { bins: [] },
    lifecycle: "active",
    releaseChannel: "stable",
    tags: ["oss"],
    ...overrides,
  } as App;
}

interface ToolDescription {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, { type?: string; enum?: string[]; description?: string }>;
    required?: string[];
  };
}

interface ToolCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

let client: Client;
let tools: ToolDescription[];

beforeAll(async () => {
  const store = new CatalogStore({ dbPath: ":memory:" });
  store.upsertApps([
    makeApp("open-alpha", { summary: "Task tracking" }),
    makeApp("open-beta", { summary: "Uptime monitoring", lifecycle: "stub", releaseChannel: "beta" }),
  ]);
  const server = createCatalogMcpServer({ store });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "catalog-test-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  tools = (await client.listTools()).tools as unknown as ToolDescription[];
});

afterAll(async () => {
  await client?.close();
});

function tool(name: string): ToolDescription {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`tool not advertised: ${name} (have: ${tools.map((t) => t.name).join(", ")})`);
  return found;
}

function text(result: unknown): string {
  return (result as ToolCallResult).content.map((part) => part.text ?? "").join("");
}

describe("catalog MCP tools/list", () => {
  it("advertises exactly catalog_list and catalog_get", () => {
    expect(tools.map((candidate) => candidate.name).sort()).toEqual(["catalog_get", "catalog_list"]);
    expect(tool("catalog_list").description).toContain("List apps in the Hasna app catalog");
    expect(tool("catalog_get").description).toContain("Get one app from the Hasna app catalog");
  });

  it("advertises every catalog_list filter with its enum values", () => {
    const schema = tool("catalog_list").inputSchema;
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["channel", "lifecycle", "limit", "query"]);
    expect(schema.properties?.["lifecycle"]?.enum).toEqual(["active", "stub", "deprecated", "archived"]);
    expect(schema.properties?.["channel"]?.enum).toEqual(["stable", "beta", "canary", "internal"]);
    expect(schema.properties?.["query"]?.type).toBe("string");
    expect(schema.properties?.["limit"]?.type).toBe("integer");
    expect(schema.required ?? []).toEqual([]);
  });

  it("advertises app_id as catalog_get's only required argument", () => {
    const schema = tool("catalog_get").inputSchema;
    expect(Object.keys(schema.properties ?? {})).toEqual(["app_id"]);
    expect(schema.required).toEqual(["app_id"]);
    expect(schema.properties?.["app_id"]?.type).toBe("string");
  });
});

describe("catalog MCP tools/call", () => {
  it("lists every app when given no arguments", async () => {
    const result = await client.callTool({ name: "catalog_list", arguments: {} });
    expect((result as ToolCallResult).isError).toBeFalsy();
    const payload = JSON.parse(text(result)) as { apps: Array<{ appId: string }>; count: number };
    expect(payload.count).toBe(2);
    expect(payload.apps.map((app) => app.appId).sort()).toEqual(["open-alpha", "open-beta"]);
  });

  it("applies the lifecycle filter and the free-text query together", async () => {
    const filtered = await client.callTool({ name: "catalog_list", arguments: { lifecycle: "stub" } });
    expect((JSON.parse(text(filtered)) as { apps: Array<{ appId: string }> }).apps.map((app) => app.appId)).toEqual([
      "open-beta",
    ]);

    const searched = await client.callTool({
      name: "catalog_list",
      arguments: { query: "monitoring", lifecycle: "active" },
    });
    expect((JSON.parse(text(searched)) as { count: number }).count).toBe(0);
  });

  it("returns one app by appId", async () => {
    const result = await client.callTool({ name: "catalog_get", arguments: { app_id: "open-alpha" } });
    expect((result as ToolCallResult).isError).toBeFalsy();
    expect((JSON.parse(text(result)) as { app: { npmName: string } }).app.npmName).toBe("@example/alpha");
  });

  it("reports a missing app as a tool error rather than a crash", async () => {
    const result = await client.callTool({ name: "catalog_get", arguments: { app_id: "missing-app" } });
    expect((result as ToolCallResult).isError).toBe(true);
    expect(text(result)).toContain("app not found: missing-app");
  });

  it("rejects arguments the advertised schema forbids", async () => {
    const badEnum = await client.callTool({ name: "catalog_list", arguments: { lifecycle: "nope" } });
    expect((badEnum as ToolCallResult).isError).toBe(true);
    expect(text(badEnum)).toContain("-32602");
    expect(text(badEnum)).toContain("invalid_enum_value");

    const badLimit = await client.callTool({ name: "catalog_list", arguments: { limit: -5 } });
    expect((badLimit as ToolCallResult).isError).toBe(true);
    expect(text(badLimit)).toContain("-32602");

    const missingRequired = await client.callTool({ name: "catalog_get", arguments: {} });
    expect((missingRequired as ToolCallResult).isError).toBe(true);
    expect(text(missingRequired)).toContain("-32602");
  });
});
