import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb } from "../src/db.js";
import {
  STATIONS_STORAGE_ENV,
  STATIONS_STORAGE_FALLBACK_ENV,
  STATIONS_STORAGE_MODE_ENV,
  STATIONS_STORAGE_MODE_FALLBACK_ENV,
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
  STATIONS_DATABASE_ALLOW_INSECURE_TLS_ENV,
  STATIONS_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV,
  sslConfigFor,
} from "../src/remote-storage.js";

const ENV_KEYS = [
  STATIONS_STORAGE_ENV,
  STATIONS_STORAGE_FALLBACK_ENV,
  STATIONS_STORAGE_MODE_ENV,
  STATIONS_STORAGE_MODE_FALLBACK_ENV,
  STATIONS_DATABASE_ALLOW_INSECURE_TLS_ENV,
  STATIONS_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV,
  "HASNA_STATIONS_DB_PATH",
] as const;

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("stations storage config", () => {
  test("resolves canonical database env and fallback env; storage mode is never env-selected", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(getStorageDatabaseEnv()).toBeNull();
    expect(getStorageDatabaseUrl()).toBeNull();
    expect(getStorageMode()).toBe("local");

    // A DSN in the environment is a pointer, not a mode: it never flips the
    // resolved mode by presence (that inference was the deployment-mode axis).
    process.env[STATIONS_STORAGE_FALLBACK_ENV] = "postgres://fallback/stations";
    expect(getStorageDatabaseEnv()?.name).toBe(STATIONS_STORAGE_FALLBACK_ENV);
    expect(getStorageDatabaseUrl()).toBe("postgres://fallback/stations");
    expect(getStorageMode()).toBe("local");

    process.env[STATIONS_STORAGE_ENV] = "postgres://primary/stations";
    expect(getStorageDatabaseEnv()?.name).toBe(STATIONS_STORAGE_ENV);
    expect(getStorageDatabaseUrl()).toBe("postgres://primary/stations");

    // A set storage-mode variable is an error, never a mode selector —
    // whatever its value (deployment modes were removed, owner directive
    // 2026-07-29).
    process.env[STATIONS_STORAGE_MODE_ENV] = "cloud";
    expect(() => getStorageMode()).toThrow(STATIONS_STORAGE_MODE_ENV);
  });

  test("any storage-mode variable value throws, naming the variable", () => {
    // Deployment modes were removed (owner directive 2026-07-29). A silent
    // fallback here flips which store a process reads — always fail loudly,
    // whatever the value (the retired deployment words, junk, or local/cloud).
    for (const value of ["remote", "hybrid", "self_hosted", "invalid", "cloud", "local"]) {
      process.env[STATIONS_STORAGE_MODE_ENV] = value;
      expect(() => getStorageMode()).toThrow(STATIONS_STORAGE_MODE_ENV);
    }
    delete process.env[STATIONS_STORAGE_MODE_ENV];
    process.env[STATIONS_STORAGE_MODE_FALLBACK_ENV] = "hybrid";
    expect(() => getStorageMode()).toThrow(STATIONS_STORAGE_MODE_FALLBACK_ENV);
  });

  test("exposes and validates storage tables", () => {
    expect(STORAGE_TABLES).toEqual(["agent_heartbeats", "setup_runs", "sync_runs"]);
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("agent_heartbeats,sync_runs")).toEqual(["agent_heartbeats", "sync_runs"]);
    expect(() => resolveTables(["missing"])).toThrow("Unknown stations storage table");
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
    expect(sslConfigFor("postgres://example/stations", {})).toEqual({ rejectUnauthorized: true });
    expect(sslConfigFor("postgres://example/stations?sslmode=require", {})).toEqual({ rejectUnauthorized: true });
    expect(sslConfigFor("postgres://example/stations?sslmode=verify-full", {})).toEqual({ rejectUnauthorized: true });
    expect(sslConfigFor("postgres://example/stations?ssl=true", {})).toEqual({ rejectUnauthorized: true });
  });

  test("postgres remote storage rejects insecure TLS modes", () => {
    expect(() => sslConfigFor("postgres://example/stations?sslmode=no-verify", {})).toThrow(
      "PostgreSQL TLS certificate verification cannot be disabled",
    );
    expect(() => sslConfigFor("postgres://example/stations?sslmode=disable", {})).toThrow(
      "Insecure PostgreSQL TLS mode is rejected",
    );
    expect(() => sslConfigFor("postgres://example/stations?ssl=false", {})).toThrow(
      "Insecure PostgreSQL TLS mode is rejected",
    );
    expect(() => sslConfigFor("postgres://example/stations", { [STATIONS_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV]: "0" })).toThrow(
      "PostgreSQL TLS certificate verification cannot be disabled",
    );
    expect(() =>
      sslConfigFor("postgres://example/stations?sslmode=no-verify", { [STATIONS_DATABASE_ALLOW_INSECURE_TLS_ENV]: "1" })
    ).toThrow("PostgreSQL TLS certificate verification cannot be disabled");
  });

  test("postgres loopback storage only permits insecure TLS with explicit local override", () => {
    expect(sslConfigFor("postgres://127.0.0.1/stations", {})).toBeUndefined();
    expect(sslConfigFor("postgres://localhost/stations", {})).toBeUndefined();
    expect(sslConfigFor("postgres://[::1]/stations", {})).toBeUndefined();

    expect(() => sslConfigFor("postgres://127.0.0.1/stations?sslmode=disable", {})).toThrow(
      "Insecure PostgreSQL TLS mode is rejected",
    );
    expect(() => sslConfigFor("postgres://localhost/stations?sslmode=no-verify", {})).toThrow(
      "PostgreSQL TLS certificate verification cannot be disabled",
    );

    const allowLocalInsecure = { [STATIONS_DATABASE_ALLOW_INSECURE_TLS_ENV]: "1" };
    expect(sslConfigFor("postgres://127.0.0.1/stations?sslmode=disable", allowLocalInsecure)).toBeUndefined();
    expect(sslConfigFor("postgres://localhost/stations?ssl=false", allowLocalInsecure)).toBeUndefined();
    expect(sslConfigFor("postgres://[::1]/stations?sslmode=no-verify", allowLocalInsecure)).toEqual({ rejectUnauthorized: false });
    expect(sslConfigFor("postgres://127.0.0.1/stations", {
      [STATIONS_DATABASE_ALLOW_INSECURE_TLS_ENV]: "true",
      [STATIONS_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV]: "0",
    })).toEqual({ rejectUnauthorized: false });
  });

  test("postgres ssl config ignores invalid database URLs", () => {
    expect(sslConfigFor("not a url", {})).toBeUndefined();
  });

  test("storage status initializes local sync metadata without remote config", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-storage-"));
    const dbPath = join(dir, "stations.db");
    process.env.HASNA_STATIONS_DB_PATH = dbPath;

    try {
      const status = getStorageStatus();
      expect(status).toMatchObject({
        configured: false,
        mode: "local",
        service: "stations",
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
