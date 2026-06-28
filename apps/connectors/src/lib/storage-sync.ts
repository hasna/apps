import type { Database } from "../db/database.js";
import { PgAdapterAsync, PgTransactionAdapter } from "./remote-storage.js";

export interface SyncProgress {
  table: string;
  phase: "reading" | "writing" | "done";
  rowsRead: number;
  rowsWritten: number;
  totalTables: number;
  currentTableIndex: number;
}

export interface SyncOptions {
  tables: string[];
  onProgress?: (progress: SyncProgress) => void;
  batchSize?: number;
}

export interface SyncResult {
  table: string;
  rowsRead: number;
  rowsWritten: number;
  rowsSkipped: number;
  errors: string[];
}

type Row = Record<string, unknown>;
type Adapter = Database | PgAdapterAsync | PgTransactionAdapter;

const BOOLEAN_COLUMNS = new Set([
  "connector_jobs.enabled",
  "connector_jobs.strip",
  "connector_workflows.enabled",
]);

export async function syncPush(local: Database, remote: PgAdapterAsync, options: SyncOptions): Promise<SyncResult[]> {
  const tables = await getTableOrder(remote, options.tables);
  return syncTransfer(local, remote, { ...options, tables });
}

export async function syncPull(remote: PgAdapterAsync, local: Database, options: SyncOptions): Promise<SyncResult[]> {
  const tables = await getTableOrder(remote, options.tables);
  return syncTransfer(remote, local, { ...options, tables });
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function getTableOrder(remote: PgAdapterAsync, tables: string[]): Promise<string[]> {
  if (tables.length <= 1) return tables;
  try {
    const rows = await remote.all(`
      SELECT DISTINCT
        tc.table_name AS source_table,
        ccu.table_name AS referenced_table
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
    `) as Array<{ source_table: string; referenced_table: string }>;
    if (rows.length > 0) return topoSort(tables, rows);
  } catch {}
  return tables;
}

function topoSort(tables: string[], foreignKeys: Array<{ source_table: string; referenced_table: string }>): string[] {
  const allowed = new Set(tables);
  const deps = new Map<string, Set<string>>();
  for (const table of tables) deps.set(table, new Set());
  for (const fk of foreignKeys) {
    if (allowed.has(fk.source_table) && allowed.has(fk.referenced_table)) deps.get(fk.source_table)?.add(fk.referenced_table);
  }
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(table: string): void {
    if (visited.has(table)) return;
    if (visiting.has(table)) {
      visited.add(table);
      sorted.push(table);
      return;
    }
    visiting.add(table);
    for (const dep of deps.get(table) ?? []) visit(dep);
    visiting.delete(table);
    visited.add(table);
    sorted.push(table);
  }
  for (const table of tables) visit(table);
  return sorted;
}

async function syncTransfer(source: Adapter, target: Adapter, options: SyncOptions): Promise<SyncResult[]> {
  const { tables, onProgress, batchSize = 100 } = options;
  const results: SyncResult[] = [];
  const sqliteTarget = isAsyncAdapter(target) ? null : target;
  const snapshots: Array<{ table: string; rows: Row[]; columns: string[]; result: SyncResult }> = [];

  await ensureTablesExist(source, target, tables);

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]!;
    const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, rowsSkipped: 0, errors: [] };
    try {
      onProgress?.({ table, phase: "reading", rowsRead: 0, rowsWritten: 0, totalTables: tables.length, currentTableIndex: i });
      const rows = await readAll(source, `SELECT * FROM ${quoteIdent(table)}`);
      result.rowsRead = rows.length;
      const columns = rows.length > 0 ? await filterColumnsForTarget(target, table, Object.keys(rows[0]!)) : [];
      if (rows.length > 0 && columns.length === 0) {
        result.errors.push(`Table "${table}" has no writable target columns`);
      }
      snapshots.push({ table, rows, columns, result });
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
    results.push(result);
  }

  if (results.some((result) => result.errors.length > 0)) {
    return results;
  }

  if (sqliteTarget) {
    try { sqliteTarget.exec("PRAGMA foreign_keys = OFF"); } catch {}
  }

  try {
    await withTransaction(target, async (transactionTarget) => {
      for (const table of [...tables].reverse()) {
        await deleteAllRows(transactionTarget, table);
      }

      for (let i = 0; i < snapshots.length; i++) {
        const snapshot = snapshots[i]!;
        onProgress?.({ table: snapshot.table, phase: "writing", rowsRead: snapshot.result.rowsRead, rowsWritten: 0, totalTables: snapshots.length, currentTableIndex: i });
        for (const batch of batches(snapshot.rows, batchSize)) {
          await insertBatch(transactionTarget, snapshot.table, snapshot.columns, batch);
          snapshot.result.rowsWritten += batch.length;
          onProgress?.({ table: snapshot.table, phase: "writing", rowsRead: snapshot.result.rowsRead, rowsWritten: snapshot.result.rowsWritten, totalTables: snapshots.length, currentTableIndex: i });
        }
        onProgress?.({ table: snapshot.table, phase: "done", rowsRead: snapshot.result.rowsRead, rowsWritten: snapshot.result.rowsWritten, totalTables: snapshots.length, currentTableIndex: i });
      }
    });
  } finally {
    if (sqliteTarget) {
      try { sqliteTarget.exec("PRAGMA foreign_keys = ON"); } catch {}
    }
  }

  return results;
}

