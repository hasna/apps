import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb } from "./sessions-db.js";
import {
  CANONICAL_TERMINAL_RDS_CLUSTER,
  CANONICAL_TERMINAL_RDS_DATABASE,
  CANONICAL_TERMINAL_RDS_SECRET_PATH,
  STORAGE_TABLES,
  TERMINAL_STORAGE_ENV,
  TERMINAL_STORAGE_FALLBACK_ENV,
  TERMINAL_STORAGE_MODE_ENV,
  TERMINAL_STORAGE_MODE_FALLBACK_ENV,
  getCanonicalTerminalRdsConfig,
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  parseStorageTables,
  resolveTables,
} from "./storage.js";

const ENV_KEYS = [
  TERMINAL_STORAGE_ENV,
  TERMINAL_STORAGE_FALLBACK_ENV,
  TERMINAL_STORAGE_MODE_ENV,
  TERMINAL_STORAGE_MODE_FALLBACK_ENV,
  "HASNA_TERMINAL_DB_PATH",
  "TERMINAL_DB_PATH",
] as const;

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("terminal storage config", () => {
  test("resolves canonical database env, fallback env, and storage mode", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(getStorageDatabaseEnv()).toBeNull();
    expect(getStorageDatabaseUrl()).toBeNull();
    expect(getStorageMode()).toBe("local");

    process.env[TERMINAL_STORAGE_FALLBACK_ENV] = "postgres://fallback/terminal";
    expect(getStorageDatabaseEnv()?.name).toBe(TERMINAL_STORAGE_FALLBACK_ENV);
    expect(getStorageDatabaseUrl()).toBe("postgres://fallback/terminal");
    expect(getStorageMode()).toBe("hybrid");

    process.env[TERMINAL_STORAGE_ENV] = "postgres://primary/terminal";
    expect(getStorageDatabaseEnv()?.name).toBe(TERMINAL_STORAGE_ENV);
    expect(getStorageDatabaseUrl()).toBe("postgres://primary/terminal");

    process.env[TERMINAL_STORAGE_MODE_ENV] = "remote";
    expect(getStorageMode()).toBe("remote");

    process.env[TERMINAL_STORAGE_MODE_ENV] = "invalid";
    process.env[TERMINAL_STORAGE_MODE_FALLBACK_ENV] = "local";
    expect(getStorageMode()).toBe("local");
  });

  test("exposes and validates storage tables", () => {
    expect(STORAGE_TABLES).toEqual(["sessions", "interactions", "corrections", "outputs", "feedback"]);
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("sessions,feedback")).toEqual(["sessions", "feedback"]);
    expect(() => resolveTables(["missing"])).toThrow("Unknown terminal storage table");
  });

  test("exposes canonical RDS metadata without secrets", () => {
    expect(getCanonicalTerminalRdsConfig()).toEqual({
      cluster: CANONICAL_TERMINAL_RDS_CLUSTER,
      database: CANONICAL_TERMINAL_RDS_DATABASE,
      runtimeSecretPath: CANONICAL_TERMINAL_RDS_SECRET_PATH,
      primaryEnv: TERMINAL_STORAGE_ENV,
      fallbackEnv: TERMINAL_STORAGE_FALLBACK_ENV,
    });
  });

  test("storage status initializes local sync metadata without remote config", () => {
    const dir = mkdtempSync(join(tmpdir(), "terminal-storage-"));
    const dbPath = join(dir, "sessions.db");
    process.env.HASNA_TERMINAL_DB_PATH = dbPath;

    try {
      const status = getStorageStatus();
      expect(status).toMatchObject({
        configured: false,
        mode: "local",
        service: "terminal",
        activeEnv: null,
        canonical: getCanonicalTerminalRdsConfig(),
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
