import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { homedir, platform } from 'os'
import { dirname, join } from 'path'
import type { Database } from '../db/database.js'
import { getDbPath, getMachineId, openDatabase } from '../db/database.js'
import { packageMetadata } from './package-metadata.js'
import { PgAdapterAsync } from './remote-storage.js'
import { syncPull, syncPush } from './storage-sync.js'

export const ECONOMY_STORAGE_TABLES = [
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
] as const

export const STORAGE_SYNC_TABLES = ECONOMY_STORAGE_TABLES
export const STORAGE_TABLES = ECONOMY_STORAGE_TABLES

export type EconomyStorageTable = (typeof ECONOMY_STORAGE_TABLES)[number]
export type EconomyStorageMode = 'local' | 'remote' | 'hybrid'

export const ECONOMY_STORAGE_ENV = {
  mode: 'HASNA_ECONOMY_STORAGE_MODE',
  databaseUrl: 'HASNA_ECONOMY_DATABASE_URL',
  syncAuto: 'HASNA_ECONOMY_SYNC_AUTO',
  syncPullInterval: 'HASNA_ECONOMY_SYNC_PULL_INTERVAL',
  syncIncremental: 'HASNA_ECONOMY_SYNC_INCREMENTAL',
} as const

export const ECONOMY_STORAGE_FALLBACK_ENV = {
  mode: 'ECONOMY_STORAGE_MODE',
  databaseUrl: 'ECONOMY_DATABASE_URL',
  syncAuto: 'ECONOMY_SYNC_AUTO',
  syncPullInterval: 'ECONOMY_SYNC_PULL_INTERVAL',
  syncIncremental: 'ECONOMY_SYNC_INCREMENTAL',
} as const

export const CANONICAL_ECONOMY_RDS_CLUSTER = 'hasna-xyz-infra-apps-prod-postgres'
export const CANONICAL_ECONOMY_RDS_DATABASE = 'economy'
export const CANONICAL_ECONOMY_RDS_RUNTIME_PATH = 'hasna/xyz/opensource/economy/prod/rds'

export interface CanonicalEconomyRdsConfig {
  cluster: typeof CANONICAL_ECONOMY_RDS_CLUSTER
  database: typeof CANONICAL_ECONOMY_RDS_DATABASE
  runtimeSecretPath: typeof CANONICAL_ECONOMY_RDS_RUNTIME_PATH
  primaryEnv: typeof ECONOMY_STORAGE_ENV.databaseUrl
  fallbackEnv: typeof ECONOMY_STORAGE_FALLBACK_ENV.databaseUrl
}

type EconomyStorageEnvKey = keyof typeof ECONOMY_STORAGE_ENV
type EnvSource = Record<string, string | undefined>

export function getCanonicalEconomyRdsConfig(): CanonicalEconomyRdsConfig {
  return {
    cluster: CANONICAL_ECONOMY_RDS_CLUSTER,
    database: CANONICAL_ECONOMY_RDS_DATABASE,
    runtimeSecretPath: CANONICAL_ECONOMY_RDS_RUNTIME_PATH,
    primaryEnv: ECONOMY_STORAGE_ENV.databaseUrl,
    fallbackEnv: ECONOMY_STORAGE_FALLBACK_ENV.databaseUrl,
  }
}

function readStorageEnv(key: EconomyStorageEnvKey, env: EnvSource = process.env): string | undefined {
  const canonical = env[ECONOMY_STORAGE_ENV[key]]
  if (canonical != null && canonical !== '') return canonical
  const fallback = env[ECONOMY_STORAGE_FALLBACK_ENV[key]]
  if (fallback != null && fallback !== '') return fallback
  return undefined
}

