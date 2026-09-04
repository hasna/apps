import { test, expect } from "bun:test";
import type { Pool } from "pg";
import { createQueryClient } from "./query";
import { wrapExecutor } from "./query";
import { MigrationLedger, defineMigration, validateTransactionalSql } from "./migrations";
import { ATTACHMENTS_MIGRATIONS } from "../db/migrations";

// Dedicated-client model: transaction snapshots become authoritative only at COMMIT.
// The advisory lock serializes snapshots, as READ COMMITTED does on PostgreSQL.
function fixture(failOn = "", rollbackFails = false) {
  let applied: { id: string; checksum: string; applied_at: string }[] = [];
  let mutations = 0, releaseLock: (() => void) | undefined;
  let lock = Promise.resolve();
  const events: string[] = [], released: (Error | undefined)[] = [];
  const pool = {
    query: async () => { throw new Error("Pool query must not escape the dedicated transaction"); },
    connect: async () => {
      let rows = applied, changes = 0, unlock: (() => void) | undefined;
      return {
        query: async (sql: string, params?: unknown[]) => {
          events.push(sql);
          if (failOn && sql.startsWith(failOn)) throw new Error("synthetic failure");
          if (sql.startsWith("SELECT pg_advisory")) {
            const previous = lock;
            lock = new Promise<void>(resolve => { releaseLock = resolve; });
            unlock = releaseLock; await previous; rows = [...applied]; changes = 0;
          } else if (sql.startsWith("INSERT INTO schema_migrations")) {
            rows.push({ id: String(params![0]), checksum: String(params![1]), applied_at: "now" });
          } else if (sql === "CREATE TABLE example (id INT)") changes++;
          else if (sql.startsWith("SELECT id,")) return { rows, rowCount: rows.length };
          else if (sql === "COMMIT") { applied = rows; mutations += changes; unlock?.(); unlock = undefined; }
          else if (sql === "ROLLBACK") {
            unlock?.(); unlock = undefined;
            if (rollbackFails) throw new Error("rollback failure");
          }
          return { rows: [], rowCount: 0 };
        },
        release: (error?: Error) => { released.push(error); unlock?.(); },
      };
    },
    end: async () => {},
  };
  return { client: createQueryClient(pool as unknown as Pool), events, released, state: () => ({ applied, mutations }) };
}
const definitions = [defineMigration("one", "CREATE TABLE example (id INT)")];

