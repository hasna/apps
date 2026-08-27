import { describe, expect, test } from "bun:test";
import { resolveDatabaseUrl, resolveMigrationDatabaseUrl } from "./cloud-config.js";

describe("cloud config DSN resolution", () => {
  test("runtime DSN resolves from HASNA_RECORDINGS_DATABASE_URL first", () => {
    expect(
      resolveDatabaseUrl({
        HASNA_RECORDINGS_DATABASE_URL: "postgresql://a:1@h:5432/runtime",
        RECORDINGS_DATABASE_URL: "postgresql://a:1@h:5432/legacy",
        DATABASE_URL: "postgresql://a:1@h:5432/generic",
      }),
    ).toBe("postgresql://a:1@h:5432/runtime");
  });

  test("migration DSN resolves from HASNA_RECORDINGS_MIGRATE_DATABASE_URL first", () => {
    expect(
      resolveMigrationDatabaseUrl({
        HASNA_RECORDINGS_MIGRATE_DATABASE_URL: "postgresql://m:1@h:5432/migrate",
        RECORDINGS_MIGRATE_DATABASE_URL: "postgresql://m:1@h:5432/migrate-legacy",
        HASNA_RECORDINGS_DATABASE_URL: "postgresql://a:1@h:5432/runtime",
      }),
    ).toBe("postgresql://m:1@h:5432/migrate");
  });

  test("migration DSN falls back to RECORDINGS_MIGRATE_DATABASE_URL", () => {
    expect(
      resolveMigrationDatabaseUrl({
        RECORDINGS_MIGRATE_DATABASE_URL: "postgresql://m:1@h:5432/migrate-legacy",
        HASNA_RECORDINGS_DATABASE_URL: "postgresql://a:1@h:5432/runtime",
      }),
    ).toBe("postgresql://m:1@h:5432/migrate-legacy");
  });

  test("migration DSN falls back to the runtime DSN (single-role setup)", () => {
    expect(
      resolveMigrationDatabaseUrl({
        HASNA_RECORDINGS_DATABASE_URL: "postgresql://a:1@h:5432/runtime",
      }),
    ).toBe("postgresql://a:1@h:5432/runtime");
    expect(
      resolveMigrationDatabaseUrl({
        RECORDINGS_DATABASE_URL: "postgresql://a:1@h:5432/legacy",
      }),
    ).toBe("postgresql://a:1@h:5432/legacy");
    expect(
      resolveMigrationDatabaseUrl({
        DATABASE_URL: "postgresql://a:1@h:5432/generic",
      }),
    ).toBe("postgresql://a:1@h:5432/generic");
  });

  test("migration DSN is undefined when nothing is configured", () => {
    expect(resolveMigrationDatabaseUrl({})).toBeUndefined();
  });
});
