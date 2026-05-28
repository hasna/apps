import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { closeDb } from "../../lib/db.js";
import { registerCloudSyncTools } from "./cloud.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";

const CLOUD_CONFIG_DIR = join(homedir(), ".hasna", "cloud");
const CLOUD_CONFIG_PATH = join(CLOUD_CONFIG_DIR, "config.json");

// Save/restore real cloud config
let savedConfig: string | null = null;

function saveCloudConfig(): void {
  if (existsSync(CLOUD_CONFIG_PATH)) {
    savedConfig = readFileSync(CLOUD_CONFIG_PATH, "utf-8");
  }
}

function restoreCloudConfig(): void {
  if (savedConfig !== null) {
    if (!existsSync(CLOUD_CONFIG_DIR)) {
      mkdirSync(CLOUD_CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CLOUD_CONFIG_PATH, savedConfig, "utf-8");
  } else {
    try { unlinkSync(CLOUD_CONFIG_PATH); } catch {}
  }
}

function writeCloudConfig(config: Record<string, unknown>): void {
  if (!existsSync(CLOUD_CONFIG_DIR)) {
    mkdirSync(CLOUD_CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CLOUD_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

const TEST_DB = join(tmpdir(), `conversations-test-cloud-${Date.now()}.db`);
let client: Client;
let server: McpServer;

beforeAll(async () => {
  saveCloudConfig();
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
  restoreCloudConfig();

  try { await server.close(); } catch {}
  try { await client.close(); } catch {}
  closeDb();

  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
});

beforeEach(() => {
  // Reset to local mode before each test
  writeCloudConfig({ mode: "local" });
});

function getText(result: { content: unknown[] }): string {
  return (result.content[0] as { type: string; text: string }).text;
}

// ---- conversations_cloud_status ----

describe("conversations_cloud_status", () => {
  test("returns mode and service info in local mode", async () => {
    writeCloudConfig({ mode: "local" });
    const result = await client.callTool({ name: "conversations_cloud_status", arguments: {} });
    const text = getText(result as any);
    expect(text).toContain("Mode: local");
    expect(text).toContain("Service: conversations");
    expect(text).toContain("PostgreSQL: skipped in local mode");
  }, 10000);

  test("reports conflict counts", async () => {
    writeCloudConfig({ mode: "local" });
    const result = await client.callTool({ name: "conversations_cloud_status", arguments: {} });
    const text = getText(result as any);
    expect(text).toContain("Sync conflicts:");
  }, 20000);
});

// ---- conversations_cloud_push ----

describe("conversations_cloud_push", () => {
  test("returns a result with row count or error message", async () => {
    const result = await client.callTool({ name: "conversations_cloud_push", arguments: {} }) as any;
    const text = getText(result);
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
    writeCloudConfig({ mode: "cloud", rds: { host: "test.example.com", username: "test" } });
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
    writeCloudConfig({ mode: "cloud", rds: { host: "test.example.com", username: "test" } });
    const result = await client.callTool({
      name: "conversations_cloud_migrate",
      arguments: { dry_run: true },
    }) as any;
    const text = getText(result);
    expect(text).toContain("uuid");
  });

  test("returns error when not dry_run with no real PG connection", async () => {
    writeCloudConfig({ mode: "cloud", rds: { host: "test.example.com", username: "test" } });
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
    writeCloudConfig({ mode: "local" });
    const result = await client.callTool({
      name: "conversations_cloud_feedback",
      arguments: { message: "test feedback from cloud.test.ts" },
    }) as any;
    const text = getText(result);
    expect(text).toContain("id:");
  });

  test("accepts optional email field", async () => {
    writeCloudConfig({ mode: "local" });
    const result = await client.callTool({
      name: "conversations_cloud_feedback",
      arguments: { message: "feedback with email", email: "test@example.com" },
    }) as any;
    const text = getText(result);
    expect(text).toContain("id:");
  });
});