function isTruthyStorageEnv(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

export function getStorageMode(env: EnvSource = process.env): EconomyStorageMode {
  const raw = readStorageEnv('mode', env)?.trim().toLowerCase()
  if (raw === 'local' || raw === 'remote' || raw === 'hybrid') return raw
  return getStorageDatabaseUrl(env) ? 'remote' : 'local'
}

export const getEconomyStorageMode = getStorageMode

export function getStorageEnvName(key: EconomyStorageEnvKey, env: EnvSource = process.env): string {
  const canonical = ECONOMY_STORAGE_ENV[key]
  const fallback = ECONOMY_STORAGE_FALLBACK_ENV[key]
  const hasCanonical = env[canonical] != null && env[canonical] !== ''
  const hasFallback = env[fallback] != null && env[fallback] !== ''
  return hasCanonical || !hasFallback ? canonical : fallback
}

export function getStorageDatabaseEnv(env: EnvSource = process.env): string {
  return getStorageEnvName('databaseUrl', env)
}

export const getEconomyStorageDatabaseEnv = getStorageDatabaseEnv

export function getStorageDatabaseUrl(env: EnvSource = process.env): string | null {
  return readStorageEnv('databaseUrl', env) ?? null
}

export const getEconomyStorageDatabaseUrl = getStorageDatabaseUrl

function redactDatabaseUrl(value: string | null): string | null {
  return value?.replace(/:[^:@/]+@/, ':***@') ?? null
}

export interface EconomyStorageEnvStatus {
  name: string
  active_name: string
  configured: boolean
}

export interface EconomyStorageStatus {
  ok: boolean
  service: 'economy'
  mode: EconomyStorageMode
  local_default: boolean
  remote_enabled: boolean
  database: {
    configured: boolean
    redacted_url: string | null
  }
  tables: readonly EconomyStorageTable[]
  env: {
    mode: EconomyStorageEnvStatus
    databaseUrl: EconomyStorageEnvStatus
    syncAuto: EconomyStorageEnvStatus
    syncPullInterval: EconomyStorageEnvStatus
    syncIncremental: EconomyStorageEnvStatus
  }
  canonical: CanonicalEconomyRdsConfig
  issues: string[]
  warnings: string[]
  no_network: true
}

function storageEnvStatus(key: EconomyStorageEnvKey, env: EnvSource): EconomyStorageEnvStatus {
  const activeName = getStorageEnvName(key, env)
  return {
    name: ECONOMY_STORAGE_ENV[key],
    active_name: activeName,
    configured: env[activeName] != null && env[activeName] !== '',
  }
}

export function getStorageStatus(env: EnvSource = process.env): EconomyStorageStatus {
  const databaseUrl = getStorageDatabaseUrl(env)
  const mode = getStorageMode(env)
  const issues: string[] = []
  if ((mode === 'remote' || mode === 'hybrid') && !databaseUrl) {
    issues.push(`Missing ${ECONOMY_STORAGE_ENV.databaseUrl}`)
  }

  return {
    ok: issues.length === 0,
    service: 'economy',
    mode,
    local_default: mode === 'local',
    remote_enabled: mode === 'remote' || mode === 'hybrid',
    database: {
      configured: Boolean(databaseUrl),
      redacted_url: redactDatabaseUrl(databaseUrl),
    },
    tables: ECONOMY_STORAGE_TABLES,
    env: {
      mode: storageEnvStatus('mode', env),
      databaseUrl: storageEnvStatus('databaseUrl', env),
      syncAuto: storageEnvStatus('syncAuto', env),
      syncPullInterval: storageEnvStatus('syncPullInterval', env),
      syncIncremental: storageEnvStatus('syncIncremental', env),
    },
    canonical: getCanonicalEconomyRdsConfig(),
    issues,
    warnings: [],
    no_network: true,
  }
}

export const getEconomyStorageStatus = getStorageStatus

export function isStorageAutoEnabled(): boolean {
  return isTruthyStorageEnv(readStorageEnv('syncAuto'))
}

export function getStoragePullIntervalMinutes(): number {
  const raw = readStorageEnv('syncPullInterval')
  if (!raw) return 15
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 15
}

export async function getStoragePg() {
  const url = getStorageDatabaseUrl()
  if (!url) {
    throw new Error('Missing HASNA_ECONOMY_DATABASE_URL')
  }
  return new PgAdapterAsync(url)
}

export async function runStorageMigrations(remote: { run: (sql: string) => Promise<unknown> }): Promise<void> {
  const { PG_MIGRATIONS } = await import('../db/pg-migrations.js')
  for (const sql of PG_MIGRATIONS) {
    await remote.run(sql)
  }
}

export function isStorageIncrementalEnabled(): boolean {
  return isTruthyStorageEnv(readStorageEnv('syncIncremental'))
}

export async function storagePush(opts?: { tables?: string[] }): Promise<{ rows: number; machine: string }> {
  const remote = await getStoragePg()
  const local = openDatabase(getDbPath(), true)
  try {
    await runStorageMigrations(remote)
    touchMachineRegistry(local, 'push')
    const tables = resolveStorageTables(opts?.tables)
    const results = await syncPush(local, remote, { tables, conflictColumn: 'updated_at' })
    const rows = results.reduce((sum, result) => sum + result.rowsWritten, 0)
    return { rows, machine: getMachineId() }
  } finally {
    local.close()
    await remote.close()
  }
}

export async function storagePull(opts?: { tables?: string[] }): Promise<{ rows: number; machine: string }> {
  const remote = await getStoragePg()
  const local = openDatabase(getDbPath(), true)
  try {
    await runStorageMigrations(remote)
    const tables = resolveStorageTables(opts?.tables)
    const results = await syncPull(remote, local, { tables, conflictColumn: 'updated_at' })
    const rows = results.reduce((sum, result) => sum + result.rowsWritten, 0)
    touchMachineRegistry(local, 'pull')
    setLastStoragePull()
    return { rows, machine: getMachineId() }
  } finally {
    local.close()
    await remote.close()
  }
}

export async function storageSyncFull(): Promise<{ push: number; pull: number; machine: string }> {
  const push = await storagePush()
  const pull = await storagePull()
  return { push: push.rows, pull: pull.rows, machine: getMachineId() }
}

export function setLastStoragePull(at = new Date().toISOString()): void {
  const db = openDatabase(undefined, true)
  try {
    db.prepare(`INSERT OR REPLACE INTO ingest_state (source, key, value) VALUES ('storage', 'last_pull_at', ?)`).run(at)
  } finally {
    db.close()
  }
}

export function getLastStoragePull(): string | null {
  const db = openDatabase(undefined, true)
  try {
    const row = db.prepare(`
      SELECT value FROM ingest_state
      WHERE key = 'last_pull_at' AND source = 'storage'
      LIMIT 1
    `).get() as { value: string } | null
    return row?.value ?? null
  } finally {
    db.close()
  }
}

export function shouldPullFromStorage(): boolean {
  if (!getStorageDatabaseUrl()) return false
  const last = getLastStoragePull()
  if (!last) return true
  const ageMs = Date.now() - new Date(last).getTime()
  return ageMs > getStoragePullIntervalMinutes() * 60_000
}

export async function maybePullFromStorage(): Promise<boolean> {
  if (!shouldPullFromStorage()) return false
  try {
    await storagePull()
    return true
  } catch {
    return false
  }
}

export async function maybePushAfterIngest(): Promise<boolean> {
  if (!isStorageAutoEnabled() || !getStorageDatabaseUrl()) return false
  try {
    await storagePush()
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

function resolveStorageTables(tables?: string[]): string[] {
  if (!tables || tables.length === 0) return [...ECONOMY_STORAGE_TABLES]
  const allowed = new Set<string>(ECONOMY_STORAGE_TABLES)
  const requested = tables.map(table => table.trim()).filter(Boolean)
  const invalid = requested.filter(table => !allowed.has(table))
  if (invalid.length > 0) {
    throw new Error(`Unknown economy sync table(s): ${invalid.join(', ')}`)
  }
  return requested
}

const SCHEDULE_SERVICE_NAME = 'hasna-economy-storage-sync'
const SCHEDULE_CONFIG_DIR = join(homedir(), '.hasna', 'economy')
const SCHEDULE_CONFIG_PATH = join(SCHEDULE_CONFIG_DIR, 'storage-sync-schedule.json')

export interface StorageScheduleStatus {
  registered: boolean
  schedule_minutes: number
  cron_expression: string | null
  mechanism: 'launchd' | 'systemd' | 'none'
}

export async function registerStorageSchedule(intervalMinutes: number): Promise<void> {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    throw new Error('Storage sync interval must be greater than 0 minutes')
  }

  mkdirSync(SCHEDULE_CONFIG_DIR, { recursive: true })
  if (platform() === 'darwin') {
    await registerLaunchd(intervalMinutes)
  } else if (platform() === 'linux') {
    await registerSystemd(intervalMinutes)
  } else {
    throw new Error(`Automatic economy storage sync is not supported on ${platform()}`)
  }

  writeFileSync(SCHEDULE_CONFIG_PATH, JSON.stringify({ intervalMinutes, updatedAt: new Date().toISOString() }, null, 2))
}

export async function removeStorageSchedule(): Promise<void> {
  if (platform() === 'darwin') await removeLaunchd()
  if (platform() === 'linux') await removeSystemd()
  try { unlinkSync(SCHEDULE_CONFIG_PATH) } catch {}
}

export async function getStorageScheduleStatus(): Promise<StorageScheduleStatus> {
  const mechanism = platform() === 'darwin' ? 'launchd' : platform() === 'linux' ? 'systemd' : 'none'
  const interval = readScheduleInterval()
  const registered = mechanism === 'launchd'
    ? existsSync(getLaunchdPlistPath())
    : mechanism === 'systemd'
      ? existsSync(join(getSystemdDir(), `${SCHEDULE_SERVICE_NAME}.timer`))
      : false

  return {
    registered,
    schedule_minutes: interval,
    cron_expression: interval > 0 ? minutesToCron(interval) : null,
    mechanism,
  }
}

function readScheduleInterval(): number {
  try {
    const parsed = JSON.parse(readFileSync(SCHEDULE_CONFIG_PATH, 'utf8')) as { intervalMinutes?: unknown }
    return typeof parsed.intervalMinutes === 'number' && parsed.intervalMinutes > 0 ? parsed.intervalMinutes : 0
  } catch {
    return 0
  }
}

function minutesToCron(minutes: number): string {
  if (minutes < 60) return `*/${minutes} * * * *`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 && hours <= 24 ? `0 */${hours} * * *` : `*/${minutes} * * * *`
}

function getModuleDir(): string {
  return typeof import.meta.dir === 'string'
    ? import.meta.dir
    : dirname(new URL(import.meta.url).pathname)
}

function getBunPath(): string {
  const candidates = [
    join(homedir(), '.bun', 'bin', 'bun'),
    '/opt/homebrew/bin/bun',
    '/usr/local/bin/bun',
    '/usr/bin/bun',
  ]
  return candidates.find(candidate => existsSync(candidate)) ?? 'bun'
}

function getEconomySyncCommand(): string[] {
  const dir = getModuleDir()
  const candidates = [
    join(dir, '..', 'cli', 'index.js'),
    join(dir, '..', 'cli', 'index.ts'),
  ]
  const cliPath = candidates.find(candidate => existsSync(candidate))
  return cliPath ? [getBunPath(), 'run', cliPath, 'storage', 'sync'] : ['economy', 'storage', 'sync']
}

function scheduleEnvironment(): Record<string, string> {
  const keys = [
    'HASNA_ECONOMY_DATABASE_URL',
    'ECONOMY_DATABASE_URL',
    'HASNA_ECONOMY_STORAGE_MODE',
    'ECONOMY_STORAGE_MODE',
    'HASNA_ECONOMY_DB_PATH',
    'ECONOMY_DB',
    'ECONOMY_MACHINE_ID',
    'HASNA_ECONOMY_SYNC_AUTO',
    'ECONOMY_SYNC_AUTO',
    'HASNA_ECONOMY_SYNC_PULL_INTERVAL',
    'ECONOMY_SYNC_PULL_INTERVAL',
    'HASNA_ECONOMY_SYNC_INCREMENTAL',
    'ECONOMY_SYNC_INCREMENTAL',
  ]
  const env: Record<string, string> = {
    HOME: homedir(),
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
  }
  for (const key of keys) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  return env
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function getLaunchdPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', 'com.hasna.economy-storage-sync.plist')
}

function createLaunchdPlist(intervalMinutes: number): string {
  const args = getEconomySyncCommand()
  const env = scheduleEnvironment()
  const stdout = join(SCHEDULE_CONFIG_DIR, 'storage-sync.log')
  const stderr = join(SCHEDULE_CONFIG_DIR, 'storage-sync-error.log')
  const programArgs = args.map(arg => `    <string>${xmlEscape(arg)}</string>`).join('\n')
  const environment = Object.entries(env)
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.hasna.economy-storage-sync</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>StartInterval</key>
  <integer>${Math.round(intervalMinutes * 60)}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderr)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${environment}
  </dict>
</dict>
</plist>`
}

async function registerLaunchd(intervalMinutes: number): Promise<void> {
  const plistPath = getLaunchdPlistPath()
  mkdirSync(dirname(plistPath), { recursive: true })
  try { await Bun.spawn(['launchctl', 'unload', plistPath]).exited } catch {}
  writeFileSync(plistPath, createLaunchdPlist(intervalMinutes))
  await Bun.spawn(['launchctl', 'load', plistPath]).exited
}

async function removeLaunchd(): Promise<void> {
  const plistPath = getLaunchdPlistPath()
  try { await Bun.spawn(['launchctl', 'unload', plistPath]).exited } catch {}
  try { unlinkSync(plistPath) } catch {}
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

function getSystemdDir(): string {
  return join(homedir(), '.config', 'systemd', 'user')
}

function createSystemdService(): string {
  const command = getEconomySyncCommand().map(shellArg).join(' ')
  const environment = Object.entries(scheduleEnvironment())
    .map(([key, value]) => `Environment=${key}=${shellArg(value)}`)
    .join('\n')

  return `[Unit]
Description=Hasna Economy Storage Sync
After=network.target

[Service]
Type=oneshot
ExecStart=${command}
${environment}

[Install]
WantedBy=default.target
`
}

function createSystemdTimer(intervalMinutes: number): string {
  return `[Unit]
Description=Hasna Economy Storage Sync Timer

[Timer]
OnBootSec=${intervalMinutes}min
OnUnitActiveSec=${intervalMinutes}min
Persistent=true

[Install]
WantedBy=timers.target
`
}

async function registerSystemd(intervalMinutes: number): Promise<void> {
  const dir = getSystemdDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${SCHEDULE_SERVICE_NAME}.service`), createSystemdService())
  writeFileSync(join(dir, `${SCHEDULE_SERVICE_NAME}.timer`), createSystemdTimer(intervalMinutes))
  await Bun.spawn(['systemctl', '--user', 'daemon-reload']).exited
  await Bun.spawn(['systemctl', '--user', 'enable', '--now', `${SCHEDULE_SERVICE_NAME}.timer`]).exited
}

async function removeSystemd(): Promise<void> {
  try { await Bun.spawn(['systemctl', '--user', 'disable', '--now', `${SCHEDULE_SERVICE_NAME}.timer`]).exited } catch {}
  const dir = getSystemdDir()
  try { unlinkSync(join(dir, `${SCHEDULE_SERVICE_NAME}.service`)) } catch {}
  try { unlinkSync(join(dir, `${SCHEDULE_SERVICE_NAME}.timer`)) } catch {}
  try { await Bun.spawn(['systemctl', '--user', 'daemon-reload']).exited } catch {}
}
