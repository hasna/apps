import { getDatabase, getDbPath } from "./database.js"
import {
  STORAGE_DATABASE_ENV,
  getStorageConfig,
  getStorageConnectionString,
  getStorageDatabaseEnv,
  type StorageMode,
} from "./storage-config.js"
import { PgAdapterAsync } from "./remote-storage.js"
import { PG_MIGRATIONS } from "./pg-migrations.js"
import type { SqliteAdapter } from "./sqlite-adapter.js"

type Row = Record<string, unknown>

export interface StorageSyncResult {
  table: string
  direction: "push" | "pull"
  rows_read: number
  rows_written: number
  errors: string[]
}

export interface StorageStatus {
  configured: boolean
  mode: StorageMode
  enabled: boolean
  env: typeof STORAGE_DATABASE_ENV
  activeEnv: string | null
  service: "prompts"
  db_path: string
  tables: Array<{ table: string; rows: number }>
}

export type SyncResult = StorageSyncResult

export const STORAGE_TABLES = [
  "collections",
  "projects",
  "agents",
  "prompts",
  "prompt_versions",
  "usage_log",
  "prompt_schedules",
  "feedback",
] as const
export const PROMPTS_STORAGE_TABLES = STORAGE_TABLES

const BOOLEAN_COLUMNS: Record<string, string[]> = {
  prompts: ["is_template", "pinned"],
}

function quoteId(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`
}

function toPgRow(table: string, row: Row): Row {
  const copy = { ...row }
  for (const column of BOOLEAN_COLUMNS[table] ?? []) {
    if (column in copy) {
      copy[column] = Boolean(copy[column])
    }
  }
  return copy
}

function toSqliteRow(table: string, row: Row): Row {
  const copy = { ...row }
  for (const column of BOOLEAN_COLUMNS[table] ?? []) {
    if (column in copy) {
      copy[column] = copy[column] ? 1 : 0
    }
  }
  return copy
}

async function getRemoteColumns(remote: PgAdapterAsync, table: string): Promise<Set<string>> {
  const rows = await remote.all(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    table
  ) as Array<{ column_name: string }>
  return new Set(rows.map((row) => row.column_name))
}

async function upsertPg(remote: PgAdapterAsync, table: string, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0

  const remoteColumns = await getRemoteColumns(remote, table)
  let written = 0

  for (const rawRow of rows) {
    const row = toPgRow(table, rawRow)
    const columns = Object.keys(row).filter((column) => remoteColumns.has(column))
    if (!columns.includes("id")) continue

    const values = columns.map((column) => row[column])
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ")
    const updateColumns = columns.filter((column) => column !== "id")
    const updateClause = updateColumns.length > 0
      ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteId(column)} = EXCLUDED.${quoteId(column)}`).join(", ")}`
      : "DO NOTHING"

    await remote.run(
      `INSERT INTO ${quoteId(table)} (${columns.map(quoteId).join(", ")})
       VALUES (${placeholders})
       ON CONFLICT (id) ${updateClause}`,
      ...values
    )
    written++
  }

  return written
}

function upsertSqlite(db: SqliteAdapter, table: string, rows: Row[]): number {
  let written = 0

  for (const rawRow of rows) {
    const row = toSqliteRow(table, rawRow)
    const columns = Object.keys(row)
    if (!columns.includes("id")) continue

    const updateColumns = columns.filter((column) => column !== "id")
    const updateClause = updateColumns.length > 0
      ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteId(column)} = excluded.${quoteId(column)}`).join(", ")}`
      : "DO NOTHING"

    db.run(
      `INSERT INTO ${quoteId(table)} (${columns.map(quoteId).join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})
       ON CONFLICT(id) ${updateClause}`,
      ...columns.map((column) => row[column])
    )
    written++
  }

  return written
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  return new PgAdapterAsync(getStorageConnectionString("prompts"))
}

export async function runStorageMigrations(remote: PgAdapterAsync): Promise<void> {
  for (const migration of PG_MIGRATIONS) {
    await remote.exec(migration)
  }
}

export function getStorageStatus(db: SqliteAdapter = getDatabase()): StorageStatus {
  const config = getStorageConfig()
  const activeEnv = getStorageDatabaseEnv()
  return {
    configured: Boolean(activeEnv) || Boolean(config.rds.host && config.rds.username),
    mode: config.mode,
    enabled: config.mode === "hybrid" || config.mode === "remote",
    env: STORAGE_DATABASE_ENV,
    activeEnv: activeEnv?.name ?? null,
    service: "prompts",
    db_path: getDbPath(),
    tables: STORAGE_TABLES.map((table) => {
      try {
        const row = db.query(`SELECT COUNT(*) as count FROM ${quoteId(table)}`).get() as { count: number }
        return { table, rows: row.count }
      } catch {
        return { table, rows: 0 }
      }
    }),
  }
}

export async function pushStorageChanges(tables: string[] = [...STORAGE_TABLES]): Promise<StorageSyncResult[]> {
  const db = getDatabase()
  const remote = await getStoragePg()
  const results: StorageSyncResult[] = []

  try {
    await runStorageMigrations(remote)
    for (const table of tables) {
      const result: StorageSyncResult = { table, direction: "push", rows_read: 0, rows_written: 0, errors: [] }
      try {
        const rows = db.query(`SELECT * FROM ${quoteId(table)}`).all() as Row[]
        result.rows_read = rows.length
        result.rows_written = await upsertPg(remote, table, rows)
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error))
      }
      results.push(result)
    }
  } finally {
    await remote.close()
  }

  return results
}

export async function pullStorageChanges(tables: string[] = [...STORAGE_TABLES]): Promise<StorageSyncResult[]> {
  const db = getDatabase()
  const remote = await getStoragePg()
  const results: StorageSyncResult[] = []

  try {
    await runStorageMigrations(remote)
    for (const table of tables) {
      const result: StorageSyncResult = { table, direction: "pull", rows_read: 0, rows_written: 0, errors: [] }
      try {
        const rows = await remote.all(`SELECT * FROM ${quoteId(table)}`) as Row[]
        result.rows_read = rows.length
        result.rows_written = upsertSqlite(db, table, rows)
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error))
      }
      results.push(result)
    }
  } finally {
    await remote.close()
  }

  return results
}

export async function syncStorageChanges(tables: string[] = [...STORAGE_TABLES]): Promise<{ push: StorageSyncResult[]; pull: StorageSyncResult[] }> {
  return {
    push: await pushStorageChanges(tables),
    pull: await pullStorageChanges(tables),
  }
}

export function parseStorageTables(raw?: string): string[] {
  if (!raw) return [...STORAGE_TABLES]
  const requested = raw.split(",").map((table) => table.trim()).filter(Boolean)
  const allowed = new Set<string>(STORAGE_TABLES)
  const invalid = requested.filter((table) => !allowed.has(table))
  if (invalid.length > 0) throw new Error(`Unknown prompts storage table(s): ${invalid.join(", ")}`)
  return requested.length > 0 ? requested : [...STORAGE_TABLES]
}
