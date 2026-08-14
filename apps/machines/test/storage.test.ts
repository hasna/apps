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
  PG_MIGRATIONS,
} from "../src/storage.js";
import {
  MACHINES_DATABASE_ALLOW_INSECURE_TLS_ENV,
  MACHINES_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV,
  sslConfigFor,
} from "../src/remote-storage.js";

const ENV_KEYS = [
  MACHINES_STORAGE_ENV,
  MACHINES_STORAGE_FALLBACK_ENV,
  MACHINES_STORAGE_MODE_ENV,
  MACHINES_STORAGE_MODE_FALLBACK_ENV,
  MACHINES_DATABASE_ALLOW_INSECURE_TLS_ENV,
  MACHINES_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV,
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

    // A DSN in the environment is a pointer, not a mode: it never flips the
    // resolved mode by presence (that inference was the deployment-mode axis).
    process.env[MACHINES_STORAGE_FALLBACK_ENV] = "postgres://fallback/machines";
    expect(getStorageDatabaseEnv()?.name).toBe(MACHINES_STORAGE_FALLBACK_ENV);
    expect(getStorageDatabaseUrl()).toBe("postgres://fallback/machines");
    expect(getStorageMode()).toBe("local");

    process.env[MACHINES_STORAGE_ENV] = "postgres://primary/machines";
    expect(getStorageDatabaseEnv()?.name).toBe(MACHINES_STORAGE_ENV);
    expect(getStorageDatabaseUrl()).toBe("postgres://primary/machines");

    process.env[MACHINES_STORAGE_MODE_ENV] = "cloud";
    expect(getStorageMode()).toBe("cloud");
  });

  test("retired deployment-mode words and junk values throw, naming the variable", () => {
    // Deployment modes were removed (owner directive 2026-07-29). A silent
    // fallback here flips which store a process reads — always fail loudly.
    for (const value of ["remote", "hybrid", "self_hosted", "invalid"]) {
      process.env[MACHINES_STORAGE_MODE_ENV] = value;
      expect(() => getStorageMode()).toThrow(MACHINES_STORAGE_MODE_ENV);
    }
    delete process.env[MACHINES_STORAGE_MODE_ENV];
    process.env[MACHINES_STORAGE_MODE_FALLBACK_ENV] = "hybrid";
    expect(() => getStorageMode()).toThrow(MACHINES_STORAGE_MODE_FALLBACK_ENV);
  });

  test("exposes and validates storage tables", () => {
    expect(STORAGE_TABLES).toEqual(["agent_heartbeats", "setup_runs", "sync_runs"]);
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("agent_heartbeats,sync_runs")).toEqual(["agent_heartbeats", "sync_runs"]);
    expect(() => resolveTables(["missing"])).toThrow("Unknown machines storage table");
  });

  test("postgres migrations add heartbeat enrichment columns compatibly", () => {
    const migrationSql = PG_MIGRATIONS.join("\n");
    expect(migrationSql).toContain("ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS daemon_version TEXT");
    expect(migrationSql).toContain("ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS tool_versions_json TEXT");
    expect(migrationSql).toContain("ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS tailscale_json TEXT");
    expect(migrationSql).toContain("ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS doctor_summary_json TEXT");
    expect(migrationSql).toContain("ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS private_metadata INTEGER NOT NULL DEFAULT 0");
    expect(migrationSql).toContain("ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ");
  });

  test("postgres remote storage verifies TLS by default", () => {
    expect(sslConfigFor("postgres://example/machines", {})).toEqual({ rejectUnauthorized: true });
    expect(sslConfigFor("postgres://example/machines?sslmode=require", {})).toEqual({ rejectUnauthorized: true });
    expect(sslConfigFor("postgres://example/machines?sslmode=verify-full", {})).toEqual({ rejectUnauthorized: true });
    expect(sslConfigFor("postgres://example/machines?ssl=true", {})).toEqual({ rejectUnauthorized: true });
  });

  test("postgres remote storage rejects insecure TLS modes", () => {
    expect(() => sslConfigFor("postgres://example/machines?sslmode=no-verify", {})).toThrow(
      "PostgreSQL TLS certificate verification cannot be disabled",
    );
    expect(() => sslConfigFor("postgres://example/machines?sslmode=disable", {})).toThrow(
      "Insecure PostgreSQL TLS mode is rejected",
    );
    expect(() => sslConfigFor("postgres://example/machines?ssl=false", {})).toThrow(
      "Insecure PostgreSQL TLS mode is rejected",
    );
    expect(() => sslConfigFor("postgres://example/machines", { [MACHINES_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV]: "0" })).toThrow(
      "PostgreSQL TLS certificate verification cannot be disabled",
    );
    expect(() =>
      sslConfigFor("postgres://example/machines?sslmode=no-verify", { [MACHINES_DATABASE_ALLOW_INSECURE_TLS_ENV]: "1" })
    ).toThrow("PostgreSQL TLS certificate verification cannot be disabled");
  });

  test("postgres loopback storage only permits insecure TLS with explicit local override", () => {
    expect(sslConfigFor("postgres://127.0.0.1/machines", {})).toBeUndefined();
    expect(sslConfigFor("postgres://localhost/machines", {})).toBeUndefined();
    expect(sslConfigFor("postgres://[::1]/machines", {})).toBeUndefined();

    expect(() => sslConfigFor("postgres://127.0.0.1/machines?sslmode=disable", {})).toThrow(
      "Insecure PostgreSQL TLS mode is rejected",
    );
    expect(() => sslConfigFor("postgres://localhost/machines?sslmode=no-verify", {})).toThrow(
      "PostgreSQL TLS certificate verification cannot be disabled",
    );

    const allowLocalInsecure = { [MACHINES_DATABASE_ALLOW_INSECURE_TLS_ENV]: "1" };
    expect(sslConfigFor("postgres://127.0.0.1/machines?sslmode=disable", allowLocalInsecure)).toBeUndefined();
    expect(sslConfigFor("postgres://localhost/machines?ssl=false", allowLocalInsecure)).toBeUndefined();
    expect(sslConfigFor("postgres://[::1]/machines?sslmode=no-verify", allowLocalInsecure)).toEqual({ rejectUnauthorized: false });
    expect(sslConfigFor("postgres://127.0.0.1/machines", {
      [MACHINES_DATABASE_ALLOW_INSECURE_TLS_ENV]: "true",
      [MACHINES_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV]: "0",
    })).toEqual({ rejectUnauthorized: false });
  });

  test("postgres ssl config ignores invalid database URLs", () => {
    expect(sslConfigFor("not a url", {})).toBeUndefined();
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
