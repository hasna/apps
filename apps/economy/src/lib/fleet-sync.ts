import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { Database } from 'bun:sqlite'
import { getDbPath, openDatabase } from '../db/database.js'
import { mergePeerDatabase, type PeerMergeResult } from './peer-sync.js'

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  error?: string
}

export type FleetCommandRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number },
) => CommandResult

export interface EconomyFleetSyncOptions {
  machines?: string[]
  localSync?: boolean
  remoteSync?: boolean
  cacheDir?: string
  reportDir?: string
  remoteSnapshotDir?: string
  timeoutMs?: number
  dryRun?: boolean
  runner?: FleetCommandRunner
  now?: Date
}

export interface EconomyFleetSyncMachineResult {
  machine: string
  status: 'merged' | 'failed' | 'dry_run'
  remote_sync?: CommandResult
  remote_snapshot?: CommandResult
  remote_snapshot_path?: string
  pull?: CommandResult
  local_integrity?: {
    ok: boolean
    detail: string
  }
  merge?: PeerMergeResult
  error?: string
}

export interface EconomyFleetSyncResult {
  schema: 'open-economy.fleet-sync.v1'
  generated_at: string
  dry_run: boolean
  local: {
    status: 'synced' | 'failed' | 'skipped' | 'dry_run'
    sync?: CommandResult
    db_path: string
  }
  remote: EconomyFleetSyncMachineResult[]
  summary: {
    machines: number
    merged: number
    failed: number
    dry_run: number
  }
}

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MACHINES = ['spark02', 'apple03']

export function runEconomyFleetSync(options: EconomyFleetSyncOptions = {}): EconomyFleetSyncResult {
  const generatedAt = (options.now ?? new Date()).toISOString()
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const runner = options.runner ?? spawnCommand
  const dryRun = Boolean(options.dryRun)
  const machines = (options.machines?.length ? options.machines : DEFAULT_MACHINES).filter(Boolean)
  const cacheDir = resolve(options.cacheDir ?? join(homedir(), '.hasna', 'economy', 'fleet-sync-cache'))
  const remoteSnapshotDir = options.remoteSnapshotDir ?? '$HOME/.hasna/economy/fleet-sync-snapshots'
  const localSync = options.localSync !== false
  const remoteSync = options.remoteSync !== false

  const local: EconomyFleetSyncResult['local'] = {
    status: dryRun ? 'dry_run' : localSync ? 'skipped' : 'skipped',
    db_path: getDbPath(),
  }

  if (localSync) {
    if (dryRun) {
      local.status = 'dry_run'
    } else {
      local.sync = runner('economy', ['sync'], { timeoutMs })
      local.status = local.sync.code === 0 ? 'synced' : 'failed'
    }
  }

  const remote = machines.map((machine) => syncMachine(machine, {
    generatedAt,
    timeoutMs,
    runner,
    dryRun,
    remoteSync,
    cacheDir,
    remoteSnapshotDir,
  }))

  return {
    schema: 'open-economy.fleet-sync.v1',
    generated_at: generatedAt,
    dry_run: dryRun,
    local,
    remote,
    summary: {
      machines: remote.length,
      merged: remote.filter((row) => row.status === 'merged').length,
      failed: remote.filter((row) => row.status === 'failed').length,
      dry_run: remote.filter((row) => row.status === 'dry_run').length + (dryRun ? 1 : 0),
    },
  }
}

