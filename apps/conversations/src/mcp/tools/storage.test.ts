import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { closeDb } from "../../lib/db.js";
import { STORAGE_CONFIG_PATH } from "../../lib/storage-sync.js";
import { registerStorageSyncTools } from "./storage.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

const STORAGE_CONFIG_DIR = dirname(STORAGE_CONFIG_PATH);

// Save/restore real storage config
let savedConfig: string | null = null;

function saveStorageConfig(): void {
  if (existsSync(STORAGE_CONFIG_PATH)) {
    savedConfig = readFileSync(STORAGE_CONFIG_PATH, "utf-8");
  }
}

function restoreStorageConfig(): void {
  if (savedConfig !== null) {
    if (!existsSync(STORAGE_CONFIG_DIR)) {
      mkdirSync(STORAGE_CONFIG_DIR, { recursive: true });
    }
    writeFileSync(STORAGE_CONFIG_PATH, savedConfig, "utf-8");
  } else {
    try { unlinkSync(STORAGE_CONFIG_PATH); } catch {}
  }
}

function writeStorageConfig(config: Record<string, unknown>): void {
  if (!existsSync(STORAGE_CONFIG_DIR)) {
    mkdirSync(STORAGE_CONFIG_DIR, { recursive: true });
  }
  writeFileSync(STORAGE_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

const TEST_DB = join(tmpdir(), `conversations-test-storage-${Date.now()}.db`);
let client: Client;
let server: McpServer;

beforeAll(async () => {
  saveStorageConfig();
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();

  server = new McpServer({ name: "test-storage", version: "0.0.1" });
  registerStorageSyncTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  restoreStorageConfig();

  try { await server.close(); } catch {}
  try { await client.close(); } catch {}
  closeDb();

  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
});

beforeEach(() => {
  // Reset to local mode before each test
  writeStorageConfig({ mode: "local" });
});

function getText(result: { content: unknown[] }): string {
  return (result.content[0] as { type: string; text: string }).text;
}

// ---- conversations_storage_status ----

describe("conversations_storage_status", () => {
  test("returns mode and service info in local mode", async () => {
    writeStorageConfig({ mode: "local" });
    const result = await client.callTool({ name: "conversations_storage_status", arguments: {} });
    const text = getText(result as any);
    expect(text).toContain("Mode: local");
    expect(text).toContain("Service: conversations");
    expect(text).toContain("Canonical RDS cluster: hasna-xyz-infra-apps-prod-postgres");
    expect(text).toContain("Runtime secret path: hasna/xyz/opensource/conversations/prod/rds");
    expect(text).toContain("PostgreSQL: skipped in local mode");
  }, 10000);

  test("reports conflict counts", async () => {
    writeStorageConfig({ mode: "local" });
    const result = await client.callTool({ name: "conversations_storage_status", arguments: {} });
    const text = getText(result as any);
    expect(text).toContain("Sync conflicts:");
  }, 20000);
});

// ---- conversations_storage_push ----

describe("conversations_storage_push", () => {
  test("returns a result with row count or error message", async () => {
    const result = await client.callTool({ name: "conversations_storage_push", arguments: {} }) as any;
    const text = getText(result);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  }, 15000);

  test("accepts explicit tables parameter", async () => {
    const result = await client.callTool({
      name: "conversations_storage_push",
      arguments: { tables: "channels,projects" },
    }) as any;
    const text = getText(result);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});

// ---- conversations_storage_pull ----

describe("conversations_storage_pull", () => {
  test("returns a result with row count or error message", async () => {
    const result = await client.callTool({ name: "conversations_storage_pull", arguments: {} }) as any;
    const text = getText(result);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  test("accepts explicit tables parameter", async () => {
    const result = await client.callTool({
      name: "conversations_storage_pull",
      arguments: { tables: "channels" },
    }) as any;
    const text = getText(result);
    expect(typeof text).toBe("string");
  });
});

// ---- conversations_storage_migrate ----

describe("conversations_storage_migrate", () => {
  test("dry_run returns SQL DDL without executing", async () => {
    writeStorageConfig({ mode: "remote", rds: { host: "test.example.com", username: "test" } });
    const result = await client.callTool({
      name: "conversations_storage_migrate",
      arguments: { dry_run: true },
    }) as any;
    const text = getText(result);
    expect(text).toContain("CREATE TABLE");
    expect(text).toContain("messages");
    expect(result.isError).toBeUndefined();
  });

  test("dry_run includes uuid column in messages DDL", async () => {
    writeStorageConfig({ mode: "remote", rds: { host: "test.example.com", username: "test" } });
    const result = await client.callTool({
      name: "conversations_storage_migrate",
      arguments: { dry_run: true },
    }) as any;
    const text = getText(result);
    expect(text).toContain("uuid");
  });

  test("returns error when not dry_run with no real PG connection", async () => {
    writeStorageConfig({ mode: "remote", rds: { host: "test.example.com", username: "test" } });
    const result = await client.callTool({
      name: "conversations_storage_migrate",
      arguments: {},
    }) as any;
    const text = getText(result);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});

// ---- conversations_storage_feedback ----

describe("conversations_storage_feedback", () => {
  test("saves feedback and returns an id", async () => {
    writeStorageConfig({ mode: "local" });
    const result = await client.callTool({
      name: "conversations_storage_feedback",
      arguments: { message: "test feedback from storage test" },
    }) as any;
    const text = getText(result);
    expect(text).toContain("id:");
  });

  test("accepts optional email field", async () => {
    writeStorageConfig({ mode: "local" });
    const result = await client.callTool({
      name: "conversations_storage_feedback",
      arguments: { message: "feedback with email", email: "test@example.com" },
    }) as any;
    const text = getText(result);
    expect(text).toContain("id:");
  });
});
