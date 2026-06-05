import type { SqliteAdapter as Database } from '@hasna/cloud'
import { getDbPath, getMachineId, openDatabase } from '../db/database.js'
import { packageMetadata } from './package-metadata.js'

export const CLOUD_TABLES = [
  'requests',
  'sessions',
  'projects',
  'budgets',
  'goals',
  'model_pricing',
  'billing_daily',
  'subscriptions',
  'usage_snapshots',
  'savings_daily',
  'machines',
  'ingest_state',
] as const

export function getCloudDatabaseUrl(): string | null {
  return process.env['ECONOMY_CLOUD_DATABASE_URL']
    ?? process.env['HASNA_ECONOMY_CLOUD_DATABASE_URL']
    ?? null
}

export function isCloudAutoEnabled(): boolean {
  return process.env['ECONOMY_CLOUD_AUTO'] === '1'
    || process.env['ECONOMY_CLOUD_AUTO'] === 'true'
}

export function getCloudPullIntervalMinutes(): number {
  const raw = process.env['ECONOMY_CLOUD_PULL_INTERVAL']
  if (!raw) return 15
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 15
}

export async function getCloudPg() {
  const url = getCloudDatabaseUrl()
  if (!url) {
    throw new Error('Missing ECONOMY_CLOUD_DATABASE_URL (or HASNA_ECONOMY_CLOUD_DATABASE_URL)')
  }
  const { PgAdapterAsync } = await import('@hasna/cloud')
  return new PgAdapterAsync(url)
}

export async function runCloudMigrations(cloud: { run: (sql: string) => Promise<unknown> }): Promise<void> {
  const { PG_MIGRATIONS } = await import('../db/pg-migrations.js')
  for (const sql of PG_MIGRATIONS) {
    await cloud.run(sql)
  }
}

export function isCloudIncrementalEnabled(): boolean {
  return process.env['ECONOMY_CLOUD_INCREMENTAL'] === '1'
    || process.env['ECONOMY_CLOUD_INCREMENTAL'] === 'true'
}

export async function cloudPush(opts?: { tables?: string[] }): Promise<{ rows: number; machine: string }> {
  const { syncPush, SqliteAdapter } = await import('@hasna/cloud')
  const cloud = await getCloudPg()
  const local = new SqliteAdapter(getDbPath())
  await runCloudMigrations(cloud)
  const tables = opts?.tables ?? [...CLOUD_TABLES]
  const results = await syncPush(local, cloud, { tables, conflictColumn: 'updated_at' }) as Array<{ rowsWritten: number }>
  const rows = results.reduce((s, r) => s + r.rowsWritten, 0)
  touchMachineRegistry(local, 'push')
  local.close()
  await cloud.close()
  return { rows, machine: getMachineId() }
}

export async function cloudPull(opts?: { tables?: string[] }): Promise<{ rows: number; machine: string }> {
  const { syncPull, SqliteAdapter } = await import('@hasna/cloud')
  const cloud = await getCloudPg()
  const local = new SqliteAdapter(getDbPath())
  await runCloudMigrations(cloud)
  const tables = opts?.tables ?? [...CLOUD_TABLES]
  const results = await syncPull(cloud, local, { tables, conflictColumn: 'updated_at' }) as Array<{ rowsWritten: number }>
  const rows = results.reduce((s, r) => s + r.rowsWritten, 0)
  touchMachineRegistry(local, 'pull')
  local.close()
  await cloud.close()
  setLastCloudPull()
  return { rows, machine: getMachineId() }
}

export async function cloudSyncFull(): Promise<{ push: number; pull: number; machine: string }> {
  const push = await cloudPush()
  const pull = await cloudPull()
  return { push: push.rows, pull: pull.rows, machine: getMachineId() }
}

export function setLastCloudPull(at = new Date().toISOString()): void {
  const db = openDatabase()
  db.prepare(`INSERT OR REPLACE INTO ingest_state (source, key, value) VALUES ('cloud', 'last_pull_at', ?)`).run(at)
}

export function getLastCloudPull(): string | null {
  const db = openDatabase()
  const row = db.prepare(`SELECT value FROM ingest_state WHERE source = 'cloud' AND key = 'last_pull_at'`).get() as { value: string } | null
  return row?.value ?? null
}

export function shouldPullFromCloud(): boolean {
  if (!getCloudDatabaseUrl()) return false
  const last = getLastCloudPull()
  if (!last) return true
  const ageMs = Date.now() - new Date(last).getTime()
  return ageMs > getCloudPullIntervalMinutes() * 60_000
}

export async function maybePullFromCloud(): Promise<boolean> {
  if (!shouldPullFromCloud()) return false
  try {
    await cloudPull()
    return true
  } catch {
    return false
  }
}

export async function maybePushAfterIngest(): Promise<boolean> {
  if (!isCloudAutoEnabled() || !getCloudDatabaseUrl()) return false
  try {
    await cloudPush()
    return true
  } catch {
    return false
  }
}

function touchMachineRegistry(db: Database, direction: 'push' | 'pull'): void {
  const now = new Date().toISOString()
  const machine = getMachineId()
  db.prepare(`
    INSERT INTO machines (machine_id, hostname, last_seen_at, last_push_at, last_pull_at, economy_version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(machine_id) DO UPDATE SET
      hostname = excluded.hostname,
      last_seen_at = excluded.last_seen_at,
      last_push_at = CASE WHEN ? = 'push' THEN excluded.last_push_at ELSE machines.last_push_at END,
      last_pull_at = CASE WHEN ? = 'pull' THEN excluded.last_pull_at ELSE machines.last_pull_at END,
      economy_version = excluded.economy_version,
      updated_at = excluded.updated_at
  `).run(
    machine,
    machine,
    now,
    direction === 'push' ? now : null,
    direction === 'pull' ? now : null,
    packageMetadata.version,
    now,
    direction,
    direction,
  )
}

export async function registerCloudSchedule(intervalMinutes: number): Promise<void> {
  const { registerSyncSchedule } = await import('@hasna/cloud')
  await registerSyncSchedule(intervalMinutes)
}

export async function removeCloudSchedule(): Promise<void> {
  const { removeSyncSchedule } = await import('@hasna/cloud')
  await removeSyncSchedule()
}

export async function getCloudScheduleStatus() {
  const { getSyncScheduleStatus } = await import('@hasna/cloud')
  return getSyncScheduleStatus()
}
