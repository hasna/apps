import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb } from "../src/db.js";
import {
  MACHINES_STORAGE_ENV,
  MACHINES_STORAGE_FALLBACK_ENV,
  MACHINES_STORAGE_MODE_ENV,
  MACHINES_STORAGE_MODE_FALLBACK_ENV,
  STORAGE_TABLES,
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  parseStorageTables,
  resolveTables,
} from "../src/storage.js";

const ENV_KEYS = [
  MACHINES_STORAGE_ENV,
  MACHINES_STORAGE_FALLBACK_ENV,
  MACHINES_STORAGE_MODE_ENV,
  MACHINES_STORAGE_MODE_FALLBACK_ENV,
  "HASNA_MACHINES_DB_PATH",
] as const;

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("machines storage config", () => {
  test("resolves canonical database env, fallback env, and storage mode", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(getStorageDatabaseEnv()).toBeNull();
    expect(getStorageDatabaseUrl()).toBeNull();
    expect(getStorageMode()).toBe("local");

    process.env[MACHINES_STORAGE_FALLBACK_ENV] = "postgres://fallback/machines";
    expect(getStorageDatabaseEnv()?.name).toBe(MACHINES_STORAGE_FALLBACK_ENV);
    expect(getStorageDatabaseUrl()).toBe("postgres://fallback/machines");
    expect(getStorageMode()).toBe("hybrid");

    process.env[MACHINES_STORAGE_ENV] = "postgres://primary/machines";
    expect(getStorageDatabaseEnv()?.name).toBe(MACHINES_STORAGE_ENV);
    expect(getStorageDatabaseUrl()).toBe("postgres://primary/machines");

    process.env[MACHINES_STORAGE_MODE_ENV] = "remote";
    expect(getStorageMode()).toBe("remote");

    process.env[MACHINES_STORAGE_MODE_ENV] = "invalid";
    process.env[MACHINES_STORAGE_MODE_FALLBACK_ENV] = "local";
    expect(getStorageMode()).toBe("local");
  });

  test("exposes and validates storage tables", () => {
    expect(STORAGE_TABLES).toEqual(["agent_heartbeats", "setup_runs", "sync_runs"]);
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("agent_heartbeats,sync_runs")).toEqual(["agent_heartbeats", "sync_runs"]);
    expect(() => resolveTables(["missing"])).toThrow("Unknown machines storage table");
  });

  test("storage status initializes local sync metadata without remote config", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-storage-"));
    const dbPath = join(dir, "machines.db");
    process.env.HASNA_MACHINES_DB_PATH = dbPath;

    try {
      const status = getStorageStatus();
      expect(status).toMatchObject({
        configured: false,
        mode: "local",
        service: "machines",
        activeEnv: null,
        sync: [],
      });
      expect(status.tables).toEqual(STORAGE_TABLES);
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