test("actual application migration definitions satisfy transactional DDL restrictions", () => {
  for (const migration of ATTACHMENTS_MIGRATIONS) expect(() => validateTransactionalSql(migration.sql)).not.toThrow();
});
test("plan, schema and ledger writes share a locked dedicated transaction", async () => {
  const f = fixture();
  const result = await new MigrationLedger(f.client, definitions).migrate();
  expect(result.applied).toHaveLength(1);
  expect(f.events[0]).toBe("BEGIN");
  expect(f.events[1]).toBe("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
  expect(f.events[2]).toContain("pg_advisory_xact_lock");
  expect(f.events.at(-1)).toBe("COMMIT");
  expect(f.state().mutations).toBe(1);
  expect(f.released).toEqual([undefined]);
});
for (const failOn of ["CREATE TABLE example", "INSERT INTO schema_migrations", "COMMIT"]) test("rollback is atomic after " + failOn + " failure", async () => {
  const f = fixture(failOn);
  await expect(new MigrationLedger(f.client, definitions).migrate()).rejects.toThrow("synthetic failure");
  expect(f.state()).toEqual({ applied: [], mutations: 0 });
  expect(f.events.at(-1)).toBe("ROLLBACK");
  expect(f.released).toHaveLength(1);
});
test("rollback failure discards the connection and preserves the original error", async () => {
  const f = fixture("INSERT INTO schema_migrations", true);
  await expect(new MigrationLedger(f.client, definitions).migrate()).rejects.toThrow("synthetic failure");
  expect(f.released[0]).toBeInstanceOf(Error);
  expect(f.state().mutations).toBe(0);
});
test("concurrent runners replan after acquiring the lock and apply only once", async () => {
  const f = fixture();
  const results = await Promise.all([new MigrationLedger(f.client, definitions).migrate(), new MigrationLedger(f.client, definitions).migrate()]);
  expect(results.map(r => r.plan[0]!.state).sort()).toEqual(["already_applied", "pending"]);
  expect(f.state().mutations).toBe(1);
  expect(f.state().applied).toHaveLength(1);
});
test("dry run does not create a ledger or require a transaction", async () => {
  const calls: string[] = [];
  const client = wrapExecutor({ query: async <T>(sql: string) => {
    calls.push(sql);
    return { rows: [{ relation: null }] as T[], rowCount: 1 };
  } });
  const result = await new MigrationLedger(client, definitions).migrate({ dryRun: true });
  expect(result.plan[0]!.state).toBe("pending");
  expect(calls).toEqual(["SELECT to_regclass($1) AS relation"]);
  await expect(new MigrationLedger(client, definitions).migrate()).rejects.toThrow("dedicated transactional");
  expect(calls).toHaveLength(1);
});
test("checksum drift rolls back before any additional schema application", async () => {
  const f = fixture();
  await new MigrationLedger(f.client, definitions).migrate();
  await expect(new MigrationLedger(f.client, [defineMigration("one", "CREATE TABLE changed (id INT)")]).migrate()).rejects.toThrow("checksum mismatch");
  expect(f.events.at(-1)).toBe("ROLLBACK");
  expect(f.state().mutations).toBe(1);
});
for (const sql of ["COMMIT; CREATE TABLE x (id INT)", "CREATE TABLE x (id INT); /* hidden */ END", "BEGIN", "CREATE INDEX CONCURRENTLY x ON y (id)", "DO $$ BEGIN COMMIT; END $$", "CREATE TABLE x (id INT); -- comment\nROLLBACK"]) test("reject transaction escape: " + sql, () => {
  expect(() => validateTransactionalSql(sql)).toThrow();
});

for (const [label, newline] of [["CR", "\r"], ["LF", "\n"], ["CRLF", "\r\n"]]) {
  for (const control of ["COMMIT", "ROLLBACK", "END", "ABORT", "BEGIN", "START TRANSACTION", "SAVEPOINT escape", "PREPARE TRANSACTION 'escape'"]) {
    test("line-comment " + label + " cannot hide " + control, () => {
      expect(() => validateTransactionalSql("CREATE TABLE x(id int); -- hidden" + newline + control + ";")).toThrow();
      expect(() => validateTransactionalSql("CREATE TABLE x(id int); -- first" + newline + "-- second" + newline + control + ";")).toThrow();
    });
  }
  test("line-comment " + label + " still permits subsequent schema DDL", () => {
    expect(() => validateTransactionalSql("CREATE TABLE x(id int); -- ignored COMMIT;" + newline + "CREATE INDEX idx ON x(id);")).not.toThrow();
  });
}
test("comment and quote boundaries remain distinct", () => {
  expect(() => validateTransactionalSql("CREATE TABLE x(id int); -- COMMIT at EOF")).not.toThrow();
  expect(() => validateTransactionalSql("CREATE TABLE x(id int); /* outer --\r /* inner */ END */ CREATE INDEX idx ON x(id);")).not.toThrow();
  expect(() => validateTransactionalSql("CREATE TABLE x(value text DEFAULT '--\rCOMMIT; it''s quoted', \"--END\" int);")).not.toThrow();
  expect(() => validateTransactionalSql("CREATE TABLE x(id int); /* outer /* inner */ */ -- hidden\r/* gap */ END;")).toThrow();
  expect(() => validateTransactionalSql("CREATE TABLE x(id int); /* unfinished")).toThrow();
  expect(() => validateTransactionalSql("CREATE TABLE x(value text DEFAULT 'unfinished);")).toThrow();
});
