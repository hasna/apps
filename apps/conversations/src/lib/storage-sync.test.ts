import { afterEach, describe, expect, it } from "bun:test";
import {
  ALL_STORAGE_TABLES,
  CANONICAL_CONVERSATIONS_DATABASE_ENV,
  CANONICAL_CONVERSATIONS_RDS_CLUSTER,
  CANONICAL_CONVERSATIONS_RDS_DATABASE,
  CANONICAL_CONVERSATIONS_RDS_SECRET_PATH,
  CONVERSATIONS_DATABASE_FALLBACK_ENV,
  DEFAULT_STORAGE_TABLES,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  ensureConflictsTable,
  getCanonicalConversationsRdsConfig,
  getStorageConfig,
  getStorageDatabaseUrl,
  listConflicts,
  resolveTables,
} from "./storage-sync.js";
import { ConversationsDatabase } from "./db.js";

const ENV_NAMES = [
  ...STORAGE_DATABASE_ENV,
  ...STORAGE_MODE_ENV,
  ["HASNA", "CONVERSATIONS", "CLOUD", "DATABASE", "URL"].join("_"),
  ["OPEN", "CONVERSATIONS", "CLOUD", "DATABASE", "URL"].join("_"),
  ["CONVERSATIONS", "CLOUD", "DATABASE", "URL"].join("_"),
  ["HASNA", "CONVERSATIONS", "CLOUD", "MODE"].join("_"),
  ["OPEN", "CONVERSATIONS", "CLOUD", "MODE"].join("_"),
  ["CONVERSATIONS", "CLOUD", "MODE"].join("_"),
] as const;

afterEach(() => {
  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
});

describe("conversations storage configuration", () => {
  it("exposes the canonical Hasna XYZ RDS descriptor without secret values", () => {
    expect(getCanonicalConversationsRdsConfig()).toEqual({
      cluster: CANONICAL_CONVERSATIONS_RDS_CLUSTER,
      database: CANONICAL_CONVERSATIONS_RDS_DATABASE,
      runtimeSecretPath: CANONICAL_CONVERSATIONS_RDS_SECRET_PATH,
      env: CANONICAL_CONVERSATIONS_DATABASE_ENV,
      fallbackEnv: CONVERSATIONS_DATABASE_FALLBACK_ENV,
    });
    expect(STORAGE_DATABASE_ENV).toEqual([
      "HASNA_CONVERSATIONS_DATABASE_URL",
      "CONVERSATIONS_DATABASE_URL",
    ]);
  });

  it("uses canonical storage database envs", () => {
    process.env["HASNA_CONVERSATIONS_DATABASE_URL"] = "postgres://new.example/conversations";

    expect(getStorageDatabaseUrl()).toBe("postgres://new.example/conversations");
  });

  it("does not treat retired cloud database envs as storage config", () => {
    process.env["HASNA_CONVERSATIONS_STORAGE_MODE"] = "local";
    process.env[["OPEN", "CONVERSATIONS", "CLOUD", "DATABASE", "URL"].join("_")] = "postgres://old.example/conversations";

    expect(getStorageDatabaseUrl()).toBeNull();
  });

  it("uses canonical storage mode envs", () => {
    process.env["HASNA_CONVERSATIONS_STORAGE_MODE"] = "hybrid";

    expect(getStorageConfig().mode).toBe("hybrid");
  });

  it("does not map retired cloud modes to storage modes", () => {
    process.env["CONVERSATIONS_STORAGE_MODE"] = "local";
    process.env[["HASNA", "CONVERSATIONS", "CLOUD", "MODE"].join("_")] = "remote";

    expect(getStorageConfig().mode).toBe("local");
  });

  it("returns default storage tables and rejects unsupported tables", () => {
    expect(resolveTables()).toEqual([...ALL_STORAGE_TABLES]);
    expect(resolveTables()).toEqual([...DEFAULT_STORAGE_TABLES, "messages", "message_read_receipts"]);
    expect(resolveTables("messages,message_read_receipts")).toEqual(["messages", "message_read_receipts"]);
    expect(() => resolveTables("channels,missing")).toThrow("Unsupported conversations storage table");
  });

  it("exports storage helpers from the storage subpath source", async () => {
    const storage = await import("../storage.js");

    expect(storage.DEFAULT_STORAGE_TABLES).toEqual(DEFAULT_STORAGE_TABLES);
    expect(storage.getStorageDatabaseUrl()).toBeNull();
    expect(storage.PG_MIGRATIONS.length).toBeGreaterThan(0);
    expect(typeof storage.PgAdapterAsync).toBe("function");
  });

  it("migrates legacy conflict tables before listing conflicts", () => {
    const db = new ConversationsDatabase(":memory:");
    try {
      db.exec(`
        CREATE TABLE _sync_conflicts (
          id TEXT PRIMARY KEY,
          table_name TEXT NOT NULL,
          pk TEXT NOT NULL,
          local_row TEXT NOT NULL,
          remote_row TEXT NOT NULL
        )
      `);
      db.prepare(`
        INSERT INTO _sync_conflicts (id, table_name, pk, local_row, remote_row)
        VALUES (?, ?, ?, ?, ?)
      `).run("conflict-1", "channels", "general", "{}", "{}");

      ensureConflictsTable(db);

      expect(listConflicts(db, { resolved: false })).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
