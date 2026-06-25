import type { DbAdapter } from '../db/storage-adapter.js'
import { PgAdapterAsync } from './remote-storage.js'

export interface SyncProgress {
  table: string
  phase: 'reading' | 'writing' | 'done'
  rowsRead: number
  rowsWritten: number
  totalTables: number
  currentTableIndex: number
}

export interface SyncOptions {
  tables: string[]
  onProgress?: (progress: SyncProgress) => void
  batchSize?: number
  conflictColumn?: string
  primaryKey?: string | string[]
}

export interface SyncResult {
  table: string
  rowsRead: number
  rowsWritten: number
  rowsSkipped: number
  errors: string[]
}

type Row = Record<string, any>
type Adapter = DbAdapter | PgAdapterAsync

export async function syncPush(local: DbAdapter, remote: PgAdapterAsync, options: SyncOptions): Promise<SyncResult[]> {
  const tables = await getTableOrder(remote, options.tables)
  return syncTransfer(local, remote, { ...options, tables }, 'push')
}

export async function syncPull(remote: PgAdapterAsync, local: DbAdapter, options: SyncOptions): Promise<SyncResult[]> {
  const tables = await getTableOrder(remote, options.tables)
  return syncTransfer(remote, local, { ...options, tables }, 'pull')
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

async function getTableOrder(remote: PgAdapterAsync, tables: string[]): Promise<string[]> {
  if (tables.length <= 1) return tables

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
    `) as Array<{ source_table: string; referenced_table: string }>
    if (rows.length > 0) return topoSort(tables, rows)
  } catch {
    // Fall back to the input order when information_schema is unavailable.
  }

  return tables
}

function topoSort(tables: string[], foreignKeys: Array<{ source_table: string; referenced_table: string }>): string[] {
  const allowed = new Set(tables)
  const deps = new Map<string, Set<string>>()
  for (const table of tables) deps.set(table, new Set())

  for (const fk of foreignKeys) {
    if (allowed.has(fk.source_table) && allowed.has(fk.referenced_table)) {
      deps.get(fk.source_table)?.add(fk.referenced_table)
    }
  }

  const sorted: string[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(table: string): void {
    if (visited.has(table)) return
    if (visiting.has(table)) {
      visited.add(table)
      sorted.push(table)
      return
    }

    visiting.add(table)
    for (const dep of deps.get(table) ?? []) visit(dep)
    visiting.delete(table)
    visited.add(table)
    sorted.push(table)
  }

  for (const table of tables) visit(table)
  return sorted
}

async function resolvePrimaryKeys(source: Adapter, target: Adapter, table: string, option?: string | string[]): Promise<string[]> {
  if (option) return Array.isArray(option) ? option : [option]
  const sourceKeys = await detectPrimaryKeys(source, table)
  if (sourceKeys.length > 0) return sourceKeys
  return detectPrimaryKeys(target, table)
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
          AND tc.table_name = ?
        ORDER BY kcu.ordinal_position
      `, table) as Array<{ column_name: string }>
      return rows.map(row => row.column_name)
    } catch {
      return []
    }
  }

  try {
    const rows = adapter.all(`PRAGMA table_info(${quoteIdent(table)})`) as Array<{ name: string; pk: number }>
    return rows.filter(row => row.pk > 0).sort((a, b) => a.pk - b.pk).map(row => row.name)
  } catch {
    return []
  }
}

async function ensureTablesExist(source: Adapter, target: Adapter, tables: string[]): Promise<void> {
  if (!isAsyncAdapter(source) || isAsyncAdapter(target)) return
  for (const table of tables) await ensureTableInSqliteFromPg(target, source, table)
}

async function ensureTableInSqliteFromPg(target: DbAdapter, source: PgAdapterAsync, table: string): Promise<void> {
  const existing = target.all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table)
  if (existing.length > 0) return

  const columns = await source.all(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ?
    ORDER BY ordinal_position
  `, table) as Array<{ column_name: string; data_type: string; is_nullable: string }>
  if (columns.length === 0) return

  const primaryKeys = new Set(await detectPrimaryKeys(source, table))
  const definitions = columns
    .filter(column => !['tsvector', 'tsquery'].includes(column.data_type.toLowerCase()))
    .map(column => {
      const type = pgTypeToSqlite(column.data_type)
      const notNull = column.is_nullable === 'NO' && !primaryKeys.has(column.column_name) ? ' NOT NULL' : ''
      return `${quoteIdent(column.column_name)} ${type}${notNull}`
    })

  if (primaryKeys.size > 0) {
    definitions.push(`PRIMARY KEY (${[...primaryKeys].map(quoteIdent).join(', ')})`)
  }

  target.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (${definitions.join(', ')})`)
}

