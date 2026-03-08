import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "./index.js";
import { closeDb } from "../lib/db.js";
import { sendMessage, readMessages } from "../lib/messages.js";
import { createSpace } from "../lib/spaces.js";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-mcp-${Date.now()}.db`);
let client: Client;

beforeAll(async () => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  delete process.env.CONVERSATIONS_AGENT_ID;
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

  test("falls back to 'user' when from is omitted and no env var", async () => {
    const result = await client.callTool({
      name: "send_message",
      arguments: { to: "someone", content: "no from" },
    });
    const msg = parseResult(result as any) as any;
    expect(msg.from_agent).toBe("user");
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

  test("falls back to 'user' when from is omitted", async () => {
    const sent = sendMessage({ from: "alice", to: "user", content: "hey user" });
    const result = await client.callTool({
      name: "reply",
      arguments: { message_id: sent.id, content: "reply without from" },
    });
    const msg = parseResult(result as any) as any;
    expect(msg.from_agent).toBe("user");
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

  test("falls back to 'user' when from is omitted", async () => {
    const sent = sendMessage({ from: "alice", to: "user", content: "for user" });
    const result = await client.callTool({
      name: "mark_read",
      arguments: { ids: [sent.id] },
    });
    const data = parseResult(result as any) as any;
    expect(data.marked_read).toBe(1);
  });
});

// ---- create_space ----

describe("create_space from parameter", () => {
  test("creates space with explicit creator", async () => {
    const result = await client.callTool({
      name: "create_space",
      arguments: { from: "space-creator", name: "test-space-from" },
    });
    const sp = parseResult(result as any) as any;
    expect(sp.name).toBe("test-space-from");
    expect(sp.created_by).toBe("space-creator");
  });

  test("falls back to 'user' when from is omitted", async () => {
    const result = await client.callTool({
      name: "create_space",
      arguments: { name: "test-space-no-from" },
    });
    const sp = parseResult(result as any) as any;
    expect(sp.created_by).toBe("user");
  });
});

// ---- send_to_space ----

describe("send_to_space from parameter", () => {
  test("sends to space with explicit from", async () => {
    createSpace("msg-space", "creator");
    const result = await client.callTool({
      name: "send_to_space",
      arguments: { from: "space-sender", space: "msg-space", content: "hello space" },
    });
    const msg = parseResult(result as any) as any;
    expect(msg.from_agent).toBe("space-sender");
    expect(msg.space).toBe("msg-space");
  });

  test("falls back to 'user' when from is omitted", async () => {
    createSpace("msg-space-2", "creator");
    const result = await client.callTool({
      name: "send_to_space",
      arguments: { space: "msg-space-2", content: "no from" },
    });
    const msg = parseResult(result as any) as any;
    expect(msg.from_agent).toBe("user");
  });
});

// ---- join_space ----

describe("join_space from parameter", () => {
  test("joins space with explicit from", async () => {
    createSpace("join-space", "creator");
    const result = await client.callTool({
      name: "join_space",
      arguments: { from: "joiner-agent", space: "join-space" },
    });
    const data = parseResult(result as any) as any;
    expect(data.agent).toBe("joiner-agent");
    expect(data.joined).toBe(true);
  });

  test("falls back to 'user' when from is omitted", async () => {
    createSpace("join-space-2", "creator");
    const result = await client.callTool({
      name: "join_space",
      arguments: { space: "join-space-2" },
    });
    const data = parseResult(result as any) as any;
    expect(data.agent).toBe("user");
  });
});

// ---- leave_space ----

describe("leave_space from parameter", () => {
  test("leaves space with explicit from", async () => {
    createSpace("leave-space", "leaver-agent");
    const result = await client.callTool({
      name: "leave_space",
      arguments: { from: "leaver-agent", space: "leave-space" },
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

  test("falls back to 'user' when from is omitted", async () => {
    const result = await client.callTool({
      name: "create_project",
      arguments: { name: "test-project-no-from" },
    });
    const proj = parseResult(result as any) as any;
    expect(proj.created_by).toBe("user");
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

  test("falls back to 'user' when from is omitted", async () => {
    const result = await client.callTool({
      name: "heartbeat",
      arguments: {},
    });
    const data = parseResult(result as any) as any;
    expect(data.agent).toBe("user");
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
    const msgs = parseResult(result as any) as any[];
    expect(msgs.length).toBeGreaterThan(0);
  });

  test("list_sessions returns sessions", async () => {
    const result = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    const sessions = parseResult(result as any) as any[];
    expect(Array.isArray(sessions)).toBe(true);
  });

  test("list_spaces returns spaces", async () => {
    const result = await client.callTool({
      name: "list_spaces",
      arguments: {},
    });
    const spaces = parseResult(result as any) as any[];
    expect(Array.isArray(spaces)).toBe(true);
  });

  test("list_projects returns projects", async () => {
    const result = await client.callTool({
      name: "list_projects",
      arguments: {},
    });
    const projects = parseResult(result as any) as any[];
    expect(Array.isArray(projects)).toBe(true);
  });

  test("list_agents returns agents", async () => {
    const result = await client.callTool({
      name: "list_agents",
      arguments: {},
    });
    const agents = parseResult(result as any) as any[];
    expect(Array.isArray(agents)).toBe(true);
  });
});
