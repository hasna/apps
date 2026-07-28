/**
 * Contract test for the MCP tool surface every client actually sees.
 *
 * Tools are declared with zod/v3 raw shapes and registered through
 * registerMcpTool (./tool-compat.ts); the SDK converts those shapes into the
 * JSON Schema it publishes on tools/list. The rest of the suite only ever
 * exercises handlers via callTool, so how a tool is *registered* can be changed
 * across the whole tool set without a single assertion noticing — even though
 * that reshapes the advertised inputSchema of every tool.
 *
 * These assertions pin the emitted contract: the tool inventory, the closed
 * (additionalProperties: false) object schemas, and the shape of a
 * representative required-argument, all-optional, nullable, and
 * array-of-object argument. Changing the registration path or the zod entry
 * point has to break these tests before it reaches published clients.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/**
 * Every tool the stdio server publishes with no optional bridge configured,
 * sorted. Adding or removing a tool is a change to the package's public MCP
 * surface, so it must be made here too.
 *
 * The Telegram bridge is deliberately absent: registerTelegramChannel()
 * (./telegram-channel.ts) only registers telegram_send when TELEGRAM_BOT_TOKEN
 * is set, so it is opt-in configuration rather than the published surface. See
 * the beforeAll below for how that env gate is closed for this suite.
 */
const EXPECTED_TOOL_NAMES = [
  "acquire_lock",
  "add_comment",
  "add_dependency",
  "add_reaction",
  "archive_channel",
  "assign_task",
  "block_task",
  "broadcast",
  "build_graph",
  "bulk_acquire_lock",
  "cancel_task",
  "check_lock",
  "clean_expired_locks",
  "complete_task",
  "create_channel",
  "create_project",
  "create_task",
  "delete_message",
  "delete_project",
  "delete_task",
  "describe_tools",
  "edit_message",
  "export_messages",
  "get_agent_network",
  "get_blockers",
  "get_channel_topic",
  "get_comments",
  "get_dependencies",
  "get_dependents",
  "get_due_tasks",
  "get_focus",
  "get_mentions",
  "get_message",
  "get_pinned_messages",
  "get_project",
  "get_reaction_summary",
  "get_reactions",
  "get_related",
  "get_session_activity",
  "get_subtasks",
  "get_summary",
  "get_task",
  "get_task_activity",
  "get_task_summary",
  "get_task_tree",
  "get_thread_replies",
  "get_topics",
  "graph_stats",
  "heartbeat",
  "hot_sessions",
  "join_channel",
  "leave_channel",
  "list_agents",
  "list_channel_subscriptions",
  "list_channels",
  "list_locks",
  "list_projects",
  "list_sessions",
  "list_tasks",
  "list_unread_counts",
  "mark_channel_notifications_read",
  "mark_channel_read",
  "mark_mentions_read",
  "mark_read",
  "mark_read_receipt",
  "mark_unread",
  "pin_message",
  "react",
  "read_channel",
  "read_channel_notifications",
  "read_digest",
  "read_messages",
  "read_receipts",
  "read_thread",
  "register_agent",
  "release_lock",
  "remove_agent",
  "remove_dependency",
  "remove_reaction",
  "rename_agent",
  "rename_channel",
  "reopen_task",
  "reply",
  "search_messages",
  "search_tasks",
  "search_tools",
  "send_feedback",
  "send_message",
  "send_to_channel",
  "send_to_session",
  "set_channel_topic",
  "set_focus",
  "set_task_priority",
  "start_task",
  "subscribe_channel_notifications",
  "summarize_channel",
  "tmux_broadcast",
  "tmux_send",
  "trending_topics",
  "unarchive_channel",
  "unblock_task",
  "unfocus",
  "unpin_message",
  "unreact",
  "unsubscribe_channel_notifications",
  "update_channel",
  "update_project",
];

/** The only tools that take no arguments, and therefore publish an open schema. */
const TOOLS_WITHOUT_ARGUMENTS = ["build_graph", "clean_expired_locks", "graph_stats"];

const JSON_SCHEMA_DRAFT = "http://json-schema.org/draft-07/schema#";

type PublishedTool = { name: string; inputSchema: Record<string, any> };

