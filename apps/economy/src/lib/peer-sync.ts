import { Database as BunDatabase } from 'bun:sqlite'
import type { Database } from '../db/database.js'
import { existsSync } from 'fs'
import { dedupeRequests } from '../db/database.js'
import { packageMetadata } from './package-metadata.js'

type Row = Record<string, string | number | null>
type QueryableDatabase = {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
    run(...params: unknown[]): { changes: number }
  }
}

export interface PeerTableMergeStats {
  table: string
  inserted: number
  updated: number
  skipped: number
  collisions: number
}

export interface PeerMergeResult {
  source_path: string
  source_machine: string
  rows_written: number
  collisions: number
  deduped: number
  tables: PeerTableMergeStats[]
}

const GENERIC_PEER_TABLES = [
  'usage_snapshots',
  'subscriptions',
  'billing_daily',
  'savings_daily',
  'budgets',
  'goals',
  'model_pricing',
  'machines',
] as const

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

function tableExists(db: QueryableDatabase, table: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as { name: string } | null
  return Boolean(row)
}

function tableColumns(db: QueryableDatabase, table: string): Array<{ name: string; pk: number }> {
  if (!tableExists(db, table)) return []
  return db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string; pk: number }>
}

function commonColumns(source: QueryableDatabase, target: QueryableDatabase, table: string): string[] {
  const sourceCols = new Set(tableColumns(source, table).map(c => c.name))
  return tableColumns(target, table)
    .map(c => c.name)
    .filter(c => sourceCols.has(c))
}

