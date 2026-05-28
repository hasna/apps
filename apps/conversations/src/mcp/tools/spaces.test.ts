import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSpaceTools } from "./spaces";
import { closeDb } from "../../lib/db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-spaces-mcp-${Date.now()}.db`);

describe("spaces MCP tools", () => {
  let client: Client;

  beforeAll(async () => {
    process.env.CONVERSATIONS_DB_PATH = TEST_DB;
    process.env.CONVERSATIONS_AGENT_ID = "spaces-test-agent";
    closeDb();

    const server = new McpServer({ name: "test-spaces-mcp", version: "0.0.1" });
    registerSpaceTools(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    delete process.env.CONVERSATIONS_DB_PATH;
    delete process.env.CONVERSATIONS_AGENT_ID;
    closeDb();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + "-wal"); } catch {}
    try { unlinkSync(TEST_DB + "-shm"); } catch {}
    await client.close();
  });

  function parseResult(result: { content: unknown[] }): unknown {
    const text = (result.content[0] as { type: string; text: string }).text;
    try { return JSON.parse(text); } catch { return text; }
  }

  describe("create_space", () => {
    test("creates a space", async () => {
      const result = parseResult(await client.callTool({
        name: "create_space",
        arguments: { name: "test-space-1", from: "creator-agent" },
      }) as any) as any;
      expect(result.name).toBe("test-space-1");
      expect(result.created_by).toBe("creator-agent");
    });

    test("returns error for duplicate space", async () => {
      await client.callTool({
        name: "create_space",
        arguments: { name: "dup-space", from: "creator" },
      });
      const result = await client.callTool({
        name: "create_space",
        arguments: { name: "dup-space", from: "creator" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("creates with description and project_id", async () => {
      // First create a project so the project_id FK is valid (need the UUID id)
      const uniqueProj = `proj-${Date.now()}`;
      const proj = (await import("../../lib/projects.js")).createProject({ name: uniqueProj, created_by: "creator" });
      const spaceName = `desc-space-${Date.now()}`;
      const result = parseResult(await client.callTool({
        name: "create_space",
        arguments: { name: spaceName, description: "A space with description", project_id: proj.id },
      }) as any) as any;
      expect(result.description).toBe("A space with description");
      expect(result.project_id).toBe(proj.id);
    });
  });

  describe("list_spaces", () => {
    test("lists all spaces", async () => {
      const result = parseResult(await client.callTool({
        name: "list_spaces",
        arguments: {},
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    test("filters by project_id", async () => {
      const result = parseResult(await client.callTool({
        name: "list_spaces",
        arguments: { project_id: "nonexistent-proj" },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });

    test("filters by parent_id=null", async () => {
      const result = parseResult(await client.callTool({
        name: "list_spaces",
        arguments: { parent_id: "null" },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("send_to_space", () => {
    test("sends message to space", async () => {
      const result = parseResult(await client.callTool({
        name: "send_to_space",
        arguments: { space: "test-space-1", content: "hello space", from: "sender" },
      }) as any) as any;
      expect(result.content).toBe("hello space");
      expect(result.space).toBe("test-space-1");
    });

    test("returns error for nonexistent space", async () => {
      const result = await client.callTool({
        name: "send_to_space",
        arguments: { space: "no-such-space", content: "hello" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("sends with priority and blocking", async () => {
      const result = parseResult(await client.callTool({
        name: "send_to_space",
        arguments: { space: "test-space-1", content: "urgent", from: "sender", priority: "urgent", blocking: true },
      }) as any) as any;
      expect(result.priority).toBe("urgent");
      expect(result.blocking).toBe(true);
    });
  });

  describe("read_space", () => {
    test("reads space messages", async () => {
      const result = parseResult(await client.callTool({
        name: "read_space",
        arguments: { space: "test-space-1" },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });

    test("reads with limit", async () => {
      const result = parseResult(await client.callTool({
        name: "read_space",
        arguments: { space: "test-space-1", limit: 1 },
      }) as any) as any;
      expect(result.length).toBeLessThanOrEqual(1);
    });

    test("reads with mark_read=false", async () => {
      const result = parseResult(await client.callTool({
        name: "read_space",
        arguments: { space: "test-space-1", mark_read: false },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });

    test("records per-agent read receipts", async () => {
      const result = parseResult(await client.callTool({
        name: "read_space",
        arguments: { space: "test-space-1", from: "reader-agent", mark_read: true },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });

    test("supports threads_only and include_reply_counts", async () => {
      const result = parseResult(await client.callTool({
        name: "read_space",
        arguments: { space: "test-space-1", threads_only: true, include_reply_counts: true },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });

    test("supports latest param", async () => {
      const result = parseResult(await client.callTool({
        name: "read_space",
        arguments: { space: "test-space-1", latest: 3 },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("join_space", () => {
    test("joins a space", async () => {
      const result = parseResult(await client.callTool({
        name: "join_space",
        arguments: { space: "test-space-1", from: "joiner-agent" },
      }) as any) as any;
      expect(result.joined).toBe(true);
      expect(result.space).toBe("test-space-1");
    });

    test("returns error for nonexistent space", async () => {
      const result = await client.callTool({
        name: "join_space",
        arguments: { space: "no-space", from: "joiner" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("leave_space", () => {
    test("leaves a space", async () => {
      const result = parseResult(await client.callTool({
        name: "leave_space",
        arguments: { space: "test-space-1", from: "leaver-agent" },
      }) as any) as any;
      expect(result.space).toBe("test-space-1");
      expect(result.left).toBeDefined();
    });
  });

  describe("update_space", () => {
    test("updates description", async () => {
      const result = parseResult(await client.callTool({
        name: "update_space",
        arguments: { name: "test-space-1", description: "Updated description" },
      }) as any) as any;
      expect(result.description).toBe("Updated description");
    });

    test("returns error for nonexistent space", async () => {
      const result = await client.callTool({
        name: "update_space",
        arguments: { name: "no-such-space", description: "test" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("archive_space / unarchive_space", () => {
    test("archives a space", async () => {
      const result = parseResult(await client.callTool({
        name: "archive_space",
        arguments: { name: "test-space-1" },
      }) as any) as any;
      expect(result.archived_at).toBeDefined();
    });

    test("unarchives a space", async () => {
      const result = parseResult(await client.callTool({
        name: "unarchive_space",
        arguments: { name: "test-space-1" },
      }) as any) as any;
      expect(result.archived_at).toBeNull();
    });

    test("archive returns error for nonexistent space", async () => {
      const result = await client.callTool({
        name: "archive_space",
        arguments: { name: "no-space" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("subscribe_space_notifications", () => {
    test("subscribes an agent", async () => {
      const result = parseResult(await client.callTool({
        name: "subscribe_space_notifications",
        arguments: { space: "test-space-1", from: "sub-agent", preview_chars: 50 },
      }) as any) as any;
      expect(result.space).toBe("test-space-1");
      expect(result.agent).toBe("sub-agent");
    });

    test("returns error for nonexistent space", async () => {
      const result = await client.callTool({
        name: "subscribe_space_notifications",
        arguments: { space: "no-space", from: "sub-agent" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("unsubscribe_space_notifications", () => {
    test("unsubscribes an agent", async () => {
      const result = parseResult(await client.callTool({
        name: "unsubscribe_space_notifications",
        arguments: { space: "test-space-1", from: "sub-agent" },
      }) as any) as any;
      expect(result.unsubscribed).toBe(true);
    });
  });

  describe("list_space_subscriptions", () => {
    test("lists subscriptions for agent", async () => {
      const result = parseResult(await client.callTool({
        name: "list_space_subscriptions",
        arguments: { from: "sub-agent" },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });

    test("filters by space", async () => {
      const result = parseResult(await client.callTool({
        name: "list_space_subscriptions",
        arguments: { from: "sub-agent", space: "test-space-1" },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("read_space_notifications", () => {
    test("reads notifications for agent", async () => {
      const result = parseResult(await client.callTool({
        name: "read_space_notifications",
        arguments: { from: "sub-agent" },
      }) as any) as any;
      expect(Array.isArray(result.notifications)).toBe(true);
    });

    test("supports unread_only and limit", async () => {
      const result = parseResult(await client.callTool({
        name: "read_space_notifications",
        arguments: { from: "sub-agent", unread_only: true, limit: 5 },
      }) as any) as any;
      expect(Array.isArray(result.notifications)).toBe(true);
    });
  });

  describe("mark_space_notifications_read", () => {
    test("returns error when no ids or all", async () => {
      const result = await client.callTool({
        name: "mark_space_notifications_read",
        arguments: { from: "sub-agent" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("marks all as read", async () => {
      const result = parseResult(await client.callTool({
        name: "mark_space_notifications_read",
        arguments: { from: "sub-agent", all: true },
      }) as any) as any;
      expect(result.marked_read).toBeDefined();
    });
  });

  describe("set_space_topic / get_space_topic", () => {
    test("sets a topic", async () => {
      const result = await client.callTool({
        name: "set_space_topic",
        arguments: { space: "test-space-1", topic: "Building v2" },
      });
      expect((result as any).isError).toBeUndefined();
      expect((result as any).content[0].text).toContain("Topic set");
    });

    test("clears a topic with null", async () => {
      const result = await client.callTool({
        name: "set_space_topic",
        arguments: { space: "test-space-1", topic: null },
      });
      expect((result as any).isError).toBeUndefined();
      expect((result as any).content[0].text).toContain("Topic cleared");
    });

    test("returns error for nonexistent space", async () => {
      const result = await client.callTool({
        name: "set_space_topic",
        arguments: { space: "no-space", topic: "test" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("gets a topic", async () => {
      await client.callTool({
        name: "set_space_topic",
        arguments: { space: "test-space-1", topic: "Active topic" },
      });
      const result = parseResult(await client.callTool({
        name: "get_space_topic",
        arguments: { space: "test-space-1" },
      }) as any) as any;
      expect(result.topic).toBe("Active topic");
    });

    test("returns error for nonexistent space topic", async () => {
      const result = await client.callTool({
        name: "get_space_topic",
        arguments: { space: "no-space" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("summarize_space", () => {
    test("returns summary with messages", async () => {
      // Send a message first
      await client.callTool({
        name: "send_to_space",
        arguments: { space: "test-space-1", content: "summary test", from: "summary-agent" },
      });
      const result = await client.callTool({
        name: "summarize_space",
        arguments: { space: "test-space-1" },
      });
      expect((result as any).isError).toBeUndefined();
      expect((result as any).content[0].text).toContain("Space: #test-space-1");
    });

    test("returns no messages when empty with old since", async () => {
      const result = await client.callTool({
        name: "summarize_space",
        arguments: { space: "test-space-1", since: "2030-01-01T00:00:00.000Z" },
      });
      expect((result as any).content[0].text).toContain("No messages");
    });
  });
});
