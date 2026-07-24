import { describe, expect, test } from "bun:test";
import { runStorageContractSuite } from "./storage-contract-suite.js";

/**
 * Live PostgreSQL runtime gate (hasna-storage-standard). Skipped unless
 * PERSONALNOTES_TEST_DATABASE_URL points at a DISPOSABLE Postgres — never a
 * shared/RDS instance. The default `bun test` stays hermetic with no PG present.
 */
const DSN = process.env.PERSONALNOTES_TEST_DATABASE_URL;

const suite = DSN ? describe : describe.skip;

suite("PostgresAuthStorage (live)", () => {
  test("checksum drift on a released migration is rejected", async () => {
    const { Pool } = await import("pg");
    const { PostgresAuthStorage } = await import("./postgres.ts");
    const { POSTGRES_STORAGE_MIGRATIONS } = await import("./postgres-schema.ts");
    const pool = new Pool({ connectionString: DSN });
    const storage = new PostgresAuthStorage({ pool });
    await storage.migrate();
    const original = POSTGRES_STORAGE_MIGRATIONS[0]!.sql;
    POSTGRES_STORAGE_MIGRATIONS[0]!.sql = original + " -- tampered";
    const err = await storage.migrate().catch((e) => e);
    POSTGRES_STORAGE_MIGRATIONS[0]!.sql = original;
    expect(String(err)).toContain("checksum drift");
    await storage.close();
  });
});

if (DSN) {
  runStorageContractSuite("PostgresAuthStorage (live)", async () => {
    const { Pool } = await import("pg");
    const { PostgresAuthStorage } = await import("./postgres.ts");
    const pool = new Pool({ connectionString: DSN });
    const storage = new PostgresAuthStorage({ pool });
    // Fresh schema per run to keep the isolation assertions deterministic.
    await pool.query("DROP TABLE IF EXISTS pn_tokens, pn_users, pn_tenants, pn_schema_migrations CASCADE");
    await storage.migrate();
    return storage;
  });
}
