import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SqliteDatabase } from "../db/database.js";
import { PgAdapterAsync, PgTransactionAdapter } from "./remote-storage.js";
import { syncPull, syncPush } from "./storage-sync.js";

class FakePg extends PgAdapterAsync {
  public allCalls: string[] = [];
  public runCalls: Array<{ sql: string; params: unknown[] }> = [];
  private readonly rows: Record<string, Array<Record<string, unknown>>>;
  private readonly columns: Record<string, string[]>;

  constructor(rows: Record<string, Array<Record<string, unknown>>>, columns: Record<string, string[]>) {
    super({ query: async () => ({ rows: [], rowCount: 0 }), end: async () => {} } as any);
    this.rows = rows;
    this.columns = columns;
  }

  override async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    this.allCalls.push(sql);
    if (sql.includes("information_schema.table_constraints")) return [];
    if (sql.includes("information_schema.columns")) {
      const table = params[0] as string;
      return (this.columns[table] ?? []).map((column_name) => ({ column_name }));
    }
    const match = sql.match(/SELECT \* FROM "([^"]+)"/);
    if (match) return this.rows[match[1]!] ?? [];
    return [];
  }

  override async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    this.runCalls.push({ sql, params });
    return { changes: 1 };
  }

  override async transaction<T>(fn: (adapter: PgTransactionAdapter) => Promise<T>): Promise<T> {
    this.runCalls.push({ sql: "BEGIN", params: [] });
    try {
      const result = await fn(this as unknown as PgTransactionAdapter);
      this.runCalls.push({ sql: "COMMIT", params: [] });
      return result;
    } catch (error) {
      this.runCalls.push({ sql: "ROLLBACK", params: [] });
      throw error;
    }
  }
}

class InsertFailPg extends FakePg {
  override async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    await super.run(sql, ...params);
    if (sql.startsWith("INSERT")) throw new Error("simulated insert failure");
    return { changes: 1 };
  }
}

function memoryDb(): SqliteDatabase {
  return new SqliteDatabase(":memory:");
}

describe("storage sync", () => {
  test("pull replaces the local table snapshot so remote deletes propagate", async () => {
    const local = memoryDb();
    local.exec(`
      CREATE TABLE connector_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL
      )
    `);
    local.run("INSERT INTO connector_jobs (id, name, enabled) VALUES (?, ?, ?)", ["stale", "stale", 1]);
    local.run("INSERT INTO connector_jobs (id, name, enabled) VALUES (?, ?, ?)", ["keep", "old", 1]);
    const remote = new FakePg({
      connector_jobs: [{ id: "keep", name: "new", enabled: true }],
    }, {
      connector_jobs: ["id", "name", "enabled"],
    });

    const results = await syncPull(remote, local, { tables: ["connector_jobs"] });

    expect(results).toEqual([{ table: "connector_jobs", rowsRead: 1, rowsWritten: 1, rowsSkipped: 0, errors: [] }]);
    expect(local.all("SELECT id, name, enabled FROM connector_jobs ORDER BY id")).toEqual([
      { id: "keep", name: "new", enabled: 1 },
    ]);
    local.close();
  });

  test("push sends delete then insert statements with native PostgreSQL placeholders", async () => {
    const local = memoryDb();
    local.exec(`
      CREATE TABLE connector_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL
      )
    `);
    local.run("INSERT INTO connector_jobs (id, name, enabled) VALUES (?, ?, ?)", ["job1", "Job 1", 1]);
    const remote = new FakePg({}, {
      connector_jobs: ["id", "name", "enabled"],
    });

    const results = await syncPush(local, remote, { tables: ["connector_jobs"] });

    expect(results).toEqual([{ table: "connector_jobs", rowsRead: 1, rowsWritten: 1, rowsSkipped: 0, errors: [] }]);
    expect(remote.runCalls.map((call) => call.sql)).toEqual([
      "BEGIN",
      'DELETE FROM "connector_jobs"',
      'INSERT INTO "connector_jobs" ("id", "name", "enabled") VALUES ($1, $2, $3)',
      "COMMIT",
    ]);
    expect(remote.runCalls[2]?.params).toEqual(["job1", "Job 1", true]);
    local.close();
  });

  test("push rolls back remote snapshot replacement when insert fails", async () => {
    const local = memoryDb();
    local.exec(`
      CREATE TABLE connector_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL
      )
    `);
    local.run("INSERT INTO connector_jobs (id, name, enabled) VALUES (?, ?, ?)", ["job1", "Job 1", 1]);
    const remote = new InsertFailPg({}, {
      connector_jobs: ["id", "name", "enabled"],
    });

    await expect(syncPush(local, remote, { tables: ["connector_jobs"] })).rejects.toThrow("simulated insert failure");

    expect(remote.runCalls.map((call) => call.sql)).toEqual([
      "BEGIN",
      'DELETE FROM "connector_jobs"',
      'INSERT INTO "connector_jobs" ("id", "name", "enabled") VALUES ($1, $2, $3)',
      "ROLLBACK",
    ]);
    local.close();
  });

  test("pull preserves local snapshot when insert fails after delete", async () => {
    const local = memoryDb();
    local.exec(`
      CREATE TABLE connector_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL
      )
    `);
    local.run("INSERT INTO connector_jobs (id, name, enabled) VALUES (?, ?, ?)", ["existing", "Existing", 1]);
    const remote = new FakePg({
      connector_jobs: [{ id: "new" }],
    }, {
      connector_jobs: ["id"],
    });

    await expect(syncPull(remote, local, { tables: ["connector_jobs"] })).rejects.toThrow();

    expect(local.all("SELECT id, name, enabled FROM connector_jobs")).toEqual([
      { id: "existing", name: "Existing", enabled: 1 },
    ]);
    local.close();
  });
});
