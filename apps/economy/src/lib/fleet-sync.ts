import { Database as BunDatabase } from 'bun:sqlite'
import { existsSync, mkdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import { randomUUID } from 'crypto'
import type { Database, MachineInfo } from '../db/database.js'
import { listMachineRegistry, listMachines, queryAgentBreakdown, querySummary } from '../db/database.js'
import type { MachineRegistry, Period } from '../types/index.js'
import { mergePeerDatabase, type PeerMergeResult } from './peer-sync.js'

const DEFAULT_SNAPSHOT_DIR = join(homedir(), '.hasna', 'economy', 'fleet-snapshots')
export const MAX_FLEET_PREVIEW_TABLES = 100
export const MAX_FLEET_FRESHNESS_ROWS = 100
export const MAX_FLEET_INSIGHT_ROWS = 50
const PREVIEW_TABLES = [
  'sessions',
  'requests',
  'usage_snapshots',
  'billing_daily',
  'savings_daily',
  'machines',
] as const

export interface FleetTablePreview {
  table: string
  rows: number
}

export interface FleetIntegrityCheck {
  ok: boolean
  result: string
  checked_at: string
}

export interface FleetSnapshotInfo {
  path: string
  path_ref: string
  bytes: number
  created_at: string
  integrity: FleetIntegrityCheck
}

export interface FleetPeerSyncResult {
  schema_version: 1
  dry_run: boolean
  source: {
    path_ref: string
    machine_id: string
  }
  snapshot: FleetSnapshotInfo
  preview: {
    tables: FleetTablePreview[]
    total_rows: number
  }
  merge: PeerMergeResult | null
  warnings: string[]
  hints: string[]
}

export interface PublicFleetPeerSyncResult extends Omit<FleetPeerSyncResult, 'snapshot' | 'merge'> {
  snapshot: Omit<FleetSnapshotInfo, 'path'>
  merge: (Omit<PeerMergeResult, 'source_path'> & { source_path_ref: string }) | null
}

export interface FleetFreshnessRow {
  machine_id: string
  status: 'fresh' | 'stale' | 'unknown'
  age_minutes: number | null
  last_seen_at: string | null
  last_push_at: string | null
  last_pull_at: string | null
  last_active_at: string | null
  sessions: number
  requests: number
  cost_usd: number
}

export interface FleetFreshnessResult {
  schema_version: 1
  generated_at: string
  stale_after_minutes: number
  total_machines: number
  returned_machines: number
  stale_machines: number
  unknown_machines: number
  truncated: boolean
  rows: FleetFreshnessRow[]
  hints: string[]
}

export interface FleetCostInsightsResult {
  schema_version: 1
  generated_at: string
  period: Period
  summary: {
    total_usd: number
    sessions: number
    requests: number
    tokens: number
  }
  top_machines: Array<{
    machine_id: string
    cost_usd: number
    sessions: number
    requests: number
    last_active_at: string | null
  }>
  top_agents: Array<{
    agent: string
    cost_usd: number
    requests: number
    tokens: number
  }>
  top_models: Array<{
    model: string
    agent: string
    cost_usd: number
    requests: number
    tokens: number
  }>
  freshness: Pick<FleetFreshnessResult, 'stale_after_minutes' | 'total_machines' | 'stale_machines' | 'unknown_machines'>
  quality: {
    zero_cost_token_requests: number
    unattributed_machine_requests: number
  }
  hints: string[]
}

export interface FleetPeerSyncOptions {
  apply?: boolean
  sourceMachine?: string
  snapshotDir?: string
  now?: string
  limit?: number
}

export interface FleetFreshnessOptions {
  now?: string
  staleAfterMinutes?: number
  limit?: number
}

export interface FleetCostInsightsOptions extends FleetFreshnessOptions {
  period?: Period
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

function publicPathRef(path: string): string {
  const home = homedir()
  if (path.startsWith(home)) return `~${path.slice(home.length)}`
  return basename(path)
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'peer'
}

function minuteAge(at: string | null, nowMs: number): number | null {
  if (!at) return null
  const parsed = Date.parse(at)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.floor((nowMs - parsed) / 60_000))
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  const resolved = Number.isFinite(value) && value != null ? Math.floor(value) : fallback
  return Math.max(1, Math.min(resolved, max))
}

function requestPeriodWhere(period: Period): string {
  switch (period) {
    case 'today': return `DATE(timestamp) = DATE('now')`
    case 'yesterday': return `DATE(timestamp) = DATE('now', '-1 day')`
    case 'week': return `timestamp >= DATE('now', 'weekday 0', '-7 days')`
    case 'month': return `timestamp >= DATE('now', 'start of month')`
    case 'year': return `timestamp >= DATE('now', 'start of year')`
    case 'all': return '1=1'
  }
}

function maxIso(values: Array<string | null | undefined>): string | null {
  const filtered = values.filter((value): value is string => Boolean(value))
  if (filtered.length === 0) return null
  return filtered.sort().at(-1) ?? null
}

function openReadonly(path: string): BunDatabase {
  return new BunDatabase(path, { readonly: true })
}

function tableExists(db: BunDatabase, table: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as { name: string } | null
  return Boolean(row)
}

function integrityCheck(path: string, checkedAt: string): FleetIntegrityCheck {
  const db = openReadonly(path)
  try {
    const row = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>
    const result = String(Object.values(row)[0] ?? '')
    return { ok: result === 'ok', result, checked_at: checkedAt }
  } finally {
    db.close()
  }
}

function detectSourceMachine(path: string, fallback?: string): string {
  const trimmed = fallback?.trim()
  if (trimmed) return trimmed

  const db = openReadonly(path)
  try {
    const counts = new Map<string, number>()
    for (const table of ['sessions', 'requests', 'usage_snapshots']) {
      if (!tableExists(db, table)) continue
      const rows = db.prepare(`
        SELECT machine_id, COUNT(*) as cnt
        FROM ${quoteIdent(table)}
        WHERE machine_id != '' AND machine_id IS NOT NULL
        GROUP BY machine_id
      `).all() as Array<{ machine_id: string; cnt: number }>
      for (const row of rows) counts.set(row.machine_id, (counts.get(row.machine_id) ?? 0) + row.cnt)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'peer'
  } finally {
    db.close()
  }
}

function previewSnapshot(path: string, limit: number): { tables: FleetTablePreview[]; total_rows: number } {
  const db = openReadonly(path)
  try {
    const tables: FleetTablePreview[] = []
    for (const table of PREVIEW_TABLES) {
      if (!tableExists(db, table)) continue
      const row = db.prepare(`SELECT COUNT(*) as rows FROM ${quoteIdent(table)}`).get() as { rows: number }
      tables.push({ table, rows: row.rows })
    }
    const sorted = tables.sort((a, b) => b.rows - a.rows || a.table.localeCompare(b.table))
    return {
      tables: sorted.slice(0, limit),
      total_rows: sorted.reduce((sum, table) => sum + table.rows, 0),
    }
  } finally {
    db.close()
  }
}

function snapshotSqlite(sourcePath: string, snapshotDir: string, sourceMachine: string, now: string): FleetSnapshotInfo {
  if (!existsSync(sourcePath)) throw new Error(`source database does not exist: ${sourcePath}`)
  mkdirSync(snapshotDir, { recursive: true })

  const source = openReadonly(sourcePath)
  const stamp = now.replace(/[:.]/g, '-')
  const snapshotPath = join(snapshotDir, `${stamp}-${safeName(sourceMachine)}-${randomUUID().slice(0, 8)}-${safeName(basename(sourcePath))}`)
  try {
    source.prepare('VACUUM INTO ?').run(snapshotPath)
  } finally {
    source.close()
  }

  const integrity = integrityCheck(snapshotPath, now)
  if (!integrity.ok) {
    throw new Error(`snapshot integrity check failed: ${integrity.result}`)
  }

  return {
    path: snapshotPath,
    path_ref: publicPathRef(snapshotPath),
    bytes: statSync(snapshotPath).size,
    created_at: now,
    integrity,
  }
}

export function syncFleetPeerSqlite(
  target: Database,
  sourcePath: string,
  opts: FleetPeerSyncOptions = {},
): FleetPeerSyncResult {
  const now = opts.now ?? new Date().toISOString()
  const resolvedSource = resolve(sourcePath)
  const sourceMachine = detectSourceMachine(resolvedSource, opts.sourceMachine)
  const snapshot = snapshotSqlite(resolvedSource, opts.snapshotDir ?? DEFAULT_SNAPSHOT_DIR, sourceMachine, now)
  const preview = previewSnapshot(snapshot.path, clampLimit(opts.limit, 10, MAX_FLEET_PREVIEW_TABLES))
  const warnings: string[] = []
  const hints: string[] = []

  if (sourceMachine === 'peer') warnings.push('source_machine_unknown')
  if (!opts.apply) hints.push('dry_run: rerun with --apply to merge this verified snapshot')

  const merge = opts.apply
    ? mergePeerDatabase(target, snapshot.path, { sourceMachine, now })
    : null

  if (merge) hints.push('idempotent: repeated syncs keep newest updated_at rows and remap cross-machine id collisions')

  return {
    schema_version: 1,
    dry_run: !opts.apply,
    source: {
      path_ref: publicPathRef(resolvedSource),
      machine_id: sourceMachine,
    },
    snapshot,
    preview,
    merge,
    warnings,
    hints,
  }
}

export function publicFleetPeerSyncResult(result: FleetPeerSyncResult): PublicFleetPeerSyncResult {
  const { path: _path, ...snapshot } = result.snapshot
  let merge: PublicFleetPeerSyncResult['merge'] = null
  if (result.merge) {
    const { source_path, ...rest } = result.merge
    merge = { ...rest, source_path_ref: publicPathRef(source_path) }
  }
  return {
    ...result,
    snapshot,
    merge,
  }
}

function machineRow(
  machineId: string,
  registry: MachineRegistry | undefined,
  machine: MachineInfo | undefined,
  nowMs: number,
  staleAfterMinutes: number,
): FleetFreshnessRow {
  const lastSeenAt = maxIso([registry?.last_seen_at, registry?.updated_at])
  const lastActiveAt = machine?.last_active ?? null
  const latest = maxIso([lastSeenAt, registry?.last_push_at, registry?.last_pull_at, lastActiveAt])
  const age = minuteAge(latest, nowMs)
  const status = age == null ? 'unknown' : age > staleAfterMinutes ? 'stale' : 'fresh'

  return {
    machine_id: machineId,
    status,
    age_minutes: age,
    last_seen_at: lastSeenAt,
    last_push_at: registry?.last_push_at ?? null,
    last_pull_at: registry?.last_pull_at ?? null,
    last_active_at: lastActiveAt,
    sessions: machine?.sessions ?? 0,
    requests: machine?.requests ?? 0,
    cost_usd: machine?.total_cost_usd ?? 0,
  }
}

export function buildFleetFreshness(db: Database, opts: FleetFreshnessOptions = {}): FleetFreshnessResult {
  const generatedAt = opts.now ?? new Date().toISOString()
  const staleAfterMinutes = opts.staleAfterMinutes ?? 60
  const limit = clampLimit(opts.limit, 20, MAX_FLEET_FRESHNESS_ROWS)
  const nowMs = Date.parse(generatedAt)
  const registry = new Map(listMachineRegistry(db).map(row => [row.machine_id, row]))
  const machines = new Map(listMachines(db, 'all').map(row => [row.machine_id, row]))
  const ids = [...new Set([...registry.keys(), ...machines.keys()])].sort()

  const rows = ids
    .map(id => machineRow(id, registry.get(id), machines.get(id), nowMs, staleAfterMinutes))
    .sort((a, b) => {
      const statusRank = (row: FleetFreshnessRow) => row.status === 'stale' ? 0 : row.status === 'unknown' ? 1 : 2
      return statusRank(a) - statusRank(b)
        || (b.age_minutes ?? -1) - (a.age_minutes ?? -1)
        || b.cost_usd - a.cost_usd
        || a.machine_id.localeCompare(b.machine_id)
    })

  const staleMachines = rows.filter(row => row.status === 'stale').length
  const unknownMachines = rows.filter(row => row.status === 'unknown').length
  const hints: string[] = []
  if (staleMachines > 0) hints.push('stale machines: run economy fleet sync --source <mounted-peer-db> --apply')
  if (rows.length === 0) hints.push('no fleet rows: run economy sync --backfill-machine before fleet reporting')

  return {
    schema_version: 1,
    generated_at: generatedAt,
    stale_after_minutes: staleAfterMinutes,
    total_machines: rows.length,
    returned_machines: Math.min(rows.length, limit),
    stale_machines: staleMachines,
    unknown_machines: unknownMachines,
    truncated: rows.length > limit,
    rows: rows.slice(0, limit),
    hints,
  }
}

export function buildFleetCostInsights(db: Database, opts: FleetCostInsightsOptions = {}): FleetCostInsightsResult {
  const generatedAt = opts.now ?? new Date().toISOString()
  const period = opts.period ?? 'today'
  const limit = clampLimit(opts.limit, 5, MAX_FLEET_INSIGHT_ROWS)
  const summary = querySummary(db, period, undefined, true)
  const freshness = buildFleetFreshness(db, {
    now: generatedAt,
    staleAfterMinutes: opts.staleAfterMinutes,
    limit,
  })
  const topMachines = listMachines(db, period)
    .slice(0, limit)
    .map(row => ({
      machine_id: row.machine_id,
      cost_usd: row.total_cost_usd,
      sessions: row.sessions,
      requests: row.requests,
      last_active_at: row.last_active ?? null,
    }))
  const topAgents = queryAgentBreakdown(db, period)
    .slice(0, limit)
    .map(row => ({
      agent: row.agent,
      cost_usd: row.cost_usd,
      requests: row.requests,
      tokens: row.total_tokens,
    }))
  const topModels = queryTopModelsForPeriod(db, period, limit)
    .slice(0, limit)
    .map(row => ({
      model: row.model,
      agent: row.agent,
      cost_usd: row.cost_usd,
      requests: row.requests,
      tokens: row.total_tokens,
    }))
  const zeroCost = db.prepare(`
    SELECT COUNT(*) as count
    FROM requests
    WHERE cost_usd = 0 AND (input_tokens > 0 OR output_tokens > 0 OR cache_read_tokens > 0 OR cache_create_tokens > 0)
  `).get() as { count: number }
  const unattributed = db.prepare(`
    SELECT COUNT(*) as count
    FROM requests
    WHERE machine_id IS NULL OR machine_id = ''
  `).get() as { count: number }

  const hints: string[] = []
  if (zeroCost.count > 0) hints.push('zero-cost token rows: run economy sync --recalculate and verify pricing')
  if (unattributed.count > 0) hints.push('missing machine attribution: run economy sync --backfill-machine')
  hints.push(...freshness.hints)

  return {
    schema_version: 1,
    generated_at: generatedAt,
    period,
    summary: {
      total_usd: summary.total_usd,
      sessions: summary.sessions,
      requests: summary.requests,
      tokens: summary.tokens,
    },
    top_machines: topMachines,
    top_agents: topAgents,
    top_models: topModels,
    freshness: {
      stale_after_minutes: freshness.stale_after_minutes,
      total_machines: freshness.total_machines,
      stale_machines: freshness.stale_machines,
      unknown_machines: freshness.unknown_machines,
    },
    quality: {
      zero_cost_token_requests: zeroCost.count,
      unattributed_machine_requests: unattributed.count,
    },
    hints,
  }
}

function queryTopModelsForPeriod(db: Database, period: Period, limit: number): Array<{ model: string; agent: string; requests: number; total_tokens: number; cost_usd: number }> {
  const where = requestPeriodWhere(period)
  return db.prepare(`
    SELECT model, agent,
           COUNT(*) as requests,
           COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens), 0) as total_tokens,
           COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM requests
    WHERE ${where}
    GROUP BY model, agent
    ORDER BY cost_usd DESC
    LIMIT ?
  `).all(limit) as Array<{ model: string; agent: string; requests: number; total_tokens: number; cost_usd: number }>
}