function syncMachine(
  machine: string,
  context: {
    generatedAt: string
    timeoutMs: number
    runner: FleetCommandRunner
    dryRun: boolean
    remoteSync: boolean
    cacheDir: string
    remoteSnapshotDir: string
  },
): EconomyFleetSyncMachineResult {
  const safeMachine = machine.replace(/[^A-Za-z0-9_.-]/g, '_')
  const stamp = context.generatedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const snapshotName = `${safeMachine}-${stamp}.economy.db`
  const remoteSnapshotPath = `${context.remoteSnapshotDir.replace(/\/$/, '')}/${snapshotName}`
  const tmpLocal = join(context.cacheDir, `${snapshotName}.tmp`)
  const verifiedLocal = join(context.cacheDir, snapshotName)

  if (context.dryRun) {
    return { machine, status: 'dry_run', remote_snapshot_path: remoteSnapshotPath }
  }

  mkdirSync(context.cacheDir, { recursive: true })
  rmSync(tmpLocal, { force: true })

  const result: EconomyFleetSyncMachineResult = {
    machine,
    status: 'failed',
    remote_snapshot_path: remoteSnapshotPath,
  }

  if (context.remoteSync) {
    result.remote_sync = context.runner('ssh', [machine, 'economy sync'], { timeoutMs: context.timeoutMs })
    if (result.remote_sync.code !== 0) {
      result.error = 'remote economy sync failed'
      return result
    }
  }

  result.remote_snapshot = context.runner('ssh', [machine, remoteSnapshotCommand(context.remoteSnapshotDir, snapshotName)], { timeoutMs: context.timeoutMs })
  if (result.remote_snapshot.code !== 0) {
    result.error = 'remote snapshot failed'
    return result
  }

  const emittedPath = result.remote_snapshot.stdout.trim().split(/\r?\n/).at(-1)?.trim() || remoteSnapshotPath
  if (!isSafeRemoteSnapshotPath(emittedPath, context.remoteSnapshotDir)) {
    result.error = `remote snapshot path refused: ${emittedPath}`
    return result
  }
  result.remote_snapshot_path = emittedPath

  result.pull = context.runner('scp', [`${machine}:${emittedPath}`, tmpLocal], { timeoutMs: context.timeoutMs })
  context.runner('ssh', [machine, `rm -f ${shellQuote(emittedPath)}`], { timeoutMs: context.timeoutMs })
  if (result.pull.code !== 0) {
    result.error = 'snapshot pull failed; no cached DB merged'
    rmSync(tmpLocal, { force: true })
    return result
  }

  const integrity = verifySqliteIntegrity(tmpLocal)
  result.local_integrity = integrity
  if (!integrity.ok) {
    result.error = 'pulled snapshot failed local integrity check'
    rmSync(tmpLocal, { force: true })
    return result
  }

  renameSync(tmpLocal, verifiedLocal)
  const db = openDatabase()
  result.merge = mergePeerDatabase(db, verifiedLocal, { sourceMachine: machine })
  result.status = 'merged'
  return result
}

function remoteSnapshotCommand(remoteDir: string, filename: string): string {
  const dirExpr = remoteDir.startsWith('$HOME/')
    ? `"${remoteDir.replace(/"/g, '\\"')}"`
    : shellQuote(remoteDir)
  const safeFilename = filename.replace(/[^A-Za-z0-9_.-]/g, '_')
  return [
    'set -euo pipefail',
    'db="${HASNA_ECONOMY_DB_PATH:-${ECONOMY_DB:-$HOME/.hasna/economy/economy.db}}"',
    `snapshot_dir=${dirExpr}`,
    `out="$snapshot_dir/${safeFilename}"`,
    'test -f "$db"',
    'mkdir -p "$snapshot_dir"',
    'rm -f "$out"',
    'sqlite3 "$db" "VACUUM INTO \'$out\'"',
    'test "$(sqlite3 "$out" "PRAGMA integrity_check;")" = "ok"',
    'printf "%s\\n" "$out"',
  ].join('; ')
}

export function isSafeRemoteSnapshotPath(path: string, remoteSnapshotDir = '$HOME/.hasna/economy/fleet-sync-snapshots'): boolean {
  if (!path || path.includes('\0') || path.includes('\n') || path.includes('\r')) return false
  if (!path.endsWith('.db')) return false
  if (path.includes('..')) return false
  const prefix = remoteSnapshotDir.replace(/\/$/, '')
  return path.startsWith(`${prefix}/`)
    || path.startsWith('$HOME/.hasna/economy/fleet-sync-snapshots/')
    || path.includes('/.hasna/economy/fleet-sync-snapshots/')
}

export function verifySqliteIntegrity(path: string): { ok: boolean; detail: string } {
  if (!existsSync(path)) return { ok: false, detail: 'file does not exist' }
  let db: Database | undefined
  try {
    db = new Database(path, { readonly: true })
    const row = db.query<Record<string, string>, []>('PRAGMA integrity_check').get()
    const detail = Object.values(row ?? {})[0] ?? ''
    return { ok: detail.toLowerCase() === 'ok', detail: detail || 'no integrity result' }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  } finally {
    db?.close()
  }
}

export function writeFleetSyncReport(reportDir: string, result: EconomyFleetSyncResult): string {
  mkdirSync(reportDir, { recursive: true })
  const path = join(resolve(reportDir), `${result.generated_at.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.json`)
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`)
  return path
}

function spawnCommand(command: string, args: string[], options: { timeoutMs: number }): CommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error.message } : {}),
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value < 1) return fallback
  return Math.floor(value)
}