async function detectPrimaryKeys(adapter: Adapter, table: string): Promise<string[]> {
  if (isAsyncAdapter(adapter)) {
    try {
      const rows = await adapter.all(`
        SELECT kcu.column_name, kcu.ordinal_position
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = $1
        ORDER BY kcu.ordinal_position
      `, table) as Array<{ column_name: string }>;
      return rows.map((row) => row.column_name);
    } catch {
      return [];
    }
  }
  const rows = adapter.all(`PRAGMA table_info(${quoteIdent(table)})`) as Array<{ name: string; pk: number }>;
  return rows.filter((row) => row.pk > 0).sort((a, b) => a.pk - b.pk).map((row) => row.name);
}

async function ensureTablesExist(source: Adapter, target: Adapter, tables: string[]): Promise<void> {
  if (!isAsyncAdapter(source) || isAsyncAdapter(target)) return;
  for (const table of tables) await ensureTableInSqliteFromPg(target, source, table);
}

async function ensureTableInSqliteFromPg(target: Database, source: PgAdapterAsync | PgTransactionAdapter, table: string): Promise<void> {
  const existing = target.all("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table);
  if (existing.length > 0) return;
  const columns = await source.all(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, table) as Array<{ column_name: string; data_type: string; is_nullable: string }>;
  if (columns.length === 0) return;
  const primaryKeys = new Set(await detectPrimaryKeys(source, table));
  const definitions = columns
    .filter((column) => !["tsvector", "tsquery"].includes(column.data_type.toLowerCase()))
    .map((column) => {
      const type = pgTypeToSqlite(column.data_type);
      const notNull = column.is_nullable === "NO" && !primaryKeys.has(column.column_name) ? " NOT NULL" : "";
      return `${quoteIdent(column.column_name)} ${type}${notNull}`;
    });
  if (primaryKeys.size > 0) definitions.push(`PRIMARY KEY (${[...primaryKeys].map(quoteIdent).join(", ")})`);
  target.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (${definitions.join(", ")})`);
}

function pgTypeToSqlite(pgType: string): string {
  const type = pgType.toLowerCase();
  if (type.includes("int") || ["bigint", "smallint", "serial", "bigserial"].includes(type)) return "INTEGER";
  if (type.includes("bool")) return "INTEGER";
  if (type.includes("float") || type.includes("double") || ["real", "numeric", "decimal"].includes(type)) return "REAL";
  if (type === "bytea") return "BLOB";
  return "TEXT";
}

async function filterColumnsForTarget(target: Adapter, table: string, columns: string[]): Promise<string[]> {
  try {
    if (isAsyncAdapter(target)) {
      const rows = await target.all(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `, table) as Array<{ column_name: string }>;
      if (rows.length === 0) return columns;
      const targetColumns = new Set(rows.map((row) => row.column_name));
      return columns.filter((column) => targetColumns.has(column));
    }
    const rows = target.all(`PRAGMA table_info(${quoteIdent(table)})`) as Array<{ name: string }>;
    if (rows.length === 0) return columns;
    const targetColumns = new Set(rows.map((row) => row.name));
    return columns.filter((column) => targetColumns.has(column));
  } catch {
    return columns;
  }
}

async function deleteAllRows(target: Adapter, table: string): Promise<void> {
  const sql = `DELETE FROM ${quoteIdent(table)}`;
  if (isAsyncAdapter(target)) {
    await target.run(sql);
    return;
  }
  target.run(sql);
}

async function insertBatch(target: Adapter, table: string, columns: string[], batch: Row[]): Promise<void> {
  if (batch.length === 0 || columns.length === 0) return;
  const columnList = columns.map(quoteIdent).join(", ");
  if (isAsyncAdapter(target)) {
    const placeholders = batch
      .map((_, rowIndex) => `(${columns.map((__, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(", ")})`)
      .join(", ");
    const params = batch.flatMap((row) => columns.map((column) => coerceForPg(table, column, row[column])));
    await target.run(`INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES ${placeholders}`, ...params);
    return;
  }
  const placeholders = batch.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
  const params = batch.flatMap((row) => columns.map((column) => coerceForSqlite(row[column])));
  target.run(`INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES ${placeholders}`, params);
}

function batches(rows: Row[], size: number): Row[][] {
  const result: Row[][] = [];
  for (let offset = 0; offset < rows.length; offset += size) result.push(rows.slice(offset, offset + size));
  return result;
}

function coerceForSqlite(value: unknown): string | number | bigint | boolean | null | Uint8Array {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function coerceForPg(table: string, column: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (value !== null && BOOLEAN_COLUMNS.has(`${table}.${column}`)) return Boolean(value);
  return value;
}

function isAsyncAdapter(adapter: Adapter): adapter is PgAdapterAsync | PgTransactionAdapter {
  return adapter instanceof PgAdapterAsync || adapter instanceof PgTransactionAdapter;
}

async function readAll(adapter: Adapter, sql: string): Promise<Row[]> {
  const rows = adapter.all(sql);
  return (rows instanceof Promise ? await rows : rows) as Row[];
}

async function withTransaction<T>(adapter: Adapter, fn: (transactionTarget: Adapter) => Promise<T>): Promise<T> {
  if (adapter instanceof PgAdapterAsync) {
    return adapter.transaction(fn);
  }
  if (adapter instanceof PgTransactionAdapter) {
    return fn(adapter);
  }

  adapter.exec("BEGIN IMMEDIATE");
  try {
    const result = await fn(adapter);
    adapter.exec("COMMIT");
    return result;
  } catch (error) {
    try { adapter.exec("ROLLBACK"); } catch {}
    throw error;
  }
}
