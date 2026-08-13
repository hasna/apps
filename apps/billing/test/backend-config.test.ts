import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPostgresqlPoolConfig,
  createPostgresqlClient,
} from "../src/db/postgresql.js";
import { resolveStorageBackend, resolveDatabaseUrl } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";

const KEYS = [
  "HASNA_BILLING_STORAGE_MODE",
  "HASNA_BILLING_DATABASE_URL",
  "HASNA_BILLING_DATABASE_URL_FILE",
  "PGSSLROOTCERT",
];

function clearEnv(): void {
  for (const key of KEYS) delete process.env[key];
}

afterEach(clearEnv);

describe("server data-backend resolution", () => {
  it("defaults to sqlite and selects postgresql from a database URL", () => {
    expect(resolveStorageBackend({})).toBe("sqlite");
    expect(resolveStorageBackend({ HASNA_BILLING_DATABASE_URL: "postgresql://example.invalid/billing" })).toBe(
      "postgresql",
    );
  });

  it("selects postgresql from a mounted database URL file", () => {
    expect(resolveStorageBackend({ HASNA_BILLING_DATABASE_URL_FILE: "/run/secrets/database_url" })).toBe(
      "postgresql",
    );
  });

  it("rejects removed storage variables instead of normalizing them", () => {
    expect(() => resolveStorageBackend({ HASNA_BILLING_STORAGE_MODE: "cloud" })).toThrow(/removed/i);
  });

  it("resolves the URL only for connecting", () => {
    expect(resolveDatabaseUrl({ HASNA_BILLING_DATABASE_URL: "postgresql://example.invalid/billing" })).toBe(
      "postgresql://example.invalid/billing",
    );
    expect(resolveDatabaseUrl({})).toBeNull();
  });

  it("keeps PostgreSQL selected for the process lifetime", () => {
    const env = { HASNA_BILLING_DATABASE_URL: "postgresql://example.invalid/billing" };
    expect(resolveStorageBackend(env)).toBe("postgresql");
    expect(resolveStorageBackend(env)).toBe("postgresql");
  });
});

describe("PostgreSQL TLS — verify-full enforced without a live DB", () => {
  it("requires sslmode=verify-full", () => {
    process.env["HASNA_BILLING_DATABASE_URL"] = "postgresql://example.invalid/billing?sslmode=require";
    process.env["PGSSLROOTCERT"] = "/dev/null";
    expect(() => buildPostgresqlPoolConfig()).toThrow(/verify-full/);
  });

  it("builds a verify-full pool config with a CA bundle", () => {
    const caPath = join(mkdtempSync(join(tmpdir(), "billing-ca-")), "ca.pem");
    writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nMIICdummy\n-----END CERTIFICATE-----\n");
    process.env["HASNA_BILLING_DATABASE_URL"] =
      "postgresql://example.invalid/billing?sslmode=verify-full";
    process.env["PGSSLROOTCERT"] = caPath;
    const config = buildPostgresqlPoolConfig();
    expect(config.connectionString).toContain("verify-full");
    expect(config.ssl).toBeDefined();
    expect((config.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized).toBe(true);
  });

  it("passes a mounted database URL through to the actual lazy pool", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "billing-mounted-dsn-"));
    const caPath = join(tempDir, "ca.pem");
    const urlPath = join(tempDir, "database-url");
    const dsn = "postgresql://example.invalid/billing?sslmode=verify-full";
    writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nMIICdummy\n-----END CERTIFICATE-----\n");
    writeFileSync(urlPath, `${dsn}\n`);

    const client = createPostgresqlClient({
      HASNA_BILLING_DATABASE_URL_FILE: urlPath,
      PGSSLROOTCERT: caPath,
    });
    try {
      expect(client.pool.options.connectionString).toBe(dsn);
    } finally {
      await client.close();
    }
  });

  it("fails closed on every SQLite entry path when PostgreSQL is selected", () => {
    process.env["HASNA_BILLING_DATABASE_URL"] =
      "postgresql://example.invalid/billing?sslmode=verify-full";
    expect(() => openDatabase()).toThrow(/postgresql backend|fails closed/i);
    expect(() => openDatabase(":memory:")).toThrow(/postgresql backend|fails closed/i);
  });
});
