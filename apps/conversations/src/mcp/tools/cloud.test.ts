import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { closeDb } from "../../lib/db.js";
import { registerCloudSyncTools } from "./cloud.js";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-cloud-${Date.now()}.db`);
let client: Client;
let server: McpServer;

beforeAll(async () => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();

  server = new McpServer({ name: "test-cloud", version: "0.0.1" });
  registerCloudSyncTools(server);

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

function getText(result: { content: unknown[] }): string {
  return (result.content[0] as { type: string; text: string }).text;
}

// ---- conversations_cloud_status ----

describe("conversations_cloud_status", () => {
  test("returns mode and service info", async () => {
    const result = await client.callTool({ name: "conversations_cloud_status", arguments: {} });
    const text = getText(result as any);
    expect(text).toContain("Mode:");
    expect(text).toContain("Service: conversations");
    expect(text).toContain("RDS Host:");
  });

  test("reports conflict counts", async () => {
    const result = await client.callTool({ name: "conversations_cloud_status", arguments: {} });
    const text = getText(result as any);
    expect(text).toContain("Sync conflicts:");
  });
});

// ---- conversations_cloud_push ----

describe("conversations_cloud_push", () => {
  test("returns a result with row count or error message", async () => {
    const result = await client.callTool({ name: "conversations_cloud_push", arguments: {} }) as any;
    const text = getText(result);
    // Either succeeds with row count, or fails with a meaningful error — never throws
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  }, 15000);

  test("accepts explicit tables parameter", async () => {
    const result = await client.callTool({
      name: "conversations_cloud_push",
      arguments: { tables: "spaces,projects" },
    }) as any;
    const text = getText(result);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});

// ---- conversations_cloud_pull ----

describe("conversations_cloud_pull", () => {
  test("returns a result with row count or error message", async () => {
    const result = await client.callTool({ name: "conversations_cloud_pull", arguments: {} }) as any;
    const text = getText(result);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  test("accepts explicit tables parameter", async () => {
    const result = await client.callTool({
      name: "conversations_cloud_pull",
      arguments: { tables: "spaces" },
    }) as any;
    const text = getText(result);
    expect(typeof text).toBe("string");
  });
});

// ---- conversations_cloud_migrate ----

describe("conversations_cloud_migrate", () => {
  test("dry_run returns SQL DDL without executing", async () => {
    const result = await client.callTool({
      name: "conversations_cloud_migrate",
      arguments: { dry_run: true },
    }) as any;
    const text = getText(result);
    expect(text).toContain("CREATE TABLE");
    expect(text).toContain("messages");
    expect(result.isError).toBeUndefined();
  });

  test("dry_run includes uuid column in messages DDL", async () => {
    const result = await client.callTool({
      name: "conversations_cloud_migrate",
      arguments: { dry_run: true },
    }) as any;
    const text = getText(result);
    expect(text).toContain("uuid");
  });

  test("returns result (success or auth error) when not dry_run", async () => {
    const result = await client.callTool({
      name: "conversations_cloud_migrate",
      arguments: {},
    }) as any;
    const text = getText(result);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});

// ---- conversations_cloud_feedback ----

describe("conversations_cloud_feedback", () => {
  test("saves feedback and returns an id", async () => {
    const result = await client.callTool({
      name: "conversations_cloud_feedback",
      arguments: { message: "test feedback from cloud.test.ts" },
    }) as any;
    const text = getText(result);
    expect(text).toContain("id:");
  });

  test("accepts optional email field", async () => {
    const result = await client.callTool({
      name: "conversations_cloud_feedback",
      arguments: { message: "feedback with email", email: "test@example.com" },
    }) as any;
    const text = getText(result);
    expect(text).toContain("id:");
  });
});
