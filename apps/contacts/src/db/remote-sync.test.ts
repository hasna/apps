import { afterEach, describe, expect, test } from "bun:test";
import {
  CONTACTS_REMOTE_CONFLICT_KEYS,
  CONTACTS_REMOTE_DEFAULT_TABLES,
  CONTACTS_REMOTE_SENSITIVE_TABLES,
  CONTACTS_REMOTE_TABLES,
  getRemoteDatabaseUrl,
  normalizeSqliteSyncValue,
  resolveRemoteTables,
} from "./remote-sync.js";

const remoteEnv = [
  "HASNA_CONTACTS_POSTGRES_URL",
  "OPEN_CONTACTS_POSTGRES_URL",
  "CONTACTS_POSTGRES_URL",
  "HASNA_CONTACTS_DATABASE_URL",
  "CONTACTS_DATABASE_URL",
] as const;

const originalEnv = new Map(remoteEnv.map((name) => [name, process.env[name]]));

function restoreEnv(): void {
  for (const name of remoteEnv) {
    const value = originalEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

afterEach(() => {
  restoreEnv();
});

describe("contacts remote sync configuration", () => {
  test("resolves the first configured repo-owned database URL", () => {
    restoreEnv();
    for (const name of remoteEnv) delete process.env[name];

    expect(getRemoteDatabaseUrl()).toBeNull();

    process.env["CONTACTS_DATABASE_URL"] = "postgres://fallback";
    process.env["HASNA_CONTACTS_POSTGRES_URL"] = "postgres://primary";

    expect(getRemoteDatabaseUrl()).toBe("postgres://primary");
  });

  test("resolves non-sensitive tables by default and rejects unknown table names", () => {
    expect(resolveRemoteTables()).toEqual([...CONTACTS_REMOTE_DEFAULT_TABLES]);
    for (const table of CONTACTS_REMOTE_SENSITIVE_TABLES) {
      expect(resolveRemoteTables()).not.toContain(table);
    }
    expect(resolveRemoteTables(["webhooks", "contact_health"])).toEqual(["webhooks", "contact_health"]);
    expect(resolveRemoteTables()).toEqual(
      CONTACTS_REMOTE_TABLES.filter((table) => !["webhooks", "contact_documents", "contact_health"].includes(table))
    );
    expect(resolveRemoteTables(["contacts", "companies"])).toEqual(["contacts", "companies"]);
    expect(() => resolveRemoteTables(["contacts_fts"])).toThrow("Unknown contacts sync table");
    expect(() => resolveRemoteTables(["contacts", "missing_table"])).toThrow("missing_table");
  });

  test("normalizes remote PostgreSQL values for SQLite writes", () => {
    const date = new Date("2026-06-29T12:34:56.000Z");

    expect(normalizeSqliteSyncValue(date)).toBe("2026-06-29T12:34:56.000Z");
    expect(normalizeSqliteSyncValue(true)).toBe(1);
    expect(normalizeSqliteSyncValue(false)).toBe(0);
    expect(normalizeSqliteSyncValue({ nested: true })).toBe('{"nested":true}');
    expect(normalizeSqliteSyncValue(undefined)).toBeNull();
  });

  test("uses natural suppression key for cross-machine upserts", () => {
    expect(CONTACTS_REMOTE_CONFLICT_KEYS.contact_suppressions).toEqual(["channel", "address"]);
  });
});