describe("published MCP tool contract", () => {
  let client: Client;
  let tools: PublishedTool[];
  let telegramToken: string | undefined;

  function schemaOf(name: string): Record<string, any> {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool "${name}" is not published`);
    return tool.inputSchema;
  }

  beforeAll(async () => {
    // The published surface must not depend on the shell this runs in.
    // TELEGRAM_BOT_TOKEN is the variable this package's own Telegram bridge
    // needs, so anyone actually exercising the bridge would otherwise get a
    // 108th tool here and a red suite from a change they never made. Clearing
    // it before ./index.js is loaded also keeps that module's top-level
    // buildServer() from starting a poll loop against api.telegram.org.
    telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;

    const { buildServer } = await import("./index.js");
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "tool-contract-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    tools = (await client.listTools()).tools as PublishedTool[];
  });

  afterAll(async () => {
    try {
      await client.close();
    } finally {
      if (telegramToken !== undefined) {
        process.env.TELEGRAM_BOT_TOKEN = telegramToken;
      } else {
        delete process.env.TELEGRAM_BOT_TOKEN;
      }
    }
  });

  test("publishes exactly the expected tool inventory", () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOL_NAMES);
    expect(tools).toHaveLength(EXPECTED_TOOL_NAMES.length);
  });

  test("publishes a closed object schema for every tool that takes arguments", () => {
    const open: string[] = [];
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      const hasArguments = Object.keys(tool.inputSchema.properties ?? {}).length > 0;
      if (!hasArguments) {
        open.push(tool.name);
        continue;
      }
      // additionalProperties: false is what tells a client which keys are legal.
      // Dropping it across the tool set is a silent contract change.
      expect({ tool: tool.name, additionalProperties: tool.inputSchema.additionalProperties })
        .toEqual({ tool: tool.name, additionalProperties: false });
    }
    expect(open.sort()).toEqual(TOOLS_WITHOUT_ARGUMENTS);
  });

  test("pins the schema of a required-argument tool (get_project)", () => {
    expect(schemaOf("get_project")).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
      $schema: JSON_SCHEMA_DRAFT,
    });
  });

  test("pins the schema of an all-optional tool (list_projects)", () => {
    const schema = schemaOf("list_projects");
    expect(schema).toEqual({
      type: "object",
      properties: {
        status: { type: "string" },
        limit: { type: "number" },
        cursor: { type: "number" },
        verbose: { type: "boolean", description: "Return legacy raw project array" },
      },
      additionalProperties: false,
      $schema: JSON_SCHEMA_DRAFT,
    });
    // No argument is mandatory, so the schema must not advertise `required`.
    expect(schema.required).toBeUndefined();
  });

  test("pins the schema of a nullable argument (set_channel_topic.topic)", () => {
    expect(schemaOf("set_channel_topic")).toEqual({
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel name" },
        topic: {
          type: ["string", "null"],
          description: "New topic/status. Pass null to clear.",
        },
      },
      required: ["channel", "topic"],
      additionalProperties: false,
      $schema: JSON_SCHEMA_DRAFT,
    });
  });

  test("pins the schema of an array-of-object argument (bulk_acquire_lock.resources)", () => {
    expect(schemaOf("bulk_acquire_lock")).toEqual({
      type: "object",
      properties: {
        resources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              resource_type: { type: "string" },
              resource_id: { type: "string" },
              lock_type: { type: "string", enum: ["advisory", "exclusive"] },
              expiry_ms: { type: "number" },
            },
            required: ["resource_type", "resource_id"],
            additionalProperties: false,
          },
        },
        from: { type: "string" },
        auto_dm: { type: "boolean" },
      },
      required: ["resources"],
      additionalProperties: false,
      $schema: JSON_SCHEMA_DRAFT,
    });
  });

  test("pins nullable and free-form record arguments (list_tasks)", () => {
    const properties = schemaOf("list_tasks").properties;
    expect(properties.parent_id).toEqual({ type: ["number", "null"] });
    expect(properties.metadata).toEqual({ type: "object", additionalProperties: {} });
    // z.coerce.number() must still advertise a plain number, not a union.
    expect(properties.limit).toEqual({ type: "number" });
    expect(properties.cursor).toEqual({ type: "number", description: "Alias for offset" });
  });
});
