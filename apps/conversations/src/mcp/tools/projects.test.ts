import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectTools } from "./projects";
import { closeDb } from "../../lib/db";
import { createDisposableStore, enterHermeticTestEnv, installNetworkGuard } from "../../test/hermetic";

const TEST_STORE = createDisposableStore("projects-mcp");

describe("projects MCP tools", () => {
  let client: Client;
  let restoreEnv: () => void;
  let restoreNetwork: () => void;

  beforeAll(async () => {
    restoreEnv = enterHermeticTestEnv({
      CONVERSATIONS_DB_PATH: TEST_STORE.dbPath,
      CONVERSATIONS_AGENT_ID: "projects-test-agent",
    });
    restoreNetwork = installNetworkGuard();
    closeDb();

    const server = new McpServer({ name: "test-projects-mcp", version: "0.0.1" });
    registerProjectTools(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    closeDb();
    restoreNetwork();
    restoreEnv();
    TEST_STORE.cleanup();
  });

  function parseResult(result: { content: unknown[] }): unknown {
    const text = (result.content[0] as { type: string; text: string }).text;
    try { return JSON.parse(text); } catch { return text; }
  }

  describe("create_project", () => {
    test("creates a project", async () => {
      const result = parseResult(await client.callTool({
        name: "create_project",
        arguments: { name: "test-proj-1", from: "creator-agent", description: "Test project" },
      }) as any) as any;
      expect(result.name).toBe("test-proj-1");
      expect(result.created_by).toBe("creator-agent");
    });

    test("creates with all fields", async () => {
      const result = parseResult(await client.callTool({
        name: "create_project",
        arguments: {
          name: "full-proj",
          from: "creator",
          description: "Full project",
          path: "/some/path",
          repository: "https://github.com/test/repo",
          tags: JSON.stringify(["tag1", "tag2"]),
        },
      }) as any) as any;
      expect(result.name).toBe("full-proj");
      expect(result.path).toBe("/some/path");
    });

    test("returns error for invalid tags JSON", async () => {
      const result = await client.callTool({
        name: "create_project",
        arguments: { name: "bad-tags", tags: "not-valid-json" },
      });
      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain("invalid tags JSON");
    });

    test("returns error for invalid metadata JSON", async () => {
      const result = await client.callTool({
        name: "create_project",
        arguments: { name: "bad-meta", metadata: "not-valid" },
      });
      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain("invalid JSON");
    });

    test("returns error for invalid settings JSON", async () => {
      const result = await client.callTool({
        name: "create_project",
        arguments: { name: "bad-settings", settings: "invalid" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("returns error for duplicate project", async () => {
      await client.callTool({
        name: "create_project",
        arguments: { name: "dup-proj" },
      });
      const result = await client.callTool({
        name: "create_project",
        arguments: { name: "dup-proj" },
      });
      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain("already exists");
    });
  });

  describe("list_projects", () => {
    test("lists all projects", async () => {
      const result = parseResult(await client.callTool({
        name: "list_projects",
        arguments: {},
      }) as any) as any;
      expect(Array.isArray(result.projects)).toBe(true);
      expect(result.projects.length).toBeGreaterThan(0);
      expect(result.compact).toBe(true);
    });

    test("filters by status", async () => {
      const result = parseResult(await client.callTool({
        name: "list_projects",
        arguments: { status: "active" },
      }) as any) as any;
      expect(Array.isArray(result.projects)).toBe(true);
    });
  });

  describe("get_project", () => {
    test("gets project by ID", async () => {
      // Create a project first, get its ID
      const created = parseResult(await client.callTool({
        name: "create_project",
        arguments: { name: "get-proj" },
      }) as any) as any;

      const result = parseResult(await client.callTool({
        name: "get_project",
        arguments: { id: created.id },
      }) as any) as any;
      expect(result.name).toBe("get-proj");
    });

    test("gets project by name", async () => {
      const result = parseResult(await client.callTool({
        name: "get_project",
        arguments: { id: "get-proj" },
      }) as any) as any;
      expect(result.name).toBe("get-proj");
    });

    test("returns error for nonexistent project", async () => {
      const result = await client.callTool({
        name: "get_project",
        arguments: { id: "no-such-project" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("update_project", () => {
    test("updates project fields", async () => {
      const created = parseResult(await client.callTool({
        name: "create_project",
        arguments: { name: "update-proj", description: "Original" },
      }) as any) as any;

      const result = parseResult(await client.callTool({
        name: "update_project",
        arguments: { id: created.id, description: "Updated", status: "archived" },
      }) as any) as any;
      expect(result.description).toBe("Updated");
      expect(result.status).toBe("archived");
    });

    test("updates with valid tags JSON", async () => {
      const created = parseResult(await client.callTool({
        name: "create_project",
        arguments: { name: "update-tags-proj" },
      }) as any) as any;

      const result = parseResult(await client.callTool({
        name: "update_project",
        arguments: { id: created.id, tags: JSON.stringify(["a", "b"]) },
      }) as any) as any;
      expect(result.tags).toEqual(["a", "b"]);
    });

    test("returns error for invalid tags JSON", async () => {
      const result = await client.callTool({
        name: "update_project",
        arguments: { id: "some-id", tags: "bad-json" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("returns error for invalid metadata JSON", async () => {
      const result = await client.callTool({
        name: "update_project",
        arguments: { id: "some-id", metadata: "bad" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("returns error for invalid settings JSON", async () => {
      const result = await client.callTool({
        name: "update_project",
        arguments: { id: "some-id", settings: "bad" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("returns error for nonexistent project", async () => {
      const result = await client.callTool({
        name: "update_project",
        arguments: { id: "nonexistent", description: "test" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("delete_project", () => {
    test("deletes a project", async () => {
      const created = parseResult(await client.callTool({
        name: "create_project",
        arguments: { name: "delete-proj" },
      }) as any) as any;

      const result = parseResult(await client.callTool({
        name: "delete_project",
        arguments: { id: created.id },
      }) as any) as any;
      expect(result.deleted).toBe(true);
    });

    test("returns error for nonexistent project", async () => {
      const result = await client.callTool({
        name: "delete_project",
        arguments: { id: "no-such-id" },
      });
      expect((result as any).isError).toBe(true);
    });
  });
});
