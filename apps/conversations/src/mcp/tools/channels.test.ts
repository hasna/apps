import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerChannelTools } from "./channels";
import { closeDb } from "../../lib/db";
import { getMessageById, getReadReceipts } from "../../lib/messages";
import { createDisposableStore, enterHermeticTestEnv, installNetworkGuard } from "../../test/hermetic";

const TEST_STORE = createDisposableStore("channels-mcp");

describe("channels MCP tools", () => {
  let client: Client;
  let restoreEnv: () => void;
  let restoreNetwork: () => void;

  beforeAll(async () => {
    restoreEnv = enterHermeticTestEnv({
      CONVERSATIONS_DB_PATH: TEST_STORE.dbPath,
      CONVERSATIONS_AGENT_ID: "channels-test-agent",
    });
    restoreNetwork = installNetworkGuard();
    closeDb();

    const server = new McpServer({ name: "test-channels-mcp", version: "0.0.1" });
    registerChannelTools(server);

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

  describe("create_channel", () => {
    test("creates a channel", async () => {
      const result = parseResult(await client.callTool({
        name: "create_channel",
        arguments: { name: "test-channel-1", from: "creator-agent" },
      }) as any) as any;
      expect(result.name).toBe("test-channel-1");
      expect(result.created_by).toBe("creator-agent");
    });

    test("returns error for duplicate channel", async () => {
      await client.callTool({
        name: "create_channel",
        arguments: { name: "dup-channel", from: "creator" },
      });
      const result = await client.callTool({
        name: "create_channel",
        arguments: { name: "dup-channel", from: "creator" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("creates with description and project_id", async () => {
      // First create a project so the project_id FK is valid (need the UUID id)
      const uniqueProj = `proj-${Date.now()}`;
      const proj = (await import("../../lib/projects.js")).createProject({ name: uniqueProj, created_by: "creator" });
      const channelName = `desc-channel-${Date.now()}`;
      const result = parseResult(await client.callTool({
        name: "create_channel",
        arguments: { name: channelName, description: "A channel with description", project_id: proj.id },
      }) as any) as any;
      expect(result.description).toBe("A channel with description");
      expect(result.project_id).toBe(proj.id);
    });
  });

  describe("list_channels", () => {
    test("lists all channels", async () => {
      const result = parseResult(await client.callTool({
        name: "list_channels",
        arguments: {},
      }) as any) as any;
      expect(Array.isArray(result.channels)).toBe(true);
      expect(result.channels.length).toBeGreaterThan(0);
      expect(result.compact).toBe(true);
    });

    test("filters by project_id", async () => {
      const result = parseResult(await client.callTool({
        name: "list_channels",
        arguments: { project_id: "nonexistent-proj" },
      }) as any) as any;
      expect(Array.isArray(result.channels)).toBe(true);
    });

    test("accepts archived filter", async () => {
      const result = parseResult(await client.callTool({
        name: "list_channels",
        arguments: { include_archived: true },
      }) as any) as any;
      expect(Array.isArray(result.channels)).toBe(true);
    });
  });

  describe("send_to_channel", () => {
    test("sends message to channel", async () => {
      const result = parseResult(await client.callTool({
        name: "send_to_channel",
        arguments: { channel: "test-channel-1", content: "hello channel", from: "sender" },
      }) as any) as any;
      expect(result.content).toBe("hello channel");
      expect(result.channel).toBe("test-channel-1");
    });

    test("returns error for nonexistent channel", async () => {
      const result = await client.callTool({
        name: "send_to_channel",
        arguments: { channel: "no-such-channel", content: "hello" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("sends with priority and blocking", async () => {
      const result = parseResult(await client.callTool({
        name: "send_to_channel",
        arguments: { channel: "test-channel-1", content: "urgent", from: "sender", priority: "urgent", blocking: true },
      }) as any) as any;
      expect(result.priority).toBe("urgent");
      expect(result.blocking).toBe(true);
    });
  });

  describe("read_channel", () => {
    test("reads channel messages", async () => {
      const result = parseResult(await client.callTool({
        name: "read_channel",
        arguments: { channel: "test-channel-1" },
      }) as any) as any;
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.compact).toBe(true);
    });

    test("reads with limit", async () => {
      const result = parseResult(await client.callTool({
        name: "read_channel",
        arguments: { channel: "test-channel-1", limit: 1 },
      }) as any) as any;
      expect(result.count).toBeLessThanOrEqual(1);
    });

    test("defaults to a pure peek and records receipts only with mark_read:true", async () => {
      const sent = parseResult(await client.callTool({
        name: "send_to_channel",
        arguments: { channel: "test-channel-1", content: "explicit acknowledgement fixture", from: "ack-sender" },
      }) as any) as any;
      const peek = parseResult(await client.callTool({
        name: "read_channel",
        arguments: { channel: "test-channel-1", from: "reader-agent" },
      }) as any) as any;
      expect(Array.isArray(peek.messages)).toBe(true);
      expect(getMessageById(sent.id)?.read_at).toBeNull();
      expect(getReadReceipts(sent.id)).toEqual([]);

      await client.callTool({
        name: "read_channel",
        arguments: { channel: "test-channel-1", from: "reader-agent", mark_read: true },
      });
      expect(getMessageById(sent.id)?.read_at).not.toBeNull();
      expect(getReadReceipts(sent.id).map((receipt) => receipt.agent)).toContain("reader-agent");
    });

    test("supports threads_only and include_reply_counts", async () => {
      const result = parseResult(await client.callTool({
        name: "read_channel",
        arguments: { channel: "test-channel-1", threads_only: true, include_reply_counts: true },
      }) as any) as any;
      expect(Array.isArray(result.messages)).toBe(true);
    });

    test("supports latest param", async () => {
      const result = parseResult(await client.callTool({
        name: "read_channel",
        arguments: { channel: "test-channel-1", latest: 3 },
      }) as any) as any;
      expect(Array.isArray(result.messages)).toBe(true);
    });
  });

  describe("join_channel", () => {
    test("joins a channel", async () => {
      const result = parseResult(await client.callTool({
        name: "join_channel",
        arguments: { channel: "test-channel-1", from: "joiner-agent" },
      }) as any) as any;
      expect(result.joined).toBe(true);
      expect(result.channel).toBe("test-channel-1");
    });

    test("returns error for nonexistent channel", async () => {
      const result = await client.callTool({
        name: "join_channel",
        arguments: { channel: "no-channel", from: "joiner" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("leave_channel", () => {
    test("leaves a channel", async () => {
      const result = parseResult(await client.callTool({
        name: "leave_channel",
        arguments: { channel: "test-channel-1", from: "leaver-agent" },
      }) as any) as any;
      expect(result.channel).toBe("test-channel-1");
      expect(result.left).toBeDefined();
    });
  });

  describe("update_channel", () => {
    test("updates description", async () => {
      const result = parseResult(await client.callTool({
        name: "update_channel",
        arguments: { name: "test-channel-1", description: "Updated description" },
      }) as any) as any;
      expect(result.description).toBe("Updated description");
    });

    test("returns error for nonexistent channel", async () => {
      const result = await client.callTool({
        name: "update_channel",
        arguments: { name: "no-such-channel", description: "test" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("renames a channel via new_name", async () => {
      await client.callTool({
        name: "create_channel",
        arguments: { name: "update-rename-src", from: "creator" },
      });
      const result = parseResult(await client.callTool({
        name: "update_channel",
        arguments: { name: "update-rename-src", new_name: "update-rename-dst" },
      }) as any) as any;
      expect(result.name).toBe("update-rename-dst");
    });
  });

  describe("rename_channel", () => {
    test("renames a channel preserving identity", async () => {
      await client.callTool({
        name: "create_channel",
        arguments: { name: "rename-src", from: "creator", description: "Keep me" },
      });
      const result = parseResult(await client.callTool({
        name: "rename_channel",
        arguments: { name: "rename-src", new_name: "rename-dst" },
      }) as any) as any;
      expect(result.name).toBe("rename-dst");
      expect(result.description).toBe("Keep me");
    });

    test("returns error for nonexistent channel", async () => {
      const result = await client.callTool({
        name: "rename_channel",
        arguments: { name: "no-such-rename", new_name: "whatever" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("returns error when target already exists", async () => {
      await client.callTool({ name: "create_channel", arguments: { name: "rename-conflict-a", from: "creator" } });
      await client.callTool({ name: "create_channel", arguments: { name: "rename-conflict-b", from: "creator" } });
      const result = await client.callTool({
        name: "rename_channel",
        arguments: { name: "rename-conflict-a", new_name: "rename-conflict-b" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("archive_channel / unarchive_channel", () => {
    test("archives a channel", async () => {
      const result = parseResult(await client.callTool({
        name: "archive_channel",
        arguments: { name: "test-channel-1" },
      }) as any) as any;
      expect(result.archived_at).toBeDefined();
    });

    test("unarchives a channel", async () => {
      const result = parseResult(await client.callTool({
        name: "unarchive_channel",
        arguments: { name: "test-channel-1" },
      }) as any) as any;
      expect(result.archived_at).toBeNull();
    });

    test("archive returns error for nonexistent channel", async () => {
      const result = await client.callTool({
        name: "archive_channel",
        arguments: { name: "no-channel" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("subscribe_channel_notifications", () => {
    test("subscribes an agent", async () => {
      const result = parseResult(await client.callTool({
        name: "subscribe_channel_notifications",
        arguments: { channel: "test-channel-1", from: "sub-agent", preview_chars: 50 },
      }) as any) as any;
      expect(result.channel).toBe("test-channel-1");
      expect(result.agent).toBe("sub-agent");
    });

    test("returns error for nonexistent channel", async () => {
      const result = await client.callTool({
        name: "subscribe_channel_notifications",
        arguments: { channel: "no-channel", from: "sub-agent" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("unsubscribe_channel_notifications", () => {
    test("unsubscribes an agent", async () => {
      const result = parseResult(await client.callTool({
        name: "unsubscribe_channel_notifications",
        arguments: { channel: "test-channel-1", from: "sub-agent" },
      }) as any) as any;
      expect(result.unsubscribed).toBe(true);
    });
  });

  describe("list_channel_subscriptions", () => {
    test("lists subscriptions for agent", async () => {
      const result = parseResult(await client.callTool({
        name: "list_channel_subscriptions",
        arguments: { from: "sub-agent" },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });

    test("filters by channel", async () => {
      const result = parseResult(await client.callTool({
        name: "list_channel_subscriptions",
        arguments: { from: "sub-agent", channel: "test-channel-1" },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("read_channel_notifications", () => {
    test("reads notifications for agent", async () => {
      const result = parseResult(await client.callTool({
        name: "read_channel_notifications",
        arguments: { from: "sub-agent" },
      }) as any) as any;
      expect(Array.isArray(result.notifications)).toBe(true);
    });

    test("supports unread_only and limit", async () => {
      const result = parseResult(await client.callTool({
        name: "read_channel_notifications",
        arguments: { from: "sub-agent", unread_only: true, limit: 5 },
      }) as any) as any;
      expect(Array.isArray(result.notifications)).toBe(true);
    });
  });

  describe("mark_channel_notifications_read", () => {
    test("returns error when no ids or all", async () => {
      const result = await client.callTool({
        name: "mark_channel_notifications_read",
        arguments: { from: "sub-agent" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("marks all as read", async () => {
      const result = parseResult(await client.callTool({
        name: "mark_channel_notifications_read",
        arguments: { from: "sub-agent", all: true },
      }) as any) as any;
      expect(result.marked_read).toBeDefined();
    });
  });

  describe("set_channel_topic / get_channel_topic", () => {
    test("sets a topic", async () => {
      const result = await client.callTool({
        name: "set_channel_topic",
        arguments: { channel: "test-channel-1", topic: "Building v2" },
      });
      expect((result as any).isError).toBeUndefined();
      expect((result as any).content[0].text).toContain("Topic set");
    });

    test("clears a topic with null", async () => {
      const result = await client.callTool({
        name: "set_channel_topic",
        arguments: { channel: "test-channel-1", topic: null },
      });
      expect((result as any).isError).toBeUndefined();
      expect((result as any).content[0].text).toContain("Topic cleared");
    });

    test("returns error for nonexistent channel", async () => {
      const result = await client.callTool({
        name: "set_channel_topic",
        arguments: { channel: "no-channel", topic: "test" },
      });
      expect((result as any).isError).toBe(true);
    });

    test("gets a topic", async () => {
      await client.callTool({
        name: "set_channel_topic",
        arguments: { channel: "test-channel-1", topic: "Active topic" },
      });
      const result = parseResult(await client.callTool({
        name: "get_channel_topic",
        arguments: { channel: "test-channel-1" },
      }) as any) as any;
      expect(result.topic).toBe("Active topic");
    });

    test("returns error for nonexistent channel topic", async () => {
      const result = await client.callTool({
        name: "get_channel_topic",
        arguments: { channel: "no-channel" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("summarize_channel", () => {
    test("returns summary with messages", async () => {
      // Send a message first
      await client.callTool({
        name: "send_to_channel",
        arguments: { channel: "test-channel-1", content: "summary test", from: "summary-agent" },
      });
      const result = await client.callTool({
        name: "summarize_channel",
        arguments: { channel: "test-channel-1" },
      });
      expect((result as any).isError).toBeUndefined();
      expect((result as any).content[0].text).toContain("Channel: #test-channel-1");
    });

    test("returns no messages when empty with old since", async () => {
      const result = await client.callTool({
        name: "summarize_channel",
        arguments: { channel: "test-channel-1", since: "2030-01-01T00:00:00.000Z" },
      });
      expect((result as any).content[0].text).toContain("No messages");
    });
  });
});