function primaryKeyColumns(db: QueryableDatabase, table: string): string[] {
  return tableColumns(db, table)
    .filter(c => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map(c => c.name)
}

function selectRows(source: QueryableDatabase, table: string, columns: string[]): Row[] {
  if (columns.length === 0) return []
  const select = columns.map(quoteIdent).join(', ')
  return source.prepare(`SELECT ${select} FROM ${quoteIdent(table)}`).all() as Row[]
}

function rowByKey(target: QueryableDatabase, table: string, keyColumns: string[], row: Row): Row | null {
  if (keyColumns.length === 0) return null
  if (keyColumns.some(c => row[c] == null)) return null
  const where = keyColumns.map(c => `${quoteIdent(c)} = ?`).join(' AND ')
  return target.prepare(`SELECT * FROM ${quoteIdent(table)} WHERE ${where}`).get(...keyColumns.map(c => row[c])) as Row | null
}

function hasId(target: QueryableDatabase, table: string, id: string): Row | null {
  return target.prepare(`SELECT id, machine_id FROM ${quoteIdent(table)} WHERE id = ?`).get(id) as Row | null
}

function shouldReplace(source: Row, existing: Row | null): boolean {
  if (!existing) return true
  const sourceUpdated = source['updated_at']
  const existingUpdated = existing['updated_at']
  if (typeof sourceUpdated === 'string' && typeof existingUpdated === 'string' && existingUpdated !== '') {
    return sourceUpdated >= existingUpdated
  }
  return true
}

function normalizeRow(row: Row, columns: string[], sourceMachine: string, now: string): Row {
  const next: Row = { ...row }
  if (columns.includes('machine_id') && (!next['machine_id'] || next['machine_id'] === '')) {
    next['machine_id'] = sourceMachine
  }
  if (columns.includes('updated_at') && (!next['updated_at'] || next['updated_at'] === '')) {
    next['updated_at'] = (next['timestamp'] ?? next['started_at'] ?? next['created_at'] ?? now) as string
  }
  if (columns.includes('synced_at') && next['synced_at'] == null) next['synced_at'] = ''
  if (columns.includes('attribution_tag') && next['attribution_tag'] == null) next['attribution_tag'] = ''
  return next
}

function insertOrReplace(target: Database, table: string, columns: string[], row: Row): void {
  const colSql = columns.map(quoteIdent).join(', ')
  const placeholders = columns.map(() => '?').join(', ')
  target.prepare(`
    INSERT OR REPLACE INTO ${quoteIdent(table)} (${colSql})
    VALUES (${placeholders})
  `).run(...columns.map(c => row[c] ?? null))
}

function collisionId(target: QueryableDatabase, table: string, machine: string, originalId: string): string {
  const base = `${machine || 'peer'}:${originalId}`
  const baseRow = hasId(target, table, base)
  if (!baseRow || String(baseRow['machine_id'] ?? '') === machine) return base

  for (let i = 2; ; i++) {
    const candidate = `${base}:${i}`
    const row = hasId(target, table, candidate)
    if (!row || String(row['machine_id'] ?? '') === machine) return candidate
  }
}

function mergeIdentityTable(
  target: Database,
  source: QueryableDatabase,
  table: 'sessions' | 'requests',
  sourceMachine: string,
  now: string,
  sessionIdMap?: Map<string, string>,
): { stats: PeerTableMergeStats; idMap: Map<string, string> } {
  const stats: PeerTableMergeStats = { table, inserted: 0, updated: 0, skipped: 0, collisions: 0 }
  const columns = commonColumns(source, target, table)
  const rows = selectRows(source, table, columns)
  const idMap = new Map<string, string>()

  for (const raw of rows) {
    const row = normalizeRow(raw, columns, sourceMachine, now)
    const originalId = String(row['id'] ?? '')
    if (!originalId) {
      stats.skipped++
      continue
    }

    const machine = String(row['machine_id'] ?? '')
    const directExisting = hasId(target, table, originalId)
    if (directExisting && String(directExisting['machine_id'] ?? '') !== machine) {
      row['id'] = collisionId(target, table, machine, originalId)
      stats.collisions++
    }

    if (table === 'requests' && sessionIdMap) {
      const originalSessionId = String(row['session_id'] ?? '')
      row['session_id'] = sessionIdMap.get(originalSessionId) ?? originalSessionId
    }

    const existing = hasId(target, table, String(row['id']))
    idMap.set(originalId, String(row['id']))
    if (existing && !shouldReplace(row, existing)) {
      stats.skipped++
      continue
    }

    insertOrReplace(target, table, columns, row)
    if (existing) stats.updated++
    else stats.inserted++
  }

  return { stats, idMap }
}

function mergeProjects(target: Database, source: QueryableDatabase): PeerTableMergeStats {
  const table = 'projects'
  const stats: PeerTableMergeStats = { table, inserted: 0, updated: 0, skipped: 0, collisions: 0 }
  const columns = commonColumns(source, target, table)
  const rows = selectRows(source, table, columns)

  for (const raw of rows) {
    const row: Row = { ...raw }
    const path = String(row['path'] ?? '')
    const id = String(row['id'] ?? '')
    if (!path || !id) {
      stats.skipped++
      continue
    }

    const existingByPath = target.prepare(`SELECT * FROM projects WHERE path = ?`).get(path) as Row | null
    if (existingByPath) {
      row['id'] = existingByPath['id'] ?? id
      insertOrReplace(target, table, columns, row)
      stats.updated++
      continue
    }

    const existingById = target.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as Row | null
    if (existingById && String(existingById['path'] ?? '') !== path) {
      row['id'] = `peer:${id}`
      stats.collisions++
      while (target.prepare(`SELECT id FROM projects WHERE id = ?`).get(row['id'])) {
        row['id'] = `peer:${String(row['id'])}`
      }
    }

    insertOrReplace(target, table, columns, row)
    stats.inserted++
  }

  return stats
}

function mergeGenericTable(target: Database, source: QueryableDatabase, table: string, sourceMachine: string, now: string): PeerTableMergeStats {
  const stats: PeerTableMergeStats = { table, inserted: 0, updated: 0, skipped: 0, collisions: 0 }
  const columns = commonColumns(source, target, table)
  const keyColumns = primaryKeyColumns(target, table).filter(c => columns.includes(c))
  const rows = selectRows(source, table, columns)

  for (const raw of rows) {
    const row = normalizeRow(raw, columns, sourceMachine, now)
    const existing = rowByKey(target, table, keyColumns, row)
    if (existing && !shouldReplace(row, existing)) {
      stats.skipped++
      continue
    }

    insertOrReplace(target, table, columns, row)
    if (existing) stats.updated++
    else stats.inserted++
  }

  return stats
}

function detectSourceMachine(source: QueryableDatabase, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback.trim()

  const counts = new Map<string, number>()
  for (const table of ['sessions', 'requests', 'usage_snapshots']) {
    if (!tableExists(source, table)) continue
    const rows = source.prepare(`
      SELECT machine_id, COUNT(*) as cnt
      FROM ${quoteIdent(table)}
      WHERE machine_id != '' AND machine_id IS NOT NULL
      GROUP BY machine_id
    `).all() as Array<{ machine_id: string; cnt: number }>
    for (const row of rows) {
      counts.set(row.machine_id, (counts.get(row.machine_id) ?? 0) + row.cnt)
    }
  }

  let best = ''
  let bestCount = -1
  for (const [machine, count] of counts.entries()) {
    if (count > bestCount) {
      best = machine
      bestCount = count
    }
  }
  return best || 'peer'
}

function ensureMachineRegistry(target: Database, machine: string, now: string): void {
  if (!machine) return
  target.prepare(`
    INSERT INTO machines (machine_id, hostname, last_seen_at, last_push_at, last_pull_at, economy_version, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(machine_id) DO UPDATE SET
      hostname = COALESCE(NULLIF(machines.hostname, ''), excluded.hostname),
      last_seen_at = CASE
        WHEN machines.last_seen_at IS NULL OR machines.last_seen_at < excluded.last_seen_at THEN excluded.last_seen_at
        ELSE machines.last_seen_at
      END,
      last_pull_at = excluded.last_pull_at,
      economy_version = excluded.economy_version,
      updated_at = excluded.updated_at
  `).run(machine, machine, now, now, packageMetadata.version, now)
}

function openSourceDatabase(path: string): BunDatabase {
  try {
    return new BunDatabase(path, { readonly: true })
  } catch {
    return new BunDatabase(path)
  }
}

export function mergePeerDatabase(
  target: Database,
  sourcePath: string,
  opts: { sourceMachine?: string; now?: string } = {},
): PeerMergeResult {
  if (!existsSync(sourcePath)) throw new Error(`source database does not exist: ${sourcePath}`)

  const source = openSourceDatabase(sourcePath)
  const now = opts.now ?? new Date().toISOString()
  const sourceMachine = detectSourceMachine(source, opts.sourceMachine)
  const tables: PeerTableMergeStats[] = []

  try {
    target.exec('PRAGMA foreign_keys = OFF')
    target.exec('BEGIN IMMEDIATE')
    try {
      tables.push(mergeProjects(target, source))
      const sessionMerge = mergeIdentityTable(target, source, 'sessions', sourceMachine, now)
      tables.push(sessionMerge.stats)
      tables.push(mergeIdentityTable(target, source, 'requests', sourceMachine, now, sessionMerge.idMap).stats)
      for (const table of GENERIC_PEER_TABLES) {
        tables.push(mergeGenericTable(target, source, table, sourceMachine, now))
      }
      ensureMachineRegistry(target, sourceMachine, now)
      target.exec('COMMIT')
    } catch (err) {
      target.exec('ROLLBACK')
      throw err
    } finally {
      target.exec('PRAGMA foreign_keys = ON')
    }
  } finally {
    source.close()
  }

  const deduped = dedupeRequests(target)
  const rowsWritten = tables.reduce((sum, table) => sum + table.inserted + table.updated, 0)
  const collisions = tables.reduce((sum, table) => sum + table.collisions, 0)
  return {
    source_path: sourcePath,
    source_machine: sourceMachine,
    rows_written: rowsWritten,
    collisions,
    deduped,
    tables: tables.filter(t => t.inserted || t.updated || t.skipped || t.collisions),
  }
}
