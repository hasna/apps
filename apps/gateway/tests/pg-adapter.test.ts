import { describe, expect, test } from "bun:test";
import {
  PgAdapterAsync,
  normalizeParams,
  resolveLastInsertRowid,
  resolvePoolSsl,
  sqlitePlaceholdersToPostgres,
} from "../src/db/pg-adapter";

describe("sqlitePlaceholdersToPostgres", () => {
  test("numbers each placeholder in order", () => {
    expect(sqlitePlaceholdersToPostgres("INSERT INTO t (a, b, c) VALUES (?, ?, ?)")).toBe(
      "INSERT INTO t (a, b, c) VALUES ($1, $2, $3)",
    );
  });

  test("numbers all fourteen bindings of the ledger insert", () => {
    // The ledger INSERT in src/storage.ts binds fourteen columns; an off-by-one in the
    // rewrite would bind the wrong value to every column after the mistake.
    const rewritten = sqlitePlaceholdersToPostgres(
      "INSERT INTO gateway_usage_ledger (id, timestamp, provider, model, provider_model, route_mode, status, context_json, usage_json, estimated_cost_usd, budgets_json, error_type, error_code, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    expect(rewritten).toContain("VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)");
    expect(rewritten).not.toContain("?");
  });

  test("leaves statements without placeholders untouched", () => {
    const select = "SELECT record_json FROM gateway_usage_ledger ORDER BY timestamp ASC, id ASC";
    expect(sqlitePlaceholdersToPostgres(select)).toBe(select);

    const ddl = "CREATE TABLE IF NOT EXISTS gateway_usage_ledger (id TEXT PRIMARY KEY, estimated_cost_usd REAL)";
    expect(sqlitePlaceholdersToPostgres(ddl)).toBe(ddl);
  });

  test("restarts numbering per statement", () => {
    expect(sqlitePlaceholdersToPostgres("SELECT ?")).toBe("SELECT $1");
    expect(sqlitePlaceholdersToPostgres("SELECT ?")).toBe("SELECT $1");
  });
});

describe("normalizeParams", () => {
  test("passes the spread form through", () => {
    expect(normalizeParams(["a", 1, null])).toEqual(["a", 1, null]);
  });

  test("unwraps a single array argument", () => {
    expect(normalizeParams([["a", 1]])).toEqual(["a", 1]);
  });

  test("maps undefined onto SQL NULL because pg rejects undefined", () => {
    expect(normalizeParams(["a", undefined, 2])).toEqual(["a", null, 2]);
  });

  test("keeps a lone non-array argument as a single binding", () => {
    expect(normalizeParams(["only"])).toEqual(["only"]);
  });
});

describe("resolvePoolSsl", () => {
  test("encrypts without verifying for sslmode=require", () => {
    expect(resolvePoolSsl("postgres://host/db?sslmode=require")).toEqual({ rejectUnauthorized: false });
  });

  test("encrypts without verifying for ssl=true", () => {
    expect(resolvePoolSsl("postgres://host/db?ssl=true")).toEqual({ rejectUnauthorized: false });
  });

  test("leaves verifying and plaintext modes to pg", () => {
    expect(resolvePoolSsl("postgres://host/db?sslmode=verify-full")).toBeUndefined();
    expect(resolvePoolSsl("postgres://host/db")).toBeUndefined();
  });
});

describe("resolveLastInsertRowid", () => {
  test("reports 0 when a statement returns no rows", () => {
    // The ledger INSERT has no RETURNING clause, so this is the live path today.
    expect(resolveLastInsertRowid(undefined)).toBe(0);
    expect(resolveLastInsertRowid(null)).toBe(0);
    expect(resolveLastInsertRowid({})).toBe(0);
  });

  test("refuses a non-numeric id rather than typing a string as a rowid", () => {
    // The ledger declares `id TEXT` (src/storage.ts), so adding `RETURNING id` would hand
    // back a uuid string. RunResult.lastInsertRowid is `number | bigint`; passing the
    // string through would be a silent type lie.
    expect(resolveLastInsertRowid({ id: "3f1d0b1e-0000-4000-8000-000000000000" })).toBe(0);
    expect(resolveLastInsertRowid({ id: null })).toBe(0);
    expect(resolveLastInsertRowid({ id: { nested: true } })).toBe(0);
  });

  test("passes a numeric id through, including bigint", () => {
    expect(resolveLastInsertRowid({ id: 42 })).toBe(42);
    expect(resolveLastInsertRowid({ id: 9007199254740993n })).toBe(9007199254740993n);
  });
});

describe("PgAdapterAsync", () => {
  test("does not open a connection when constructed", async () => {
    // src/storage.ts maps connection failures onto usage_ledger_*_failed at query time,
    // which only holds if the constructor itself stays lazy.
    const adapter = new PgAdapterAsync("postgres://127.0.0.1:1/unreachable");
    await adapter.close();
  });
});
