import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import {
  isSafeRemoteSnapshotPath,
  runEconomyFleetSync,
  verifySqliteIntegrity,
  type FleetCommandRunner,
} from './fleet-sync.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  delete process.env['HASNA_ECONOMY_DB_PATH']
})

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'economy-fleet-sync-'))
  roots.push(root)
  return root
}

function createDb(path: string): void {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, machine_id TEXT, updated_at TEXT);
    CREATE TABLE requests (id TEXT PRIMARY KEY, session_id TEXT, machine_id TEXT, timestamp TEXT, source_request_id TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT UNIQUE, name TEXT, description TEXT, tags TEXT, created_at TEXT);
    CREATE TABLE usage_snapshots (agent TEXT, date TEXT, metric TEXT, value REAL, unit TEXT, machine_id TEXT, updated_at TEXT, PRIMARY KEY(agent,date,metric,machine_id));
    CREATE TABLE subscriptions (id TEXT PRIMARY KEY);
    CREATE TABLE billing_daily (id TEXT PRIMARY KEY);
    CREATE TABLE savings_daily (id TEXT PRIMARY KEY);
    CREATE TABLE budgets (id TEXT PRIMARY KEY);
    CREATE TABLE goals (id TEXT PRIMARY KEY);
    CREATE TABLE model_pricing (model TEXT PRIMARY KEY);
    CREATE TABLE machines (machine_id TEXT PRIMARY KEY);
    CREATE TABLE ingest_state (source TEXT, key TEXT, value TEXT, PRIMARY KEY(source,key));
  `)
  db.close()
}

describe('fleet sync', () => {
  test('validates remote snapshot paths', () => {
    expect(isSafeRemoteSnapshotPath('$HOME/.hasna/economy/fleet-sync-snapshots/spark02.db')).toBe(true)
    expect(isSafeRemoteSnapshotPath('/home/hasna/.hasna/economy/fleet-sync-snapshots/spark02.db')).toBe(true)
    expect(isSafeRemoteSnapshotPath('$HOME/.hasna/economy/fleet-sync-snapshots/../secrets.db')).toBe(false)
    expect(isSafeRemoteSnapshotPath('/tmp/spark02.db')).toBe(false)
    expect(isSafeRemoteSnapshotPath('~/.hasna/economy/fleet-sync-snapshots/spark02.txt')).toBe(false)
  })

  test('checks sqlite integrity locally', () => {
    const root = tempDir()
    const good = join(root, 'good.db')
    const bad = join(root, 'bad.db')
    createDb(good)
    writeFileSync(bad, 'not sqlite')

    expect(verifySqliteIntegrity(good).ok).toBe(true)
    expect(verifySqliteIntegrity(bad).ok).toBe(false)
  })

  test('does not merge stale cache after failed pull', () => {
    const root = tempDir()
    const localDb = join(root, 'local.db')
    const cacheDir = join(root, 'cache')
    process.env['HASNA_ECONOMY_DB_PATH'] = localDb
    const runner: FleetCommandRunner = (command) => {
      if (command === 'ssh') return { code: 0, stdout: '~/.hasna/economy/fleet-sync-snapshots/spark02.db\n', stderr: '' }
      if (command === 'scp') return { code: 1, stdout: '', stderr: 'network down' }
      return { code: 0, stdout: '', stderr: '' }
    }

    const result = runEconomyFleetSync({
      machines: ['spark02'],
      localSync: false,
      remoteSync: false,
      cacheDir,
      runner,
      now: new Date('2026-06-27T00:00:00Z'),
    })

    expect(result.summary.failed).toBe(1)
    expect(result.remote[0]!.error).toBe('snapshot pull failed; no cached DB merged')
    expect(existsSync(localDb)).toBe(false)
  })

  test('supports dry-run without command execution', () => {
    const result = runEconomyFleetSync({
      machines: ['spark02'],
      dryRun: true,
      runner: () => {
        throw new Error('runner should not be called in dry-run')
      },
    })

    expect(result.dry_run).toBe(true)
    expect(result.summary.failed).toBe(0)
    expect(result.remote[0]!.status).toBe('dry_run')
  })
})