function pgTypeToSqlite(pgType: string): string {
  const type = pgType.toLowerCase()
  if (type.includes('int') || ['bigint', 'smallint', 'serial', 'bigserial'].includes(type)) return 'INTEGER'
  if (type.includes('bool')) return 'INTEGER'
  if (type.includes('float') || type.includes('double') || ['real', 'numeric', 'decimal'].includes(type)) return 'REAL'
  if (type === 'bytea') return 'BLOB'
  return 'TEXT'
}

async function filterColumnsForTarget(target: Adapter, table: string, columns: string[]): Promise<string[]> {
  if (columns.includes('machine_id') && table !== 'machines') await ensureMachineIdColumnInTarget(target, table)

  try {
    if (isAsyncAdapter(target)) {
      const rows = await target.all(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ?
      `, table) as Array<{ column_name: string }>
      if (rows.length === 0) return columns
      const targetColumns = new Set(rows.map(row => row.column_name))
      return columns.filter(column => targetColumns.has(column))
    }

    const rows = target.all(`PRAGMA table_info(${quoteIdent(table)})`) as Array<{ name: string }>
    if (rows.length === 0) return columns
    const targetColumns = new Set(rows.map(row => row.name))
    return columns.filter(column => targetColumns.has(column))
  } catch {
    return columns
  }
}

async function ensureMachineIdColumnInTarget(target: Adapter, table: string): Promise<void> {
  if (isAsyncAdapter(target)) {
    const rows = await target.all(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ? AND column_name = 'machine_id'
    `, table)
    if (rows.length === 0) await target.exec(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN machine_id TEXT DEFAULT ''`)
    return
  }

  const rows = target.all(`PRAGMA table_info(${quoteIdent(table)})`) as Array<{ name: string }>
  if (!rows.some(row => row.name === 'machine_id')) {
    target.exec(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN machine_id TEXT DEFAULT ''`)
  }
}

async function syncTransfer(source: Adapter, target: Adapter, options: SyncOptions, _direction: 'push' | 'pull'): Promise<SyncResult[]> {
  const { tables, onProgress, batchSize = 100, conflictColumn = 'updated_at', primaryKey } = options
  const results: SyncResult[] = []
  const sqliteTarget = isAsyncAdapter(target) ? null : target

  await ensureTablesExist(source, target, tables)
  if (sqliteTarget) {
    try { sqliteTarget.exec('PRAGMA foreign_keys = OFF') } catch {}
  }

  try {
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i]!
      const result: SyncResult = { table, rowsRead: 0, rowsWritten: 0, rowsSkipped: 0, errors: [] }

      try {
        onProgress?.({ table, phase: 'reading', rowsRead: 0, rowsWritten: 0, totalTables: tables.length, currentTableIndex: i })

        const rows = await readAll(source, `SELECT * FROM ${quoteIdent(table)}`)
        result.rowsRead = rows.length
        if (rows.length === 0) {
          onProgress?.({ table, phase: 'done', rowsRead: 0, rowsWritten: 0, totalTables: tables.length, currentTableIndex: i })
          results.push(result)
          continue
        }

        const sourceColumns = Object.keys(rows[0]!)
        const columns = await filterColumnsForTarget(target, table, sourceColumns)
        const primaryKeys = await resolvePrimaryKeys(source, target, table, primaryKey)

        if (primaryKeys.length === 0) {
          result.errors.push(`Table "${table}" has no primary key; inserted without conflict handling`)
          for (const batch of batches(rows, batchSize)) {
            await insertBatch(target, table, columns, batch)
            result.rowsWritten += batch.length
          }
          results.push(result)
          continue
        }

        const missingKeys = primaryKeys.filter(key => !columns.includes(key))
        if (missingKeys.length > 0) {
          result.errors.push(`Table "${table}" missing primary key column(s): ${missingKeys.join(', ')}`)
          results.push(result)
          continue
        }

        onProgress?.({ table, phase: 'writing', rowsRead: result.rowsRead, rowsWritten: 0, totalTables: tables.length, currentTableIndex: i })
        const updateColumns = columns.filter(column => !primaryKeys.includes(column))
        const newestWinsColumn = columns.includes(conflictColumn) ? conflictColumn : undefined

        for (const batch of batches(rows, batchSize)) {
          await upsertBatch(target, table, columns, updateColumns, primaryKeys, batch, newestWinsColumn)
          result.rowsWritten += batch.length
          onProgress?.({ table, phase: 'writing', rowsRead: result.rowsRead, rowsWritten: result.rowsWritten, totalTables: tables.length, currentTableIndex: i })
        }

        onProgress?.({ table, phase: 'done', rowsRead: result.rowsRead, rowsWritten: result.rowsWritten, totalTables: tables.length, currentTableIndex: i })
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error))
      }

      results.push(result)
    }
  } finally {
    if (sqliteTarget) {
      try { sqliteTarget.exec('PRAGMA foreign_keys = ON') } catch {}
    }
  }

  return results
}

