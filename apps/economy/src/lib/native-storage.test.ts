import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getIngestState,
  openDatabase,
  setIngestState,
  upsertUsageSnapshot,
} from '../db/database.js'
import { SqliteAdapter } from '../db/storage-adapter.js'
import {
  CANONICAL_ECONOMY_RDS_CLUSTER,
  CANONICAL_ECONOMY_RDS_DATABASE,
  CANONICAL_ECONOMY_RDS_RUNTIME_PATH,
  ECONOMY_STORAGE_FALLBACK_ENV,
  ECONOMY_STORAGE_TABLES,
  STORAGE_TABLES,
  getCanonicalEconomyRdsConfig,
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
} from './native-storage.js'
import { syncPull, syncPush } from './storage-sync.js'

const roots: string[] = []

function tempDbPath(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'economy-native-storage-'))
  roots.push(root)
  return join(root, name)
}

function closeDb(db: { close: () => void }): void {
  db.close()
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

describe('economy native storage config', () => {
  test('defaults to local storage with canonical env names', () => {
    const status = getStorageStatus({})

    expect(getStorageMode({})).toBe('local')
    expect(getStorageDatabaseUrl({})).toBeNull()
    expect(status.local_default).toBe(true)
    expect(status.remote_enabled).toBe(false)
    expect(status.env.databaseUrl.name).toBe('HASNA_ECONOMY_DATABASE_URL')
    expect(status.env.databaseUrl.active_name).toBe('HASNA_ECONOMY_DATABASE_URL')
    expect(status.tables).toEqual(ECONOMY_STORAGE_TABLES)
    expect(STORAGE_TABLES).toEqual(ECONOMY_STORAGE_TABLES)
    expect(status.canonical).toEqual(getCanonicalEconomyRdsConfig())
    expect(status.tables).not.toContain('ingest_state')
  })

  test('supports plain economy fallbacks without changing public canonical names', () => {
    const env = {
      ECONOMY_STORAGE_MODE: 'hybrid',
      ECONOMY_DATABASE_URL: 'postgres://user:secret@example.test/economy',
    }
    const status = getStorageStatus(env)

    expect(ECONOMY_STORAGE_FALLBACK_ENV.databaseUrl).toBe('ECONOMY_DATABASE_URL')
    expect(getStorageMode(env)).toBe('hybrid')
    expect(getStorageDatabaseUrl(env)).toBe(env.ECONOMY_DATABASE_URL)
    expect(getStorageDatabaseEnv(env)).toBe('ECONOMY_DATABASE_URL')
    expect(status.env.databaseUrl.name).toBe('HASNA_ECONOMY_DATABASE_URL')
    expect(status.env.databaseUrl.active_name).toBe('ECONOMY_DATABASE_URL')
    expect(status.database.redacted_url).toBe('postgres://user:***@example.test/economy')
  })

  test('canonical env wins over fallback env', () => {
    const env = {
      HASNA_ECONOMY_DATABASE_URL: 'postgres://canonical/economy',
      ECONOMY_DATABASE_URL: 'postgres://fallback/economy',
    }

    expect(getStorageDatabaseUrl(env)).toBe('postgres://canonical/economy')
    expect(getStorageDatabaseEnv(env)).toBe('HASNA_ECONOMY_DATABASE_URL')
  })

  test('documents the canonical Hasna XYZ RDS target', () => {
    expect(getCanonicalEconomyRdsConfig()).toEqual({
      cluster: CANONICAL_ECONOMY_RDS_CLUSTER,
      database: CANONICAL_ECONOMY_RDS_DATABASE,
      runtimeSecretPath: CANONICAL_ECONOMY_RDS_RUNTIME_PATH,
      primaryEnv: 'HASNA_ECONOMY_DATABASE_URL',
      fallbackEnv: 'ECONOMY_DATABASE_URL',
    })
    expect(CANONICAL_ECONOMY_RDS_CLUSTER).toBe('hasna-xyz-infra-apps-prod-postgres')
    expect(CANONICAL_ECONOMY_RDS_DATABASE).toBe('economy')
    expect(CANONICAL_ECONOMY_RDS_RUNTIME_PATH).toBe('hasna/xyz/opensource/economy/prod/rds')
  })

  test('empty canonical env values behave like unset values', () => {
    const env = {
      HASNA_ECONOMY_DATABASE_URL: '',
      ECONOMY_DATABASE_URL: 'postgres://fallback/economy',
    }
    const emptyStatus = getStorageStatus({ HASNA_ECONOMY_DATABASE_URL: '' })

    expect(getStorageDatabaseUrl(env)).toBe('postgres://fallback/economy')
    expect(getStorageDatabaseEnv(env)).toBe('ECONOMY_DATABASE_URL')
    expect(emptyStatus.mode).toBe('local')
    expect(emptyStatus.database.configured).toBe(false)
  })

  test('storage helpers are available from the storage subpath source', async () => {
    const storage = await import('../storage.js')

    expect(storage.STORAGE_TABLES).toEqual(ECONOMY_STORAGE_TABLES)
    expect(storage.ECONOMY_STORAGE_ENV.databaseUrl).toBe('HASNA_ECONOMY_DATABASE_URL')
    expect(typeof storage.getStorageStatus).toBe('function')
    expect(typeof storage.storagePush).toBe('function')
    expect(typeof storage.storagePull).toBe('function')
    expect(typeof storage.storageSyncFull).toBe('function')
    expect(typeof storage.PgAdapterAsync).toBe('function')
  })

  test('loads PostgreSQL storage migrations without retired naming', async () => {
    const executed: string[] = []
    const { runStorageMigrations } = await import('./native-storage.js')

    await runStorageMigrations({
      async run(sql: string) {
        executed.push(sql)
      },
    })

    expect(executed.length).toBeGreaterThan(0)
    expect(executed.join('\n')).toContain('CREATE TABLE IF NOT EXISTS requests')
    expect(executed.join('\n')).not.toContain('cloud sync')
  })

  test('keeps ingest cursors local during default remote sync', async () => {
    const local = openDatabase(tempDbPath('local.db'), true)
    const remote = openDatabase(tempDbPath('remote.db'), true)
    try {
      setIngestState(local, 'codex', 'cursor', 'apple')
      setIngestState(remote, 'codex', 'cursor', 'spark')

      await syncPull(remote as unknown as Parameters<typeof syncPull>[0], local, {
        tables: [...ECONOMY_STORAGE_TABLES],
      })

      expect(getIngestState(local, 'codex', 'cursor')).toBe('apple')
    } finally {
      closeDb(local)
      closeDb(remote)
    }
  })

  test('syncs machine-scoped rows idempotently with newest updated_at winning', async () => {
    const local = openDatabase(tempDbPath('local-machine.db'), true)
    const remote = openDatabase(tempDbPath('remote-machine.db'), true)
    try {
      upsertUsageSnapshot(local, {
        id: 'codex-2026-06-08-quota-spark01',
        agent: 'codex',
        date: '2026-06-08',
        metric: 'quota_utilization',
        value: 40,
        unit: 'percent',
        machine_id: 'spark01',
        updated_at: '2026-06-08T09:00:00.000Z',
      })
      upsertUsageSnapshot(remote, {
        id: 'codex-2026-06-08-quota-spark01',
        agent: 'codex',
        date: '2026-06-08',
        metric: 'quota_utilization',
        value: 55,
        unit: 'percent',
        machine_id: 'spark01',
        updated_at: '2026-06-08T10:00:00.000Z',
      })

      await syncPush(local, remote as unknown as Parameters<typeof syncPush>[1], {
        tables: ['usage_snapshots'],
      })
      expect((remote.get(`SELECT value FROM usage_snapshots WHERE id = ?`, 'codex-2026-06-08-quota-spark01') as { value: number }).value).toBe(55)

      upsertUsageSnapshot(local, {
        id: 'codex-2026-06-08-quota-spark01',
        agent: 'codex',
        date: '2026-06-08',
        metric: 'quota_utilization',
        value: 70,
        unit: 'percent',
        machine_id: 'spark01',
        updated_at: '2026-06-08T11:00:00.000Z',
      })
      upsertUsageSnapshot(local, {
        id: 'claude-2026-06-08-quota-spark02',
        agent: 'claude',
        date: '2026-06-08',
        metric: 'quota_utilization',
        value: 15,
        unit: 'percent',
        machine_id: 'spark02',
        updated_at: '2026-06-08T11:00:00.000Z',
      })

      await syncPush(local, remote as unknown as Parameters<typeof syncPush>[1], {
        tables: ['usage_snapshots'],
      })
      await syncPush(local, remote as unknown as Parameters<typeof syncPush>[1], {
        tables: ['usage_snapshots'],
      })

      const rows = remote.all(`
        SELECT id, machine_id, value
        FROM usage_snapshots
        ORDER BY machine_id, id
      `) as Array<{ id: string; machine_id: string; value: number }>
      expect(rows).toEqual([
        { id: 'codex-2026-06-08-quota-spark01', machine_id: 'spark01', value: 70 },
        { id: 'claude-2026-06-08-quota-spark02', machine_id: 'spark02', value: 15 },
      ])
    } finally {
      closeDb(local)
      closeDb(remote)
    }
  })

  test('pull creates machine_id on local rows when the target table is older', async () => {
    const remote = new SqliteAdapter(tempDbPath('remote-legacy.db'))
    const local = new SqliteAdapter(tempDbPath('local-legacy.db'))
    try {
      remote.exec(`
        CREATE TABLE usage_snapshots (
          id TEXT PRIMARY KEY,
          agent TEXT NOT NULL,
          date TEXT NOT NULL,
          metric TEXT NOT NULL,
          value REAL NOT NULL DEFAULT 0,
          unit TEXT DEFAULT '',
          machine_id TEXT DEFAULT '',
          updated_at TEXT NOT NULL
        )
      `)
      local.exec(`
        CREATE TABLE usage_snapshots (
          id TEXT PRIMARY KEY,
          agent TEXT NOT NULL,
          date TEXT NOT NULL,
          metric TEXT NOT NULL,
          value REAL NOT NULL DEFAULT 0,
          unit TEXT DEFAULT '',
          updated_at TEXT NOT NULL
        )
      `)
      remote.run(
        `INSERT INTO usage_snapshots (id, agent, date, metric, value, unit, machine_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'codex-legacy-row',
        'codex',
        '2026-06-08',
        'quota_utilization',
        25,
        'percent',
        'apple06',
        '2026-06-08T12:00:00.000Z',
      )

      await syncPull(remote as unknown as Parameters<typeof syncPull>[0], local, {
        tables: ['usage_snapshots'],
        primaryKey: 'id',
      })

      const columns = local.all(`PRAGMA table_info("usage_snapshots")`) as Array<{ name: string }>
      const row = local.get(`SELECT machine_id, value FROM usage_snapshots WHERE id = ?`, 'codex-legacy-row') as { machine_id: string; value: number }
      expect(columns.map(column => column.name)).toContain('machine_id')
      expect(row).toEqual({ machine_id: 'apple06', value: 25 })
    } finally {
      closeDb(remote)
      closeDb(local)
    }
  })
})
