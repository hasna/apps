import { afterEach, describe, expect, it } from "bun:test";
import "./setup";
import {
  buildPostgresPoolConfig,
  collectStorageSyncErrors,
  getRemoteDatabaseUrl,
  getStorageSyncStatus,
  resolveStorageSyncTables,
  shouldUsePostgresSsl,
} from "../src/lib/storage-sync";
import { closeDb } from "../src/lib/db";

const originalPrimary = process.env["HASNA_MCPS_DATABASE_URL"];
const originalFallback = process.env["MCPS_DATABASE_URL"];
const originalPgSslMode = process.env["PGSSLMODE"];

afterEach(() => {
  if (originalPrimary === undefined) delete process.env["HASNA_MCPS_DATABASE_URL"];
  else process.env["HASNA_MCPS_DATABASE_URL"] = originalPrimary;
  if (originalFallback === undefined) delete process.env["MCPS_DATABASE_URL"];
  else process.env["MCPS_DATABASE_URL"] = originalFallback;
  if (originalPgSslMode === undefined) delete process.env["PGSSLMODE"];
  else process.env["PGSSLMODE"] = originalPgSslMode;
  closeDb();
});

describe("storage sync", () => {
  it("uses only mcps-owned database URL variables", () => {
    delete process.env["HASNA_MCPS_DATABASE_URL"];
    delete process.env["MCPS_DATABASE_URL"];
    expect(getRemoteDatabaseUrl()).toBeNull();
    expect(getStorageSyncStatus()).toMatchObject({
      configured: false,
      env: {
        primary: "HASNA_MCPS_DATABASE_URL",
        fallback: "MCPS_DATABASE_URL",
        active: null,
      },
      semantics: {
        runtimeStorage: "local-sqlite",
        remoteRole: "optional-postgres-mirror",
        deletePropagation: false,
        conflictPolicy: "freshness-column-wins-or-preserve-existing",
      },
    });

    process.env["MCPS_DATABASE_URL"] = "postgres://fallback.example/db";
    expect(getRemoteDatabaseUrl()).toBe("postgres://fallback.example/db");
    expect(getStorageSyncStatus().env.active).toBe("MCPS_DATABASE_URL");

    process.env["HASNA_MCPS_DATABASE_URL"] = "postgres://primary.example/db";
    expect(getRemoteDatabaseUrl()).toBe("postgres://primary.example/db");
    expect(getStorageSyncStatus().env.active).toBe("HASNA_MCPS_DATABASE_URL");
  });

  it("ignores empty primary database URL values before using fallback", () => {
    process.env["HASNA_MCPS_DATABASE_URL"] = "  ";
    process.env["MCPS_DATABASE_URL"] = "postgres://fallback.example/db";
    expect(getRemoteDatabaseUrl()).toBe("postgres://fallback.example/db");
    expect(getStorageSyncStatus()).toMatchObject({
      configured: true,
      env: {
        active: "MCPS_DATABASE_URL",
      },
    });
  });

  it("parses explicit Postgres TLS query parameters without substring matches", () => {
    expect(shouldUsePostgresSsl("postgres://user:pass@host/db?sslmode=require")).toBe(true);
    expect(shouldUsePostgresSsl("postgres://user:pass@host/db?sslmode=verify-full")).toBe(true);
    expect(shouldUsePostgresSsl("postgres://user:pass@host/db?ssl=true")).toBe(true);
    expect(shouldUsePostgresSsl("postgres://user:pass@host/db?ssl=1")).toBe(true);
    expect(shouldUsePostgresSsl("postgres://user:sslmode=require@host/db")).toBe(false);
    expect(shouldUsePostgresSsl("postgres://user:pass@host/sslmode=require")).toBe(false);
    expect(shouldUsePostgresSsl("postgres://user:pass@host/db?ssl=false")).toBe(false);
    expect(shouldUsePostgresSsl("postgres://user:pass@host/db?sslmode=disable")).toBe(false);
    expect(shouldUsePostgresSsl("postgres://user:pass@host/db?sslmode=prefer")).toBe(false);
  });

  it("builds a concrete Postgres pool config without disabling TLS verification", () => {
    expect(buildPostgresPoolConfig("postgres://user:pass@host/db?sslmode=require")).toEqual({
      connectionString: "postgres://user:pass@host/db",
      ssl: true,
    });
    expect(buildPostgresPoolConfig("postgres://user:pass@host/db?sslmode=verify-full")).toEqual({
      connectionString: "postgres://user:pass@host/db",
      ssl: true,
    });
    expect(buildPostgresPoolConfig("postgres://user:pass@host/db?sslmode=require&application_name=mcps")).toEqual({
      connectionString: "postgres://user:pass@host/db?application_name=mcps",
      ssl: true,
    });
    expect(buildPostgresPoolConfig("postgres://user:pass@host/db?sslmode=disable")).toEqual({
      connectionString: "postgres://user:pass@host/db",
      ssl: false,
    });
    expect(buildPostgresPoolConfig("postgres://user:pass@host/db")).toEqual({
      connectionString: "postgres://user:pass@host/db",
      ssl: false,
    });
    expect(() => buildPostgresPoolConfig("postgres://user:pass@host/db?sslmode=no-verify")).toThrow(
      "Unsupported insecure PostgreSQL TLS verification mode",
    );
    expect(() => buildPostgresPoolConfig("postgres://user:pass@host/db?ssl=no-verify")).toThrow(
      "Unsupported insecure PostgreSQL TLS verification mode",
    );
    expect(() => buildPostgresPoolConfig("postgres://user:pass@host/db?uselibpqcompat=true&sslmode=require")).toThrow(
      "Unsupported libpq-compatible PostgreSQL TLS mode without certificate verification",
    );
    expect(() => buildPostgresPoolConfig("postgres://user:pass@host/db?uselibpqcompat=1&sslmode=prefer")).toThrow(
      "Unsupported libpq-compatible PostgreSQL TLS mode without certificate verification",
    );
    process.env["PGSSLMODE"] = "no-verify";
    expect(() => buildPostgresPoolConfig("postgres://user:pass@host/db")).toThrow(
      "Unsupported insecure ambient PGSSLMODE=no-verify",
    );
  });

  it("validates the explicit table allowlist", () => {
    expect(resolveStorageSyncTables(["servers", "sources"])).toEqual(["servers", "sources"]);
    expect(() => resolveStorageSyncTables(["servers", "unknown"])).toThrow("Unknown mcps storage table(s): unknown");
  });

  it("collects per-table sync errors for CLI and MCP callers", () => {
    expect(collectStorageSyncErrors([
      { table: "servers", rowsRead: 1, rowsWritten: 0, errors: ["boom"] },
      { table: "sources", rowsRead: 1, rowsWritten: 1, errors: [] },
    ])).toEqual(["servers: boom"]);
    expect(collectStorageSyncErrors({
      push: [{ table: "servers", rowsRead: 1, rowsWritten: 0, errors: ["push failed"] }],
      pull: [{ table: "sources", rowsRead: 1, rowsWritten: 0, errors: ["pull failed"] }],
    })).toEqual(["servers: push failed", "sources: pull failed"]);
  });
});
