import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMessagingTools } from "./messaging";
import { createChannel } from "../../lib/channels";
import { getMessageById, getReadReceipts, sendMessage } from "../../lib/messages";
import { closeDb } from "../../lib/db";
import { createDisposableStore, enterHermeticTestEnv, installNetworkGuard } from "../../test/hermetic";

const TEST_STORE = createDisposableStore("messaging-mcp");

async function resolveProjectId(explicit: string | undefined, _agent: string): Promise<string | undefined> {
  return explicit;
}

describe("messaging MCP tools", () => {
  let client: Client;
  let restoreEnv: () => void;
  let restoreNetwork: () => void;

  beforeAll(async () => {
    restoreEnv = enterHermeticTestEnv({
      CONVERSATIONS_DB_PATH: TEST_STORE.dbPath,
      CONVERSATIONS_AGENT_ID: "messaging-test-agent",
    });
    restoreNetwork = installNetworkGuard();
    closeDb();

    const server = new McpServer({ name: "test-messaging-mcp", version: "0.0.1" });
    registerMessagingTools(server, resolveProjectId);

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

  describe("send_message", () => {
    test("sends DM", async () => {
      const result = parseResult(await client.callTool({
        name: "send_message",
        arguments: { to: "target-agent", content: "hello dm" },
      }) as any) as any;
      expect(result.to_agent).toBe("target-agent");
      expect(result.from_agent).toBe("messaging-test-agent");
    });

    test("sends with priority", async () => {
      const result = parseResult(await client.callTool({
        name: "send_message",
        arguments: { to: "target-urgent", content: "urgent msg", priority: "urgent" },
      }) as any) as any;
      expect(result.priority).toBe("urgent");
    });

    test("sends blocking message", async () => {
      const result = parseResult(await client.callTool({
        name: "send_message",
        arguments: { to: "target-block", content: "fix now", blocking: true },
      }) as any) as any;
      expect(result.blocking).toBe(true);
    });

    test("sends to session", async () => {
      const result = parseResult(await client.callTool({
        name: "send_message",
        arguments: { to: "target", content: "session msg", target_session_id: "uuid-123" },
      }) as any) as any;
      expect(result.to_agent).toContain("session:");
    });
  });

  describe("send_to_session", () => {
    test("sends to specific session", async () => {
      const result = parseResult(await client.callTool({
        name: "send_to_session",
        arguments: { target_session_id: "session-abc", content: "injected msg" },
      }) as any) as any;
      expect(result.to_agent).toBe("session:session-abc");
    });
  });

  describe("read_messages", () => {
    test("reads DMs", async () => {
      const result = parseResult(await client.callTool({
        name: "read_messages",
        arguments: {},
      }) as any) as any;
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.compact).toBe(true);
    });

    test("reads with limit", async () => {
      const result = parseResult(await client.callTool({
        name: "read_messages",
        arguments: { limit: 5 },
      }) as any) as any;
      expect(result.count).toBeLessThanOrEqual(5);
    });

    test("keeps collections preview-only and uses get_message for one exact full body", async () => {
      const long = `compact preview ${"x".repeat(220)} tail-visible-only-in-verbose`;
      const sent = parseResult(await client.callTool({
        name: "send_message",
        arguments: { to: "compact-reader", content: long },
      }) as any) as any;

      const compact = parseResult(await client.callTool({
        name: "read_messages",
        arguments: { to: "compact-reader" },
      }) as any) as any;
      expect(compact.compact).toBe(true);
      expect(compact.messages[0].preview).toContain("compact preview");
      expect(compact.messages[0].content).toBeUndefined();
      expect(getMessageById(sent.id)?.read_at).toBeNull();
      expect(getReadReceipts(sent.id)).toEqual([]);

      const verbose = parseResult(await client.callTool({
        name: "read_messages",
        arguments: { to: "compact-reader", verbose: true },
      }) as any) as any;
      expect(verbose.compact).toBe(true);
      expect(verbose.messages.every((message: any) => message.content === undefined)).toBe(true);

      const exact = parseResult(await client.callTool({
        name: "get_message",
        arguments: { id: sent.id },
      }) as any) as any;
      expect(exact.content).toBe(long);

      await client.callTool({
        name: "read_messages",
        arguments: { to: "compact-reader", mark_read: true },
      });
      expect(getMessageById(sent.id)?.read_at).not.toBeNull();
    });

    test("supports latest param", async () => {
      const result = parseResult(await client.callTool({
        name: "read_messages",
        arguments: { latest: 3 },
      }) as any) as any;
      expect(Array.isArray(result.messages)).toBe(true);
    });
  });

  describe("get_message", () => {
    test("returns error for nonexistent message", async () => {
      const result = await client.callTool({
        name: "get_message",
        arguments: { id: 99999 },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("list_sessions", () => {
    test("lists sessions", async () => {
      const result = parseResult(await client.callTool({
        name: "list_sessions",
        arguments: {},
      }) as any) as any;
      expect(Array.isArray(result.sessions)).toBe(true);
      expect(result.compact).toBe(true);
    });
  });

  describe("reply", () => {
    test("returns error for nonexistent parent", async () => {
      const result = await client.callTool({
        name: "reply",
        arguments: { message_id: 99999, content: "reply" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("mark_read", () => {
    test("returns error when no ids or all", async () => {
      const result = await client.callTool({
        name: "mark_read",
        arguments: {},
      });
      expect((result as any).isError).toBe(true);
    });

    test("marks all as read", async () => {
      const result = parseResult(await client.callTool({
        name: "mark_read",
        arguments: { all: true },
      }) as any) as any;
      expect(result.marked_read).toBe(0);
    });
  });

  describe("mark_unread", () => {
    test("returns error when no ids", async () => {
      const result = await client.callTool({
        name: "mark_unread",
        arguments: {},
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("mark_channel_read", () => {
    test("marks channel messages read", async () => {
      createChannel("messaging-channel", "messaging-test-agent");
      const result = parseResult(await client.callTool({
        name: "mark_channel_read",
        arguments: { channel: "messaging-channel" },
      }) as any) as any;
      expect(result.channel).toBe("messaging-channel");
    });
  });

  describe("search_messages", () => {
    test("returns search results", async () => {
      const result = parseResult(await client.callTool({
        name: "search_messages",
        arguments: { query: "test" },
      }) as any) as any;
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.compact).toBe(true);
    });
  });

  describe("export_messages", () => {
    test("exports as JSON by default", async () => {
      const result = parseResult(await client.callTool({
        name: "export_messages",
        arguments: {},
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("read_digest", () => {
    test("requires a scoped target", async () => {
      const result = await client.callTool({
        name: "read_digest",
        arguments: {},
      });
      expect((result as any).isError).toBe(true);
    });

    test("applies default project resolver when project_id is omitted", async () => {
      const server = new McpServer({ name: "test-focused-digest-mcp", version: "0.0.1" });
      registerMessagingTools(server, async (explicit, _agent) => explicit ?? "focused-project");
      const [focusedClientTransport, focusedServerTransport] = InMemoryTransport.createLinkedPair();
      const focusedClient = new Client({ name: "test-focused-client", version: "1.0.0" });
      await server.connect(focusedServerTransport);
      await focusedClient.connect(focusedClientTransport);

      const included = sendMessage({ from: "alice", to: "focused-reader", content: "included", project_id: "focused-project" });
      sendMessage({ from: "alice", to: "focused-reader", content: "excluded", project_id: "other-project" });

      const result = parseResult(await focusedClient.callTool({
        name: "read_digest",
        arguments: { to: "focused-reader", from: "project-reader" },
      }) as any) as any;
      expect(result.message_ids).toEqual([included.id]);
      expect(result.total_available).toBe(1);

      await focusedClient.close();
    });

    test("returns cursored byte-capped digest", async () => {
      createChannel("digest-mcp-channel", "messaging-test-agent");
      const first = sendMessage({ from: "alice", to: "digest-mcp-channel", channel: "digest-mcp-channel", content: "first digest evidence" });
      const second = sendMessage({ from: "bob", to: "digest-mcp-channel", channel: "digest-mcp-channel", content: `second digest evidence ${"x".repeat(500)}` });
      const result = parseResult(await client.callTool({
        name: "read_digest",
        arguments: { channel: "digest-mcp-channel", cursor: first.id, max_bytes: 900 },
      }) as any) as any;
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.digest_id).toHaveLength(16);
      expect(result.message_ids).toEqual([second.id]);
      expect(result.next_cursor).toBe(second.id);
      expect(result.byte_length).toBeLessThanOrEqual(900);
      expect(result.messages[0].snippet).toContain("second digest evidence");
      expect(result.messages[0].content).toBeUndefined();
    });
  });

  describe("delete_message", () => {
    test("returns error for nonexistent message", async () => {
      const result = await client.callTool({
        name: "delete_message",
        arguments: { id: 99999 },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("edit_message", () => {
    test("returns error for nonexistent message", async () => {
      const result = await client.callTool({
        name: "edit_message",
        arguments: { id: 99999, content: "edited" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("pin_message", () => {
    test("returns error for nonexistent message", async () => {
      const result = await client.callTool({
        name: "pin_message",
        arguments: { id: 99999 },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("unpin_message", () => {
    test("returns error for nonexistent message", async () => {
      const result = await client.callTool({
        name: "unpin_message",
        arguments: { id: 99999 },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("get_pinned_messages", () => {
    test("returns empty pinned list", async () => {
      const result = parseResult(await client.callTool({
        name: "get_pinned_messages",
        arguments: {},
      }) as any) as any;
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.compact).toBe(true);
    });
  });

  describe("broadcast", () => {
    test("sends to multiple channels", async () => {
      createChannel("bc-channel-1", "messaging-test-agent");
      createChannel("bc-channel-2", "messaging-test-agent");
      const result = parseResult(await client.callTool({
        name: "broadcast",
        arguments: { channels: ["bc-channel-1", "bc-channel-2"], content: "broadcast msg" },
      }) as any) as any;
      expect(result.sent.length).toBe(2);
      expect(result.total).toBe(2);
    });
  });
});
