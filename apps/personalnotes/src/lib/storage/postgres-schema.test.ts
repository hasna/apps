import { describe, expect, test } from "bun:test";
import { checksumStorageSql } from "./checksum.js";
import {
  POSTGRES_MIGRATION_ADVISORY_LOCK_SQL,
  POSTGRES_MIGRATION_LEDGER_TABLE,
  POSTGRES_STORAGE_MIGRATIONS,
} from "./postgres-schema.js";
import { SQLITE_STORAGE_MIGRATIONS } from "./sqlite-schema.js";

// These assertions are hermetic (no Postgres) and PIN the released migration
// set. If someone edits released migration SQL, the checksum assertion fails —
// which is the intended tripwire (hasna-storage-standard: never edit a released
// migration, append instead).

describe("postgres-schema (hermetic)", () => {
  test("migration ids are unique and in stable order", () => {
    const ids = POSTGRES_STORAGE_MIGRATIONS.map((m) => m.id);
    expect(ids).toEqual(["0001_init"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("each migration checksum matches its SQL", () => {
    for (const migration of POSTGRES_STORAGE_MIGRATIONS) {
      expect(migration.checksum).toBe(checksumStorageSql(migration.sql));
      expect(migration.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  test("migrations are frozen (immutable released set)", () => {
    expect(Object.isFrozen(POSTGRES_STORAGE_MIGRATIONS)).toBe(true);
    expect(Object.isFrozen(POSTGRES_STORAGE_MIGRATIONS[0])).toBe(true);
  });

  test("ledger table + advisory lock constants are stable", () => {
    expect(POSTGRES_MIGRATION_LEDGER_TABLE).toBe("personalnotes_schema_migrations");
    expect(POSTGRES_MIGRATION_ADVISORY_LOCK_SQL).toBe(
      "SELECT pg_advisory_xact_lock(1347767636, 1398362962)",
    );
  });

  test("SQLite and Postgres expose the SAME logical migration ids (engine parity)", () => {
    expect(POSTGRES_STORAGE_MIGRATIONS.map((m) => m.id)).toEqual(
      SQLITE_STORAGE_MIGRATIONS.map((m) => m.id),
    );
  });
});
