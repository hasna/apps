import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "./index.js";
import { closeDb, getDb } from "../lib/db.js";
import { sendMessage, readMessages } from "../lib/messages.js";
import { createChannel } from "../lib/channels.js";
import { setSessionAgent } from "./channel.js";
import { heartbeat } from "../lib/presence.js";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-mcp-${Date.now()}.db`);
let client: Client;

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "mcp_user:synthetic-password", "@db.example.invalid/app"].join("");
}

function insertLegacyChannelMessage(channel: string, content: string, opts?: { priority?: string; blocking?: boolean }): number {
  const result = getDb().prepare(`
    INSERT INTO messages (session_id, from_agent, to_agent, channel, content, priority, blocking)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(`channel:${channel}`, "legacy-from", channel, channel, content, opts?.priority ?? "normal", opts?.blocking ? 1 : 0);
  return Number(result.lastInsertRowid);
}

beforeAll(async () => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  delete process.env.CONVERSATIONS_AGENT_ID;
  // Also cleared: an operator following the migration note may have exported
  // this globally, and it would silently turn the refusal assertions below into
  // failures that read like a real regression.
  delete process.env.CONVERSATIONS_USE_MACHINE_IDENTITY;
  closeDb();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
});

function parseResult(result: { content: unknown[] }): unknown {
  const text = (result.content[0] as { type: string; text: string }).text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---- send_message ----

describe("send_message from parameter", () => {
  test("uses explicit from when provided", async () => {
    const result = await client.callTool({
      name: "send_message",
      arguments: { from: "agent-alpha", to: "agent-beta", content: "hello from alpha" },
    });
    const msg = parseResult(result as any) as any;
    expect(msg.from_agent).toBe("agent-alpha");
    expect(msg.to_agent).toBe("agent-beta");
    expect(msg.content).toBe("hello from alpha");
  });

  // Identity is no longer invented or borrowed when `from` is omitted: the tool
  // refuses instead. Attributing a write to a name the caller never chose is
  // what corrupted a day of message history on a multi-seat box.
  test("refuses to attribute the send when from is omitted and no env var", async () => {
    const result = await client.callTool({
      name: "send_message",
      arguments: { to: "someone", content: "no from" },
    });
    expect((result as any).isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/no agent identity/i);
  });

  test("uses env var when from is omitted", async () => {
    process.env.CONVERSATIONS_AGENT_ID = "env-agent";
    const result = await client.callTool({
      name: "send_message",
      arguments: { to: "someone", content: "from env" },
    });
    const msg = parseResult(result as any) as any;
    expect(msg.from_agent).toBe("env-agent");
    delete process.env.CONVERSATIONS_AGENT_ID;
  });

  test("explicit from overrides env var", async () => {
    process.env.CONVERSATIONS_AGENT_ID = "env-agent";
    const result = await client.callTool({
      name: "send_message",
      arguments: { from: "explicit-agent", to: "someone", content: "explicit wins" },
    });
    const msg = parseResult(result as any) as any;
    expect(msg.from_agent).toBe("explicit-agent");
    delete process.env.CONVERSATIONS_AGENT_ID;
  });

  test("blocks sensitive content without echoing the value", async () => {
    const blocked = syntheticDatabaseUrl();
    const result = await client.callTool({
      name: "send_message",
      arguments: { from: "agent-alpha", to: "agent-beta", content: `blocked ${blocked}` },
    }) as any;
    const text = (result.content[0] as { type: string; text: string }).text;

    expect(result.isError).toBe(true);
    expect(text).toContain("sensitive content detected");
    expect(text).not.toContain(blocked);
    expect(readMessages({ to: "agent-beta" }).some((message) => message.content.includes(blocked))).toBe(false);
  });

  test("blocks sensitive session-target metadata without echoing the value", async () => {
    const blocked = syntheticDatabaseUrl();
    const result = await client.callTool({
      name: "send_to_session",
      arguments: { from: "agent-alpha", target_session_id: blocked, content: "metadata route should be checked" },
    }) as any;
    const text = (result.content[0] as { type: string; text: string }).text;
    const persisted = JSON.stringify(readMessages());

    expect(result.isError).toBe(true);
    expect(text).toContain("sensitive content detected");
    expect(text).not.toContain(blocked);
    expect(persisted).not.toContain(blocked);
  });
});

// ---- reply ----

describe("reply from parameter", () => {
  test("uses explicit from when replying", async () => {
    const sent = sendMessage({ from: "alice", to: "bob", content: "original" });
    const result = await client.callTool({
      name: "reply",
      arguments: { from: "bob", message_id: sent.id, content: "reply from bob" },
    });
    const msg = parseResult(result as any) as any;
    expect(msg.from_agent).toBe("bob");
    expect(msg.session_id).toBe(sent.session_id);
  });

  // Identity is no longer invented or borrowed when `from` is omitted: the tool
  // refuses instead. Attributing a write to a name the caller never chose is
  // what corrupted a day of message history on a multi-seat box.
  test("refuses to attribute the reply when from is omitted", async () => {
    const sent = sendMessage({ from: "alice", to: "bob", content: "hey auto" });
    const result = await client.callTool({
      name: "reply",
      arguments: { message_id: sent.id, content: "reply without from" },
    });
    expect((result as any).isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/no agent identity/i);
  });
});

// ---- mark_read ----

describe("mark_read from parameter", () => {
  test("marks messages read for explicit agent", async () => {
    const sent = sendMessage({ from: "alice", to: "bob", content: "unread msg" });
    const result = await client.callTool({
      name: "mark_read",
      arguments: { from: "bob", ids: [sent.id] },
    });
    const data = parseResult(result as any) as any;
    expect(data.marked_read).toBe(1);
  });

  // Identity is no longer invented or borrowed when `from` is omitted: the tool
  // refuses instead. Attributing a write to a name the caller never chose is
  // what corrupted a day of message history on a multi-seat box.
  test("refuses to mark another identity's mail read when from is omitted", async () => {
    const sent = sendMessage({ from: "alice", to: "bob", content: "for auto" });
    const result = await client.callTool({
      name: "mark_read",
      arguments: { ids: [sent.id] },
    });
    expect((result as any).isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/no agent identity/i);
  });
});

// ---- create_channel ----

describe("create_channel from parameter", () => {
  test("creates channel with explicit creator", async () => {
    const result = await client.callTool({
      name: "create_channel",
      arguments: { from: "channel-creator", name: "test-channel-from" },
    });
    const sp = parseResult(result as any) as any;
    expect(sp.name).toBe("test-channel-from");
    expect(sp.created_by).toBe("channel-creator");
  });

  // Identity is no longer invented or borrowed when `from` is omitted: the tool
  // refuses instead. Attributing a write to a name the caller never chose is
  // what corrupted a day of message history on a multi-seat box.
  test("refuses to record a creator when from is omitted", async () => {
    const result = await client.callTool({
      name: "create_channel",
      arguments: { name: "test-channel-no-from" },
    });
    expect((result as any).isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/no agent identity/i);
  });
});

// ---- send_to_channel ----

describe("send_to_channel from parameter", () => {
  test("sends to channel with explicit from", async () => {
    createChannel("msg-channel", "creator");
    const result = await client.callTool({
      name: "send_to_channel",
      arguments: { from: "channel-sender", channel: "msg-channel", content: "hello channel" },
    });
    const msg = parseResult(result as any) as any;
    expect(msg.from_agent).toBe("channel-sender");
    expect(msg.channel).toBe("msg-channel");
  });

  // Identity is no longer invented or borrowed when `from` is omitted: the tool
  // refuses instead. Attributing a write to a name the caller never chose is
  // what corrupted a day of message history on a multi-seat box.
  test("refuses to attribute the channel post when from is omitted", async () => {
    createChannel("msg-channel-2", "creator");
    const result = await client.callTool({
      name: "send_to_channel",
      arguments: { channel: "msg-channel-2", content: "no from" },
    });
    expect((result as any).isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/no agent identity/i);
  });

  test("blocks sensitive channel input without echoing the value", async () => {
    const blocked = syntheticDatabaseUrl();
    const result = await client.callTool({
      name: "send_to_channel",
      arguments: { from: "channel-sender", channel: blocked, content: "channel should be checked" },
    }) as any;
    const text = (result.content[0] as { type: string; text: string }).text;

    expect(result.isError).toBe(true);
    expect(text).toContain("sensitive content detected");
    expect(text).not.toContain(blocked);
  });

  test("broadcast blocks sensitive channel input without echoing the value", async () => {
    const blocked = syntheticDatabaseUrl();
    const result = await client.callTool({
      name: "broadcast",
      arguments: { from: "channel-sender", channels: [blocked], content: "broadcast should be checked" },
    }) as any;
    const text = (result.content[0] as { type: string; text: string }).text;
    const data = JSON.parse(text);

    expect(text).not.toContain(blocked);
    expect(data.sent).toHaveLength(0);
    expect(data.errors[0]).toContain("sensitive content detected");
  });
});

describe("channel notification tools", () => {
  test("subscribe and read channel notifications return preview blurbs for new messages only", async () => {
    createChannel("notify-channel-a", "creator");
    const historical = sendMessage({
      from: "alice",
      to: "notify-channel-a",
      channel: "notify-channel-a",
      session_id: "channel:notify-channel-a",
      content: "historical message before subscription",
    });

    const subscription = parseResult(await client.callTool({
      name: "subscribe_channel_notifications",
      arguments: { from: "notify-agent-a", channel: "notify-channel-a", preview_chars: 18 },
    }) as any) as any;

    expect(subscription.channel).toBe("notify-channel-a");
    expect(subscription.preview_chars).toBe(18);
    expect(subscription.since_message_id).toBe(historical.id);

    const fullContent = "## deployment _finished_ after a very long validation run";
    const live = sendMessage({
      from: "alice",
      to: "notify-channel-a",
      channel: "notify-channel-a",
      session_id: "channel:notify-channel-a",
      content: fullContent,
    });

    const result = parseResult(await client.callTool({
      name: "read_channel_notifications",
      arguments: { from: "notify-agent-a", unread_only: true },
    }) as any) as any;

    expect(result.count).toBe(1);
    expect(result.notifications[0].channel).toBe("notify-channel-a");
    expect(result.notifications[0].message_id).toBe(live.id);
    expect(result.notifications[0].preview).not.toContain("##");
    expect(result.notifications[0].preview).not.toBe(fullContent);
  });

  test("get_message returns the full message for later inspection", async () => {
    createChannel("notify-channel-b", "creator");
    await client.callTool({
      name: "subscribe_channel_notifications",
      arguments: { from: "notify-agent-b", channel: "notify-channel-b" },
    });

    const fullContent = "full body for on-demand inspection";
    const sent = sendMessage({
      from: "bob",
      to: "notify-channel-b",
      channel: "notify-channel-b",
      session_id: "channel:notify-channel-b",
      content: fullContent,
    });

    const notificationResult = parseResult(await client.callTool({
      name: "read_channel_notifications",
      arguments: { from: "notify-agent-b", unread_only: true },
    }) as any) as any;

    expect(notificationResult.notifications[0].message_id).toBe(sent.id);

    const message = parseResult(await client.callTool({
      name: "get_message",
      arguments: { id: sent.id },
    }) as any) as any;

    expect(message.id).toBe(sent.id);
    expect(message.content).toBe(fullContent);
  });

  test("read channel notifications redacts legacy sensitive preview content", async () => {
    const blocked = syntheticDatabaseUrl();
    createChannel("notify-channel-redact", "creator");
    await client.callTool({
      name: "subscribe_channel_notifications",
      arguments: { from: "notify-agent-redact", channel: "notify-channel-redact", preview_chars: 120 },
    });

    insertLegacyChannelMessage("notify-channel-redact", `legacy ${blocked}`);
    const result = parseResult(await client.callTool({
      name: "read_channel_notifications",
      arguments: { from: "notify-agent-redact", unread_only: true },
    }) as any) as any;
    const serialized = JSON.stringify(result);

    expect(serialized).toContain("[REDACTED:DATABASE URL]");
    expect(serialized).not.toContain(blocked);
  });
});

// ---- join_channel ----

describe("join_channel from parameter", () => {
  test("joins channel with explicit from", async () => {
    createChannel("join-channel", "creator");
    const result = await client.callTool({
      name: "join_channel",
      arguments: { from: "joiner-agent", channel: "join-channel" },
    });
    const data = parseResult(result as any) as any;
    expect(data.agent).toBe("joiner-agent");
    expect(data.joined).toBe(true);
  });

  // Identity is no longer invented or borrowed when `from` is omitted: the tool
  // refuses instead. Attributing a write to a name the caller never chose is
  // what corrupted a day of message history on a multi-seat box.
  test("refuses to join as an undeclared identity when from is omitted", async () => {
    createChannel("join-channel-2", "creator");
    const result = await client.callTool({
      name: "join_channel",
      arguments: { channel: "join-channel-2" },
    });
    expect((result as any).isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/no agent identity/i);
  });
});

describe("channel notification subscription tools", () => {
  test("subscribes and lists preview-only channel notifications", async () => {
    createChannel("notify-channel", "creator");

    const subscribeResult = await client.callTool({
      name: "subscribe_channel_notifications",
      arguments: { from: "watcher-agent", channel: "notify-channel", preview_chars: 80 },
    });
    const subscription = parseResult(subscribeResult as any) as any;
    expect(subscription.channel).toBe("notify-channel");
    expect(subscription.agent).toBe("watcher-agent");
    expect(subscription.preview_chars).toBe(80);

    const listResult = await client.callTool({
      name: "list_channel_subscriptions",
      arguments: { from: "watcher-agent" },
    });
    const list = parseResult(listResult as any) as any[];
    expect(list).toHaveLength(1);
    expect(list[0].channel).toBe("notify-channel");
  });

  test("reads preview-only notifications and clears them after read_channel", async () => {
    createChannel("notify-channel-read", "creator");
    await client.callTool({
      name: "subscribe_channel_notifications",
      arguments: { from: "watcher-agent", channel: "notify-channel-read", preview_chars: 24 },
    });

    const sent = sendMessage({
      from: "alice",
      to: "notify-channel-read",
      channel: "notify-channel-read",
      session_id: "channel:notify-channel-read",
      content: "Deployment status update for the shared channel",
    });

    const notificationsResult = await client.callTool({
      name: "read_channel_notifications",
      arguments: { from: "watcher-agent" },
    });
    const notificationsPayload = parseResult(notificationsResult as any) as any;
    expect(notificationsPayload.count).toBe(1);
    expect(notificationsPayload.notifications[0].message_id).toBe(sent.id);
    expect(notificationsPayload.notifications[0].preview).not.toContain("shared channel");

    await client.callTool({
      name: "read_channel",
      arguments: { from: "watcher-agent", channel: "notify-channel-read", limit: 10 },
    });

    const afterReadResult = await client.callTool({
      name: "read_channel_notifications",
      arguments: { from: "watcher-agent" },
    });
    const afterReadPayload = parseResult(afterReadResult as any) as any;
    expect(afterReadPayload.count).toBe(0);
  });
});

describe("channel review tools", () => {
  test("summarize_channel redacts legacy sensitive blocker and priority content", async () => {
    const blocked = syntheticDatabaseUrl();
    createChannel("review-redact", "creator");
    insertLegacyChannelMessage("review-redact", `blocking ${blocked}`, { blocking: true });
    insertLegacyChannelMessage("review-redact", `urgent ${blocked}`, { priority: "urgent" });

    const result = await client.callTool({
      name: "summarize_channel",
      arguments: { channel: "review-redact", since: "1970-01-01T00:00:00.000Z", limit: 10 },
    }) as any;
    const text = (result.content[0] as { type: string; text: string }).text;

    expect(text).toContain("[REDACTED:DATABASE_URL]");
    expect(text).not.toContain(blocked);
  });
});

// ---- leave_channel ----

describe("leave_channel from parameter", () => {
  test("leaves channel with explicit from", async () => {
    createChannel("leave-channel", "leaver-agent");
    const result = await client.callTool({
      name: "leave_channel",
      arguments: { from: "leaver-agent", channel: "leave-channel" },
    });
    const data = parseResult(result as any) as any;
    expect(data.agent).toBe("leaver-agent");
    expect(data.left).toBe(true);
  });
});

// ---- create_project ----

describe("create_project from parameter", () => {
  test("creates project with explicit from", async () => {
    const result = await client.callTool({
      name: "create_project",
      arguments: { from: "proj-creator", name: "test-project-from" },
    });
    const proj = parseResult(result as any) as any;
    expect(proj.name).toBe("test-project-from");
    expect(proj.created_by).toBe("proj-creator");
  });

  // Identity is no longer invented or borrowed when `from` is omitted: the tool
  // refuses instead. Attributing a write to a name the caller never chose is
  // what corrupted a day of message history on a multi-seat box.
  test("refuses to record a project creator when from is omitted", async () => {
    const result = await client.callTool({
      name: "create_project",
      arguments: { name: "test-project-no-from" },
    });
    expect((result as any).isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/no agent identity/i);
  });
});

// ---- delete_message ----

describe("delete_message from parameter", () => {
  test("deletes own message with explicit from", async () => {
    const sent = sendMessage({ from: "deleter", to: "other", content: "to delete" });
    const result = await client.callTool({
      name: "delete_message",
      arguments: { from: "deleter", id: sent.id },
    });
    const data = parseResult(result as any) as any;
    expect(data.deleted).toBe(true);
  });

  test("cannot delete others message", async () => {
    const sent = sendMessage({ from: "alice", to: "bob", content: "alice's msg" });
    const result = await client.callTool({
      name: "delete_message",
      arguments: { from: "bob", id: sent.id },
    });
    expect((result as any).isError).toBe(true);
  });
});

// ---- edit_message ----

describe("edit_message from parameter", () => {
  test("edits own message with explicit from", async () => {
    const sent = sendMessage({ from: "editor", to: "other", content: "original" });
    const result = await client.callTool({
      name: "edit_message",
      arguments: { from: "editor", id: sent.id, content: "edited" },
    });
    const msg = parseResult(result as any) as any;
    expect(msg.content).toBe("edited");
  });

  test("cannot edit others message", async () => {
    const sent = sendMessage({ from: "alice", to: "bob", content: "alice's msg" });
    const result = await client.callTool({
      name: "edit_message",
      arguments: { from: "bob", id: sent.id, content: "hacked" },
    });
    expect((result as any).isError).toBe(true);
  });
});

// ---- heartbeat ----

describe("heartbeat from parameter", () => {
  test("registers heartbeat with explicit from", async () => {
    const result = await client.callTool({
      name: "heartbeat",
      arguments: { from: "heartbeat-agent" },
    });
    const data = parseResult(result as any) as any;
    expect(data.agent).toBe("heartbeat-agent");
    expect(data.heartbeat).toBe(true);
  });

  test("falls back to this MCP session's agent when from is omitted", async () => {
    // The agent that last registered or heartbeated on this connection is the
    // implicit author. Falling through to the machine identity instead would
    // stamp every client on this daemon with the same name.
    setSessionAgent(server, "heartbeat-session-agent");
    const result = await client.callTool({
      name: "heartbeat",
      arguments: {},
    });
    const data = parseResult(result as any) as any;
    expect(data.agent).toBe("heartbeat-session-agent");
  });

  // Identity is no longer invented or borrowed when `from` is omitted: the tool
  // refuses instead. Attributing a write to a name the caller never chose is
  // what corrupted a day of message history on a multi-seat box.
  test("refuses to heartbeat when no agent has registered on this connection", async () => {
    setSessionAgent(server, "");
    const result = await client.callTool({
      name: "heartbeat",
      arguments: {},
    });
    expect((result as any).isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/no agent identity/i);
    setSessionAgent(server, "");
  });

  test("includes custom status", async () => {
    const result = await client.callTool({
      name: "heartbeat",
      arguments: { from: "busy-agent", status: "busy" },
    });
    const data = parseResult(result as any) as any;
    expect(data.agent).toBe("busy-agent");
    expect(data.status).toBe("busy");
  });
});

// ---- Verify tools that don't need from still work ----

describe("read-only tools work without from", () => {
  test("read_messages returns messages", async () => {
    sendMessage({ from: "a", to: "b", content: "readable" });
    const result = await client.callTool({
      name: "read_messages",
      arguments: { limit: 5 },
    });
    const parsed = parseResult(result as any) as any;
    // Response is now {messages, count, offset}
    const msgs = Array.isArray(parsed) ? parsed : parsed?.messages ?? parsed;
    expect(Array.isArray(msgs) ? msgs.length : (parsed?.count ?? 0)).toBeGreaterThan(0);
  });

  test("list_sessions returns sessions", async () => {
    const result = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    const data = parseResult(result as any) as any;
    expect(Array.isArray(data.sessions)).toBe(true);
  });

  test("list_channels returns channels", async () => {
    const result = await client.callTool({
      name: "list_channels",
      arguments: {},
    });
    const data = parseResult(result as any) as any;
    expect(Array.isArray(data.channels)).toBe(true);
  });

  test("list_projects returns projects", async () => {
    const result = await client.callTool({
      name: "list_projects",
      arguments: {},
    });
    const data = parseResult(result as any) as any;
    expect(Array.isArray(data.projects)).toBe(true);
  });

  test("list_agents returns agents", async () => {
    const result = await client.callTool({
      name: "list_agents",
      arguments: {},
    });
    const data = parseResult(result as any) as any;
    expect(Array.isArray(data.agents)).toBe(true);
  });
});

// ---- remove_agent ----

describe("remove_agent", () => {
  test("removes an agent by name", async () => {
    // First register via heartbeat
    await client.callTool({
      name: "heartbeat",
      arguments: { from: "to-remove" },
    });
    const result = await client.callTool({
      name: "remove_agent",
      arguments: { agent: "to-remove" },
    });
    const data = parseResult(result as any) as any;
    expect(data.removed).toBe(true);
    expect(data.agent).toBe("to-remove");
  });

  test("returns error for nonexistent agent", async () => {
    const result = await client.callTool({
      name: "remove_agent",
      arguments: { agent: "ghost-agent-xyz" },
    });
    expect((result as any).isError).toBe(true);
  });

  test("removes self when no agent specified", async () => {
    await client.callTool({
      name: "heartbeat",
      arguments: { from: "self-remover" },
    });
    const result = await client.callTool({
      name: "remove_agent",
      arguments: { from: "self-remover" },
    });
    const data = parseResult(result as any) as any;
    expect(data.removed).toBe(true);
    expect(data.agent).toBe("self-remover");
  });
});

// ---- rename_agent ----

describe("rename_agent", () => {
  test("renames an agent", async () => {
    await client.callTool({
      name: "heartbeat",
      arguments: { from: "old-name-mcp" },
    });
    const result = await client.callTool({
      name: "rename_agent",
      arguments: { from: "old-name-mcp", new_name: "new-name-mcp" },
    });
    const data = parseResult(result as any) as any;
    expect(data.renamed).toBe(true);
    expect(data.old_name).toBe("old-name-mcp");
    expect(data.new_name).toBe("new-name-mcp");
  });

  test("returns error when agent not found", async () => {
    const result = await client.callTool({
      name: "rename_agent",
      arguments: { from: "nonexistent-rename", new_name: "whatever" },
    });
    expect((result as any).isError).toBe(true);
  });

  test("returns error when target name already exists", async () => {
    await client.callTool({
      name: "heartbeat",
      arguments: { from: "rename-src" },
    });
    await client.callTool({
      name: "heartbeat",
      arguments: { from: "rename-dst" },
    });
    const result = await client.callTool({
      name: "rename_agent",
      arguments: { from: "rename-src", new_name: "rename-dst" },
    });
    expect((result as any).isError).toBe(true);
  });
});

// ---- task tools ----

describe("task tools", () => {
  test("create_task creates a task and returns it", async () => {
    const result = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "MCP test task", description: "created via MCP", reporter: "mcp-tester", priority: "high" },
    }) as any) as any;
    expect(result.subject).toBe("MCP test task");
    expect(result.priority).toBe("high");
    expect(result.status).toBe("pending");
    expect(result.reporter).toBe("mcp-tester");
  });

  test("get_task retrieves by id", async () => {
    const created = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Get test", reporter: "mcp-tester" },
    }) as any) as any;
    const result = parseResult(await client.callTool({
      name: "get_task",
      arguments: { id: created.id },
    }) as any) as any;
    expect(result.subject).toBe("Get test");
    expect(result.id).toBe(created.id);
  });

  test("get_task retrieves by uuid", async () => {
    const created = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "UUID get test", reporter: "mcp-tester" },
    }) as any) as any;
    const result = parseResult(await client.callTool({
      name: "get_task",
      arguments: { uuid: created.uuid },
    }) as any) as any;
    expect(result.subject).toBe("UUID get test");
  });

  test("get_task returns error for nonexistent id", async () => {
    const result = await client.callTool({
      name: "get_task",
      arguments: { id: 999999 },
    });
    expect((result as any).isError).toBe(true);
  });

  test("list_tasks returns all tasks", async () => {
    await client.callTool({
      name: "create_task",
      arguments: { subject: "List A", reporter: "mcp-tester" },
    });
    await client.callTool({
      name: "create_task",
      arguments: { subject: "List B", reporter: "mcp-tester" },
    });
    const result = parseResult(await client.callTool({
      name: "list_tasks",
      arguments: {},
    }) as any) as any;
    expect(result.count).toBeGreaterThanOrEqual(2);
    expect(result.tasks.length).toBeGreaterThanOrEqual(2);
  });

  test("list_tasks filters by status", async () => {
    const result = parseResult(await client.callTool({
      name: "list_tasks",
      arguments: { status: "completed" },
    }) as any) as any;
    expect(result.tasks.every((t: any) => t.status === "completed")).toBe(true);
  });

  test("start_task marks task in_progress", async () => {
    const created = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Start test", reporter: "mcp-tester" },
    }) as any) as any;
    const result = parseResult(await client.callTool({
      name: "start_task",
      arguments: { id: created.id, agent: "mcp-tester" },
    }) as any) as any;
    expect(result.status).toBe("in_progress");
    expect(result.started_at).not.toBeNull();
  });

  test("complete_task marks task completed", async () => {
    const created = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Complete test", reporter: "mcp-tester" },
    }) as any) as any;
    await client.callTool({
      name: "start_task",
      arguments: { id: created.id, agent: "mcp-tester" },
    });
    const result = parseResult(await client.callTool({
      name: "complete_task",
      arguments: { id: created.id, agent: "mcp-tester", evidence: "done via MCP" },
    }) as any) as any;
    expect(result.status).toBe("completed");
    expect(result.completed_at).not.toBeNull();
  });

  test("cancel_task cancels a task", async () => {
    const created = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Cancel test", reporter: "mcp-tester" },
    }) as any) as any;
    const result = parseResult(await client.callTool({
      name: "cancel_task",
      arguments: { id: created.id, agent: "mcp-tester", reason: "not needed" },
    }) as any) as any;
    expect(result.status).toBe("cancelled");
  });

  test("block_task and unblock_task", async () => {
    const created = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Block test", reporter: "mcp-tester" },
    }) as any) as any;
    const blocked = parseResult(await client.callTool({
      name: "block_task",
      arguments: { id: created.id, agent: "mcp-tester", reason: "blocked by tester" },
    }) as any) as any;
    expect(blocked.status).toBe("blocked");

    const unblocked = parseResult(await client.callTool({
      name: "unblock_task",
      arguments: { id: created.id, agent: "mcp-tester" },
    }) as any) as any;
    expect(unblocked.status).toBe("pending");
  });

  test("reopen_task reopens a completed task", async () => {
    const created = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Reopen test", reporter: "mcp-tester" },
    }) as any) as any;
    await client.callTool({ name: "start_task", arguments: { id: created.id, agent: "mcp-tester" } });
    await client.callTool({ name: "complete_task", arguments: { id: created.id, agent: "mcp-tester" } });
    const result = parseResult(await client.callTool({
      name: "reopen_task",
      arguments: { id: created.id, agent: "mcp-tester" },
    }) as any) as any;
    expect(result.status).toBe("pending");
    expect(result.completed_at).toBeNull();
  });

  test("assign_task assigns an agent", async () => {
    const created = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Assign test", reporter: "mcp-tester" },
    }) as any) as any;
    const result = parseResult(await client.callTool({
      name: "assign_task",
      arguments: { id: created.id, assignee: "assigned-agent", agent: "mcp-tester" },
    }) as any) as any;
    expect(result.assignee).toBe("assigned-agent");
  });

  test("set_task_priority changes priority", async () => {
    const created = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Priority test", reporter: "mcp-tester" },
    }) as any) as any;
    expect(created.priority).toBe("medium");
    const result = parseResult(await client.callTool({
      name: "set_task_priority",
      arguments: { id: created.id, priority: "critical", agent: "mcp-tester" },
    }) as any) as any;
    expect(result.priority).toBe("critical");
  });

  test("add_comment and get_comments", async () => {
    const created = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Comment test", reporter: "mcp-tester" },
    }) as any) as any;
    await client.callTool({
      name: "add_comment",
      arguments: { task_id: created.id, content: "MCP comment", agent: "mcp-tester" },
    });
    const result = parseResult(await client.callTool({
      name: "get_comments",
      arguments: { task_id: created.id },
    }) as any) as any;
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.comments.some((c: any) => c.preview === "MCP comment")).toBe(true);
  });

  test("subtask creation and get_subtasks", async () => {
    const parent = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Parent task", reporter: "mcp-tester" },
    }) as any) as any;
    await client.callTool({
      name: "create_task",
      arguments: { subject: "Child A", reporter: "mcp-tester", parent_id: parent.id },
    });
    await client.callTool({
      name: "create_task",
      arguments: { subject: "Child B", reporter: "mcp-tester", parent_id: parent.id },
    });
    const result = parseResult(await client.callTool({
      name: "get_subtasks",
      arguments: { parent_id: parent.id },
    }) as any) as any;
    expect(result.count).toBe(2);
  });

  test("add_dependency and get_dependencies", async () => {
    const dep = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Dependency", reporter: "mcp-tester" },
    }) as any) as any;
    const task = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Dependent task", reporter: "mcp-tester" },
    }) as any) as any;
    await client.callTool({
      name: "add_dependency",
      arguments: { task_id: task.id, depends_on_id: dep.id },
    });
    const deps = parseResult(await client.callTool({
      name: "get_dependencies",
      arguments: { task_id: task.id },
    }) as any) as any;
    expect(deps.count).toBe(1);
    expect(deps.dependencies[0].id).toBe(dep.id);
  });

  test("get_dependents returns tasks depending on a task", async () => {
    const dep = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Dep for dependents", reporter: "mcp-tester" },
    }) as any) as any;
    const a = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Dependent A", reporter: "mcp-tester" },
    }) as any) as any;
    const b = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Dependent B", reporter: "mcp-tester" },
    }) as any) as any;
    await client.callTool({ name: "add_dependency", arguments: { task_id: a.id, depends_on_id: dep.id } });
    await client.callTool({ name: "add_dependency", arguments: { task_id: b.id, depends_on_id: dep.id } });
    const result = parseResult(await client.callTool({
      name: "get_dependents",
      arguments: { task_id: dep.id },
    }) as any) as any;
    expect(result.count).toBe(2);
  });

  test("remove_dependency", async () => {
    const dep = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Temp dep", reporter: "mcp-tester" },
    }) as any) as any;
    const task = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Task to unblock", reporter: "mcp-tester" },
    }) as any) as any;
    await client.callTool({ name: "add_dependency", arguments: { task_id: task.id, depends_on_id: dep.id } });
    await client.callTool({
      name: "remove_dependency",
      arguments: { task_id: task.id, depends_on_id: dep.id },
    });
    const deps = parseResult(await client.callTool({
      name: "get_dependencies",
      arguments: { task_id: task.id },
    }) as any) as any;
    expect(deps.count).toBe(0);
  });

  test("auto-unblock via MCP: completing dep unblocks dependent", async () => {
    const dep = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Auto-unblock dep", reporter: "mcp-tester" },
    }) as any) as any;
    const task = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Auto-unblock task", reporter: "mcp-tester" },
    }) as any) as any;
    await client.callTool({ name: "add_dependency", arguments: { task_id: task.id, depends_on_id: dep.id } });

    // Task should be blocked
    let info = parseResult(await client.callTool({
      name: "get_task",
      arguments: { id: task.id },
    }) as any) as any;
    expect(info.status).toBe("blocked");

    // Complete the dependency
    await client.callTool({ name: "start_task", arguments: { id: dep.id, agent: "mcp-tester" } });
    await client.callTool({ name: "complete_task", arguments: { id: dep.id, agent: "mcp-tester" } });

    // Dependent should now be pending
    info = parseResult(await client.callTool({
      name: "get_task",
      arguments: { id: task.id },
    }) as any) as any;
    expect(info.status).toBe("pending");
  });

  test("get_task_activity returns activity log", async () => {
    const created = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Activity test", reporter: "mcp-tester" },
    }) as any) as any;
    const result = parseResult(await client.callTool({
      name: "get_task_activity",
      arguments: { task_id: created.id },
    }) as any) as any;
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.activity[0].action).toBe("created");
  });

  test("get_task_tree returns nested structure", async () => {
    const root = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Tree root", reporter: "mcp-tester" },
    }) as any) as any;
    const child = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Tree child", reporter: "mcp-tester", parent_id: root.id },
    }) as any) as any;
    await client.callTool({
      name: "create_task",
      arguments: { subject: "Tree grandchild", reporter: "mcp-tester", parent_id: child.id },
    });
    const result = parseResult(await client.callTool({
      name: "get_task_tree",
      arguments: { parent_id: root.id },
    }) as any) as any;
    expect(result.tree.subject).toBe("Tree root");
    expect(result.tree.children).toHaveLength(1);
    expect(result.tree.children[0].children).toHaveLength(1);
  });

  test("delete_task removes a task", async () => {
    const created = parseResult(await client.callTool({
      name: "create_task",
      arguments: { subject: "Delete test", reporter: "mcp-tester" },
    }) as any) as any;
    const result = parseResult(await client.callTool({
      name: "delete_task",
      arguments: { id: created.id, agent: "mcp-tester" },
    }) as any) as any;
    expect(result.deleted).toBe(true);

    const lookup = await client.callTool({
      name: "get_task",
      arguments: { id: created.id },
    });
    expect((lookup as any).isError).toBe(true);
  });
});

