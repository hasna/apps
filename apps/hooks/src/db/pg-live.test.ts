import { describe, expect, test } from "bun:test";
import { PgAdapterAsync } from "./remote-storage.js";

// Live-PostgreSQL gate (storage.pgTestGate in hasna.contract.json).
//
// Runs only when HASNA_HOOKS_TEST_DATABASE_URL points at a throwaway
// Postgres: the manifest gate command refuses to pass without one, and
// without the variable this file skips so the ordinary local suite stays
// green. It proves the package's PG adapter (PgAdapterAsync, the same path
// the storage-sync PostgreSQL backend uses) really reads and writes a live
// server — the engine claim the manifest makes.

const TEST_DATABASE_URL = process.env.HASNA_HOOKS_TEST_DATABASE_URL;

const maybe = TEST_DATABASE_URL ? describe : describe.skip;

maybe("live PostgreSQL support (HASNA_HOOKS_TEST_DATABASE_URL)", () => {
  test("PgAdapterAsync executes DDL, DML, and reads against a live server", async () => {
    const adapter = new PgAdapterAsync(TEST_DATABASE_URL!);
    const table = `hook_pg_gate_probe_${Date.now().toString(36)}`;
    try {
      await adapter.run(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, payload TEXT)`);
      await adapter.run(`INSERT INTO ${table} (id, payload) VALUES (?, ?)`, "probe-1", "hello");
      const rows = (await adapter.all(`SELECT id, payload FROM ${table} WHERE id = ?`, "probe-1")) as Array<{
        id: string;
        payload: string;
      }>;
      expect(rows).toEqual([{ id: "probe-1", payload: "hello" }]);
      const count = (await adapter.all(`SELECT COUNT(*) AS n FROM ${table}`)) as Array<{ n: string }>;
      expect(Number(count[0]?.n)).toBe(1);
    } finally {
      await adapter.run(`DROP TABLE IF EXISTS ${table}`).catch(() => undefined);
      await adapter.close();
    }
  });

  test("sslConfigFor verifies TLS by default", () => {
    // Static companion assertion: the adapter's default TLS posture is part
    // of the live-PG contract (verified TLS, never rejectUnauthorized: false
    // unless the dev-only key opts in).
    const { sslConfigFor } = require("./remote-storage.js") as typeof import("./remote-storage.js");
    expect(sslConfigFor("postgres://u@h/db?sslmode=require")).toEqual({ rejectUnauthorized: true });
  });
});
