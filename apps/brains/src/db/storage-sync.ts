import type { SqliteAdapter } from "./sqlite-adapter.js";
import { getBrainsDbPath, getRawDb } from "./index.js";
import { getStorageConfig, getStorageConnectionString } from "./storage-config.js";
import { PgAdapterAsync } from "./remote-storage.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";

type Row = Record<string, unknown>;

export interface StorageSyncResult {
  table: string;
  direction: "push" | "pull";
  rowsRead: number;
  rowsWritten: number;
  errors: string[];
}

export type SyncResult = StorageSyncResult;

export interface StorageStatus {
  mode: string;
  enabled: boolean;
  db_path: string;
  tables: Array<{ table: string; rows: number }>;
}

export const STORAGE_TABLES = [
  "fine_tuned_models",
  "training_jobs",
  "training_datasets",
  "feedback",
] as const;

const TABLE_KEYS: Record<string, string[]> = {
  fine_tuned_models: ["id"],
  training_jobs: ["id"],
  training_datasets: ["id"],
  feedback: ["id"],
};

function quoteId(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

async function getRemoteColumns(remote: PgAdapterAsync, table: string): Promise<Set<string>> {
  const rows = await remote.all(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    table
  ) as Array<{ column_name: string }>;
  return new Set(rows.map((row) => row.column_name));
}

function getSqliteColumns(db: SqliteAdapter, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${quoteId(table)})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

async function upsertPg(remote: PgAdapterAsync, table: string, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;

  const remoteColumns = await getRemoteColumns(remote, table);
  const keyColumns = TABLE_KEYS[table] ?? ["id"];
  let written = 0;

  for (const row of rows) {
    const columns = Object.keys(row).filter((column) => remoteColumns.has(column));
    if (keyColumns.some((column) => !columns.includes(column))) continue;

    const values = columns.map((column) => row[column]);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const updateColumns = columns.filter((column) => !keyColumns.includes(column));
    const updateClause = updateColumns.length > 0
      ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteId(column)} = EXCLUDED.${quoteId(column)}`).join(", ")}`
      : "DO NOTHING";

    await remote.run(
      `INSERT INTO ${quoteId(table)} (${columns.map(quoteId).join(", ")})
       VALUES (${placeholders})
       ON CONFLICT (${keyColumns.map(quoteId).join(", ")}) ${updateClause}`,
      ...values
    );
    written++;
  }

  return written;
}

function upsertSqlite(db: SqliteAdapter, table: string, rows: Row[]): number {
  const sqliteColumns = getSqliteColumns(db, table);
  const keyColumns = TABLE_KEYS[table] ?? ["id"];
  let written = 0;

  for (const row of rows) {
    const columns = Object.keys(row).filter((column) => sqliteColumns.has(column));
    if (keyColumns.some((column) => !columns.includes(column))) continue;

    const updateColumns = columns.filter((column) => !keyColumns.includes(column));
    const updateClause = updateColumns.length > 0
      ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteId(column)} = excluded.${quoteId(column)}`).join(", ")}`
      : "DO NOTHING";

    db.prepare(
      `INSERT INTO ${quoteId(table)} (${columns.map(quoteId).join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})
       ON CONFLICT(${keyColumns.map(quoteId).join(", ")}) ${updateClause}`
    ).run(...(columns.map((column) => row[column]) as any[]));
    written++;
  }

  return written;
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  return new PgAdapterAsync(getStorageConnectionString("brains"));
}

export async function runStorageMigrations(remote: PgAdapterAsync): Promise<void> {
  for (const migration of PG_MIGRATIONS) {
    await remote.exec(migration);
  }
}

export function getStorageStatus(db: SqliteAdapter = getRawDb()): StorageStatus {
  const config = getStorageConfig();
  try {
    return {
      mode: config.mode,
      enabled: config.mode === "hybrid" || config.mode === "remote",
      db_path: getBrainsDbPath(),
      tables: STORAGE_TABLES.map((table) => {
        try {
          const row = db.prepare(`SELECT COUNT(*) as count FROM ${quoteId(table)}`).get() as { count: number };
          return { table, rows: row.count };
        } catch {
          return { table, rows: 0 };
        }
      }),
    };
  } finally {
    db.close();
  }
}

export async function pushStorageChanges(tables: string[] = [...STORAGE_TABLES]): Promise<StorageSyncResult[]> {
  const db = getRawDb();
  const remote = await getStoragePg();
  const results: StorageSyncResult[] = [];

  try {
    await runStorageMigrations(remote);
    for (const table of tables) {
      const result: StorageSyncResult = { table, direction: "push", rowsRead: 0, rowsWritten: 0, errors: [] };
      try {
        const rows = db.prepare(`SELECT * FROM ${quoteId(table)}`).all() as Row[];
        result.rowsRead = rows.length;
        result.rowsWritten = await upsertPg(remote, table, rows);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
      results.push(result);
    }
  } finally {
    db.close();
    await remote.close();
  }

  return results;
}

export async function pullStorageChanges(tables: string[] = [...STORAGE_TABLES]): Promise<StorageSyncResult[]> {
  const db = getRawDb();
  const remote = await getStoragePg();
  const results: StorageSyncResult[] = [];

  try {
    await runStorageMigrations(remote);
    for (const table of tables) {
      const result: StorageSyncResult = { table, direction: "pull", rowsRead: 0, rowsWritten: 0, errors: [] };
      try {
        const rows = await remote.all(`SELECT * FROM ${quoteId(table)}`) as Row[];
        result.rowsRead = rows.length;
        result.rowsWritten = upsertSqlite(db, table, rows);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
      results.push(result);
    }
  } finally {
    db.close();
    await remote.close();
  }

  return results;
}

export async function syncStorageChanges(tables: string[] = [...STORAGE_TABLES]): Promise<{ push: StorageSyncResult[]; pull: StorageSyncResult[] }> {
  return {
    push: await pushStorageChanges(tables),
    pull: await pullStorageChanges(tables),
  };
}

export function parseStorageTables(raw?: string): string[] {
  if (!raw) return [...STORAGE_TABLES];
  const requested = raw.split(",").map((table) => table.trim()).filter(Boolean);
  return requested.length > 0 ? requested : [...STORAGE_TABLES];
}
