import { afterEach, describe, expect, test } from "bun:test";
import pg from "pg";
import { PgAdapterAsync } from "./remote-storage.js";

const originalPool = pg.Pool;

afterEach(() => {
  (pg as unknown as { Pool: typeof originalPool }).Pool = originalPool;
});

describe("PgAdapterAsync", () => {
  test("passes native PostgreSQL placeholders through unchanged", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      async query(sql: string, params?: unknown[]) {
        calls.push({ sql, params: params ?? [] });
        return { rows: [{ literal: "?", value: "ok" }], rowCount: 1 };
      },
      async end() {},
    };
    const adapter = new PgAdapterAsync(pool as any);

    await adapter.all("SELECT '?' AS literal, $1 AS value", "ok");

    expect(calls).toEqual([{ sql: "SELECT '?' AS literal, $1 AS value", params: ["ok"] }]);
  });

  test("requires verified TLS when sslmode=require is used", () => {
    let capturedOptions: unknown;
    (pg as unknown as { Pool: unknown }).Pool = class {
      constructor(options: unknown) {
        capturedOptions = options;
      }
    };

    new PgAdapterAsync("postgres://user:pass@example.com/db?sslmode=require");

    expect(capturedOptions).toMatchObject({
      connectionString: "postgres://user:pass@example.com/db?sslmode=require",
      ssl: { rejectUnauthorized: true },
    });
  });

  test("does not force TLS when sslmode=disable is explicit", () => {
    let capturedOptions: unknown;
    (pg as unknown as { Pool: unknown }).Pool = class {
      constructor(options: unknown) {
        capturedOptions = options;
      }
    };

    new PgAdapterAsync("postgres://user:pass@example.com/db?sslmode=disable");

    expect(capturedOptions).toMatchObject({
      connectionString: "postgres://user:pass@example.com/db?sslmode=disable",
    });
    expect((capturedOptions as { ssl?: unknown }).ssl).toBeUndefined();
  });

  test("supports keyword-style PostgreSQL connection strings", () => {
    let capturedOptions: unknown;
    (pg as unknown as { Pool: unknown }).Pool = class {
      constructor(options: unknown) {
        capturedOptions = options;
      }
    };

    new PgAdapterAsync("host=example.com dbname=connectors user=test sslmode=require");

    expect(capturedOptions).toMatchObject({
      host: "example.com",
      database: "connectors",
      user: "test",
      ssl: { rejectUnauthorized: true },
    });
    expect((capturedOptions as { connectionString?: unknown }).connectionString).toBeUndefined();
  });
});