// ---- acquire_lock auto-DM ----

describe("acquire_lock auto-DM", () => {
  test("auto-DMs holding agent on lock conflict", async () => {
    await client.callTool({
      name: "acquire_lock",
      arguments: { resource_type: "channel", resource_id: "dm-test-room", from: "agent-lock-holder" },
    });

    const result = parseResult(await client.callTool({
      name: "acquire_lock",
      arguments: { resource_type: "channel", resource_id: "dm-test-room", from: "agent-lock-requester" },
    }) as { content: unknown[] });

    expect((result as any).acquired).toBe(false);
    expect((result as any).held_by).toBe("agent-lock-holder");

    const dms = readMessages({ to: "agent-lock-holder", unread_only: false });
    const conflictDm = dms.find(m => m.content.toLowerCase().includes("lock conflict"));
    expect(conflictDm).toBeTruthy();
    expect(conflictDm!.from_agent).toBe("agent-lock-requester");
  });

  test("no DM sent when auto_dm is false", async () => {
    await client.callTool({
      name: "acquire_lock",
      arguments: { resource_type: "channel", resource_id: "dm-test-room-2", from: "agent-nodm-holder" },
    });

    await client.callTool({
      name: "acquire_lock",
      arguments: { resource_type: "channel", resource_id: "dm-test-room-2", from: "agent-nodm-requester", auto_dm: false },
    });

    const dms = readMessages({ to: "agent-nodm-holder", unread_only: false });
    expect(dms).toHaveLength(0);
  });
});
