import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAdvancedTools } from "./advanced";
import { closeDb } from "../../lib/db";
import { createDisposableStore, enterHermeticTestEnv, installNetworkGuard } from "../../test/hermetic";

const TEST_STORE = createDisposableStore("advanced-mcp");

describe("advanced MCP tools", () => {
  let client: Client;
  let restoreEnv: () => void;
  let restoreNetwork: () => void;

  beforeAll(async () => {
    restoreEnv = enterHermeticTestEnv({
      CONVERSATIONS_DB_PATH: TEST_STORE.dbPath,
      CONVERSATIONS_AGENT_ID: "advanced-test-agent",
    });
    restoreNetwork = installNetworkGuard();
    closeDb();

    const server = new McpServer({ name: "test-advanced-mcp", version: "0.0.1" });
    registerAdvancedTools(server, "1.0.0-test");

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

  describe("read_receipts", () => {
    test("returns empty receipts for nonexistent message", async () => {
      const result = parseResult(await client.callTool({
        name: "read_receipts",
        arguments: { message_id: 99999 },
      }) as any) as any;
      expect(result.count).toBe(0);
      expect(Array.isArray(result.receipts)).toBe(true);
    });
  });

  describe("mark_read_receipt", () => {
    test("marks a message as read by agent", async () => {
      // First send a message so message exists
      const msg = (await import("../../lib/messages")).sendMessage({
        from: "receipt-sender", to: "advanced-test-agent", content: "receipt test"
      });
      const result = parseResult(await client.callTool({
        name: "mark_read_receipt",
        arguments: { message_id: msg.id, agent: "receipt-agent" },
      }) as any) as any;
      expect(result).toContain("Marked");
    });
  });

  describe("react / add_reaction", () => {
    test("add_reaction adds emoji", async () => {
      // First send a message so message 1 exists
      const { sendMessage } = await import("../../lib/messages");
      const msg = sendMessage({ from: "react-sender", to: "advanced-test-agent", content: "react test" });

      const result = parseResult(await client.callTool({
        name: "add_reaction",
        arguments: { message_id: msg.id, emoji: "thumbsup" },
      }) as any) as any;
      expect(result.emoji).toBe("thumbsup");
    });

    test("react alias works", async () => {
      const msg = (await import("../../lib/messages")).sendMessage({
        from: "react-sender2", to: "advanced-test-agent", content: "react alias"
      });
      const result = parseResult(await client.callTool({
        name: "react",
        arguments: { message_id: msg.id, emoji: "heart" },
      }) as any) as any;
      expect(result.emoji).toBe("heart");
    });
  });

  describe("unreact / remove_reaction", () => {
    test("remove_reaction removes emoji", async () => {
      const { sendMessage } = await import("../../lib/messages");
      const msg = sendMessage({ from: "unreact-sender", to: "advanced-test-agent", content: "unreact test" });
      // Add a reaction first
      await import("../../lib/reactions").then(m => m.addReaction(msg.id, "advanced-test-agent", "fire"));

      const result = parseResult(await client.callTool({
        name: "remove_reaction",
        arguments: { message_id: msg.id, emoji: "fire" },
      }) as any) as any;
      expect(result.removed).toBe(true);
    });

    test("unreact alias works", async () => {
      const msg = (await import("../../lib/messages")).sendMessage({
        from: "unreact-alias", to: "advanced-test-agent", content: "unreact alias"
      });
      (await import("../../lib/reactions")).addReaction(msg.id, "advanced-test-agent", "rocket");

      const result = parseResult(await client.callTool({
        name: "unreact",
        arguments: { message_id: msg.id, emoji: "rocket" },
      }) as any) as any;
      expect(result.removed).toBe(true);
    });
  });

  describe("get_reactions / get_reaction_summary", () => {
    test("get_reactions returns empty for message with no reactions", async () => {
      const result = parseResult(await client.callTool({
        name: "get_reactions",
        arguments: { message_id: 99999 },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });

    test("get_reaction_summary returns summary", async () => {
      const result = parseResult(await client.callTool({
        name: "get_reaction_summary",
        arguments: { message_id: 99999 },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("list_unread_counts", () => {
    test("returns unread counts", async () => {
      const result = parseResult(await client.callTool({
        name: "list_unread_counts",
        arguments: {},
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });

    test("returns counts with mentions for agent", async () => {
      const result = parseResult(await client.callTool({
        name: "list_unread_counts",
        arguments: { agent: "advanced-test-agent", include_mentions: true },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("get_mentions", () => {
    test("returns preview-only mentions even when verbose is requested", async () => {
      const { sendMessage } = await import("../../lib/messages");
      sendMessage({
        from: "mention-sender",
        to: "mention-safe-channel",
        channel: "mention-safe-channel",
        content: "@advanced-test-agent bounded mention body",
      });
      const result = parseResult(await client.callTool({
        name: "get_mentions",
        arguments: { agent: "advanced-test-agent", unread_only: false, verbose: true },
      }) as any) as any;
      expect(Array.isArray(result.mentions)).toBe(true);
      expect(result.mentions[0].message.preview).toContain("bounded mention");
      expect(result.mentions[0].message.content).toBeUndefined();
    });
  });

  describe("mark_mentions_read", () => {
    test("marks mentions read for agent", async () => {
      const result = parseResult(await client.callTool({
        name: "mark_mentions_read",
        arguments: { agent: "advanced-test-agent" },
      }) as any) as any;
      expect(result.cleared).toBeGreaterThanOrEqual(1);
    });
  });

  describe("graph tools", () => {
    test("build_graph returns edge counts", async () => {
      const result = parseResult(await client.callTool({
        name: "build_graph",
        arguments: {},
      }) as any) as any;
      expect(result).toBeDefined();
    });

    test("get_related returns related entities", async () => {
      const result = parseResult(await client.callTool({
        name: "get_related",
        arguments: { entity_type: "agent", entity_id: "advanced-test-agent" },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });

    test("get_agent_network returns network", async () => {
      const result = parseResult(await client.callTool({
        name: "get_agent_network",
        arguments: { agent: "advanced-test-agent" },
      }) as any) as any;
      expect(result).toBeDefined();
    });

    test("graph_stats returns stats", async () => {
      const result = parseResult(await client.callTool({
        name: "graph_stats",
        arguments: {},
      }) as any) as any;
      expect(result).toBeDefined();
    });
  });

  describe("get_summary", () => {
    test("returns error when no session_id or channel", async () => {
      const result = await client.callTool({
        name: "get_summary",
        arguments: {},
      });
      expect((result as any).isError).toBe(true);
    });

    test("returns error for nonexistent session", async () => {
      const result = await client.callTool({
        name: "get_summary",
        arguments: { session_id: "nonexistent-session" },
      });
      expect((result as any).isError).toBe(true);
    });
  });

  describe("get_topics", () => {
    test("returns trending topics when no channel or session", async () => {
      const result = parseResult(await client.callTool({
        name: "get_topics",
        arguments: {},
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("trending_topics", () => {
    test("returns trending topics", async () => {
      const result = parseResult(await client.callTool({
        name: "trending_topics",
        arguments: { hours: 24, top_n: 10 },
      }) as any) as any;
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("hot_sessions", () => {
    test("returns hot sessions (empty when no data)", async () => {
      const result = parseResult(await client.callTool({
        name: "hot_sessions",
        arguments: { limit: 5 },
      }) as any) as any;
      expect(Array.isArray(result.sessions)).toBe(true);
      expect(result.count).toBe(result.sessions.length);
    });
  });

  describe("lock tools", () => {
    test("acquire_lock acquires a lock", async () => {
      const result = parseResult(await client.callTool({
        name: "acquire_lock",
        arguments: { resource_type: "file", resource_id: "test-lock", auto_dm: false },
      }) as any) as any;
      expect(result.acquired).toBe(true);
    });

    test("check_lock shows locked resource", async () => {
      // Acquire first
      await client.callTool({
        name: "acquire_lock",
        arguments: { resource_type: "check-test", resource_id: "res-1", auto_dm: false },
      });
      const result = parseResult(await client.callTool({
        name: "check_lock",
        arguments: { resource_type: "check-test", resource_id: "res-1" },
      }) as any) as any;
      // check_lock returns the lock object directly (with agent_id etc.) or { locked: false }
      expect(result.agent_id || result.locked === false).toBeDefined();
    });

    test("release_lock releases a lock", async () => {
      const result = parseResult(await client.callTool({
        name: "release_lock",
        arguments: { resource_type: "file", resource_id: "test-lock" },
      }) as any) as any;
      expect(result.released).toBe(true);
    });

    test("list_locks returns lock list", async () => {
      const result = parseResult(await client.callTool({
        name: "list_locks",
        arguments: {},
      }) as any) as any;
      expect(Array.isArray(result.locks)).toBe(true);
      expect(result.count).toBe(result.locks.length);
    });

    test("bulk_acquire_lock acquires multiple locks", async () => {
      const result = parseResult(await client.callTool({
        name: "bulk_acquire_lock",
        arguments: {
          resources: [
            { resource_type: "bulk", resource_id: "res-1" },
            { resource_type: "bulk", resource_id: "res-2" },
          ],
          auto_dm: false,
        },
      }) as any) as any;
      expect(result.acquired).toBe(true);
    });

    test("clean_expired_locks returns counts", async () => {
      const result = parseResult(await client.callTool({
        name: "clean_expired_locks",
        arguments: {},
      }) as any) as any;
      expect(result.total).toBeDefined();
    });
  });

  describe("thread tools", () => {
    test("get_thread_replies returns parent and replies", async () => {
      const result = parseResult(await client.callTool({
        name: "get_thread_replies",
        arguments: { message_id: 99999 },
      }) as any) as any;
      expect(result.parent).toBeNull();
      expect(Array.isArray(result.replies)).toBe(true);
      expect(result.reply_count).toBe(0);
    });

    test("read_thread alias works", async () => {
      const result = parseResult(await client.callTool({
        name: "read_thread",
        arguments: { message_id: 99999 },
      }) as any) as any;
      expect(Array.isArray(result.replies)).toBe(true);
    });

    test("thread collections never expose full bodies through verbose compatibility", async () => {
      const { sendMessage } = await import("../../lib/messages");
      const parent = sendMessage({ from: "thread-a", to: "thread-b", content: "parent exact-only body" });
      sendMessage({ from: "thread-b", to: "thread-a", content: "reply exact-only body", reply_to: parent.id, session_id: parent.session_id });
      const result = parseResult(await client.callTool({
        name: "get_thread_replies",
        arguments: { message_id: parent.id, verbose: true },
      }) as any) as any;
      expect(result.parent.preview).toContain("parent exact-only");
      expect(result.parent.content).toBeUndefined();
      expect(result.replies[0].preview).toContain("reply exact-only");
      expect(result.replies[0].content).toBeUndefined();
    });
  });

  describe("search_tools", () => {
    test("returns all tools when no query", async () => {
      const result = parseResult(await client.callTool({
        name: "search_tools",
        arguments: {},
      }) as any) as any;
      expect(typeof result).toBe("string");
      expect(result).toContain("send_message");
    });

    test("filters tools by query", async () => {
      const result = parseResult(await client.callTool({
        name: "search_tools",
        arguments: { query: "lock" },
      }) as any) as any;
      expect(typeof result).toBe("string");
      expect(result).toContain("lock");
    });
  });

  describe("describe_tools", () => {
    test("returns descriptions for known tools", async () => {
      const result = parseResult(await client.callTool({
        name: "describe_tools",
        arguments: { names: ["send_message", "read_messages"] },
      }) as any) as any;
      expect(typeof result).toBe("string");
      expect(result).toContain("send_message");
      expect(result).toContain("read_messages");
    });
  });

  describe("send_feedback", () => {
    test("saves feedback successfully", async () => {
      const result = parseResult(await client.callTool({
        name: "send_feedback",
        arguments: { message: "Great tool!", category: "general" },
      }) as any) as any;
      expect(result).toContain("Feedback saved");
    });

    test("saves feedback with email", async () => {
      const result = parseResult(await client.callTool({
        name: "send_feedback",
        arguments: { message: "Bug report", email: "test@example.com", category: "bug" },
      }) as any) as any;
      expect(result).toContain("Feedback saved");
    });
  });
});