function batches(rows: Row[], size: number): Row[][] {
  const result: Row[][] = []
  for (let offset = 0; offset < rows.length; offset += size) result.push(rows.slice(offset, offset + size))
  return result
}

async function upsertBatch(
  target: Adapter,
  table: string,
  columns: string[],
  updateColumns: string[],
  primaryKeys: string[],
  batch: Row[],
  conflictColumn?: string,
): Promise<void> {
  if (batch.length === 0 || columns.length === 0) return
  const fallbackKey = primaryKeys[0] ?? columns[0] ?? 'id'
  const columnList = columns.map(quoteIdent).join(', ')
  const keyList = primaryKeys.map(quoteIdent).join(', ')
  const setClause = updateColumns.length > 0
    ? updateColumns.map(column => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(', ')
    : `${quoteIdent(fallbackKey)} = EXCLUDED.${quoteIdent(fallbackKey)}`
  const whereClause = conflictColumn && updateColumns.includes(conflictColumn)
    ? ` WHERE ${quoteIdent(table)}.${quoteIdent(conflictColumn)} IS NULL OR EXCLUDED.${quoteIdent(conflictColumn)} >= ${quoteIdent(table)}.${quoteIdent(conflictColumn)}`
    : ''

  if (isAsyncAdapter(target)) {
    const placeholders = batch
      .map((_, rowIndex) => `(${columns.map((__, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(', ')})`)
      .join(', ')
    const params = batch.flatMap(row => columns.map(column => row[column] ?? null))
    await target.run(
      `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES ${placeholders}
       ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}${whereClause}`,
      ...params,
    )
    return
  }

  const placeholders = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')
  const params = batch.flatMap(row => columns.map(column => coerceForSqlite(row[column])))
  target.run(
    `INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES ${placeholders}
     ON CONFLICT (${keyList}) DO UPDATE SET ${setClause}${whereClause}`,
    ...params,
  )
}

async function insertBatch(target: Adapter, table: string, columns: string[], batch: Row[]): Promise<void> {
  if (batch.length === 0 || columns.length === 0) return
  const columnList = columns.map(quoteIdent).join(', ')

  if (isAsyncAdapter(target)) {
    const placeholders = batch
      .map((_, rowIndex) => `(${columns.map((__, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(', ')})`)
      .join(', ')
    const params = batch.flatMap(row => columns.map(column => row[column] ?? null))
    await target.run(`INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES ${placeholders}`, ...params)
    return
  }

  const placeholders = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')
  const params = batch.flatMap(row => columns.map(column => coerceForSqlite(row[column])))
  target.run(`INSERT INTO ${quoteIdent(table)} (${columnList}) VALUES ${placeholders}`, ...params)
}

function coerceForSqlite(value: unknown): string | number | bigint | boolean | null | Uint8Array {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isAsyncAdapter(adapter: Adapter): adapter is PgAdapterAsync {
  return adapter instanceof PgAdapterAsync
}

async function readAll(adapter: Adapter, sql: string): Promise<Row[]> {
  const rows = adapter.all(sql)
  return (rows instanceof Promise ? await rows : rows) as Row[]
}
