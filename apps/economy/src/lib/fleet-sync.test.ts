import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDatabase, upsertRequest, upsertSession, upsertUsageSnapshot } from '../db/database.js'
import type { EconomyRequest, EconomySession } from '../types/index.js'
import {
  buildFleetCostInsights,
  buildFleetFreshness,
  publicFleetPeerSyncResult,
  syncFleetPeerSqlite,
} from './fleet-sync.js'

const roots: string[] = []
const NOW = '2026-06-26T10:00:00.000Z'

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'economy-fleet-sync-'))
  roots.push(root)
  return root
}

function sampleSession(overrides: Partial<EconomySession> = {}): EconomySession {
  return {
    id: 'session-1',
    agent: 'codex',
    project_path: '/workspace/open-economy',
    project_name: 'open-economy',
    started_at: NOW,
    ended_at: null,
    total_cost_usd: 2.5,
    total_tokens: 300,
    request_count: 1,
    machine_id: 'spark02',
    ...overrides,
  }
}

function sampleRequest(overrides: Partial<EconomyRequest> = {}): EconomyRequest {
  return {
    id: 'request-1',
    agent: 'codex',
    session_id: 'session-1',
    model: 'gpt-5-codex',
    input_tokens: 200,
    output_tokens: 100,
    cache_read_tokens: 0,
    cache_create_tokens: 0,
    cost_usd: 2.5,
    duration_ms: 1000,
    timestamp: NOW,
    source_request_id: 'request-source-1',
    machine_id: 'spark02',
    ...overrides,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

describe('fleet peer SQLite sync', () => {
  test('creates an integrity-checked snapshot during dry-run without merging rows', () => {
    const root = tempRoot()
    const target = openDatabase(join(root, 'target.db'), true)
    const sourcePath = join(root, 'source.db')
    const source = openDatabase(sourcePath, true)
    upsertSession(source, sampleSession())
    upsertRequest(source, sampleRequest())
    upsertUsageSnapshot(source, {
      id: 'codex-quota-spark02',
      agent: 'codex',
      date: '2026-06-26',
      metric: 'quota_utilization',
      value: 44,
      unit: 'percent',
      machine_id: 'spark02',
      updated_at: NOW,
    })
    source.close()

    const result = syncFleetPeerSqlite(target, sourcePath, {
      snapshotDir: join(root, 'snapshots'),
      now: NOW,
      limit: 3,
    })

    expect(result.schema_version).toBe(1)
    expect(result.dry_run).toBe(true)
    expect(result.source.machine_id).toBe('spark02')
    expect(result.snapshot.integrity.ok).toBe(true)
    expect(existsSync(result.snapshot.path)).toBe(true)
    expect(result.merge).toBeNull()
    expect(result.preview.tables.map(table => table.table)).toContain('requests')
    expect((target.prepare(`SELECT COUNT(*) as cnt FROM requests`).get() as { cnt: number }).cnt).toBe(0)
    const publicResult = publicFleetPeerSyncResult(result)
    expect('path' in publicResult.snapshot).toBe(false)
    expect(publicResult.merge).toBeNull()
    target.close()
  })

  test('applies the snapshot merge only when explicitly requested and stays idempotent', () => {
    const root = tempRoot()
    const target = openDatabase(join(root, 'target.db'), true)
    const sourcePath = join(root, 'source.db')
    const source = openDatabase(sourcePath, true)
    upsertSession(source, sampleSession())
    upsertRequest(source, sampleRequest())
    source.close()

    const first = syncFleetPeerSqlite(target, sourcePath, {
      apply: true,
      snapshotDir: join(root, 'snapshots'),
      now: NOW,
    })
    const second = syncFleetPeerSqlite(target, sourcePath, {
      apply: true,
      snapshotDir: join(root, 'snapshots'),
      now: NOW,
    })

    expect(first.dry_run).toBe(false)
    expect(first.merge?.rows_written).toBeGreaterThanOrEqual(2)
    expect(second.merge?.rows_written).toBeGreaterThanOrEqual(2)
    expect((target.prepare(`SELECT COUNT(*) as cnt FROM requests WHERE machine_id = 'spark02'`).get() as { cnt: number }).cnt).toBe(1)
    target.close()
  })
})

describe('fleet freshness and insights', () => {
  test('classifies stale machines and bounds returned rows', () => {
    const root = tempRoot()
    const db = openDatabase(join(root, 'freshness.db'), true)
    upsertSession(db, sampleSession({ id: 'fresh-session', machine_id: 'spark02', started_at: NOW }))
    upsertRequest(db, sampleRequest({ id: 'fresh-request', session_id: 'fresh-session', machine_id: 'spark02', timestamp: NOW }))
    db.prepare(`
      INSERT INTO machines (machine_id, hostname, last_seen_at, last_push_at, last_pull_at, economy_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('apple03', 'apple03', '2026-06-26T08:00:00.000Z', null, null, '0.2.41', '2026-06-26T08:00:00.000Z')

    const freshness = buildFleetFreshness(db, {
      now: '2026-06-26T10:30:00.000Z',
      staleAfterMinutes: 60,
      limit: 1,
    })

    expect(freshness.schema_version).toBe(1)
    expect(freshness.total_machines).toBe(2)
    expect(freshness.returned_machines).toBe(1)
    expect(freshness.truncated).toBe(true)
    expect(freshness.stale_machines).toBe(1)
    expect(freshness.rows[0]?.machine_id).toBe('apple03')
    expect(freshness.rows[0]?.status).toBe('stale')
    db.close()
  })

  test('clamps huge freshness limits to a bounded maximum', () => {
    const root = tempRoot()
    const db = openDatabase(join(root, 'freshness-limit.db'), true)
    for (let i = 0; i < 150; i++) {
      db.prepare(`
        INSERT INTO machines (machine_id, hostname, last_seen_at, last_push_at, last_pull_at, economy_version, updated_at)
        VALUES (?, ?, ?, NULL, NULL, ?, ?)
      `).run(`machine-${String(i).padStart(3, '0')}`, `machine-${i}`, NOW, '0.2.41', NOW)
    }

    const freshness = buildFleetFreshness(db, { now: NOW, limit: 10_000 })

    expect(freshness.total_machines).toBe(150)
    expect(freshness.returned_machines).toBe(100)
    expect(freshness.rows).toHaveLength(100)
    expect(freshness.truncated).toBe(true)
    db.close()
  })

  test('reports compact cost insights with remediation hints', () => {
    const root = tempRoot()
    const db = openDatabase(join(root, 'insights.db'), true)
    upsertSession(db, sampleSession({ id: 'paid-session', total_cost_usd: 2.5 }))
    upsertRequest(db, sampleRequest({ id: 'paid-request', session_id: 'paid-session', cost_usd: 2.5 }))
    upsertSession(db, sampleSession({
      id: 'zero-session',
      total_cost_usd: 0,
      total_tokens: 100,
      request_count: 1,
      machine_id: 'apple03',
    }))
    upsertRequest(db, sampleRequest({
      id: 'zero-request',
      session_id: 'zero-session',
      cost_usd: 0,
      input_tokens: 100,
      output_tokens: 20,
      machine_id: 'apple03',
    }))

    const insights = buildFleetCostInsights(db, {
      period: 'all',
      now: NOW,
      staleAfterMinutes: 60,
      limit: 2,
    })

    expect(insights.schema_version).toBe(1)
    expect(insights.period).toBe('all')
    expect(insights.summary.total_usd).toBeCloseTo(2.5)
    expect(insights.top_machines.map(row => row.machine_id)).toEqual(['spark02', 'apple03'])
    expect(insights.quality.zero_cost_token_requests).toBe(1)
    expect(insights.hints.some(hint => hint.includes('sync --recalculate'))).toBe(true)
    db.close()
  })

  test('scopes top model insights to the selected period', () => {
    const root = tempRoot()
    const db = openDatabase(join(root, 'model-period.db'), true)
    upsertSession(db, sampleSession({
      id: 'today-session',
      started_at: NOW,
      machine_id: 'spark02',
      total_cost_usd: 1,
    }))
    upsertRequest(db, sampleRequest({
      id: 'today-request',
      session_id: 'today-session',
      timestamp: NOW,
      model: 'current-model',
      cost_usd: 1,
      machine_id: 'spark02',
    }))
    upsertSession(db, sampleSession({
      id: 'old-session',
      started_at: '2000-01-01T00:00:00.000Z',
      machine_id: 'apple03',
      total_cost_usd: 99,
    }))
    upsertRequest(db, sampleRequest({
      id: 'old-request',
      session_id: 'old-session',
      timestamp: '2000-01-01T00:00:00.000Z',
      model: 'old-expensive-model',
      cost_usd: 99,
      machine_id: 'apple03',
    }))

    const insights = buildFleetCostInsights(db, {
      period: 'today',
      now: NOW,
      limit: 5,
    })

    expect(insights.top_models.map(row => row.model)).toEqual(['current-model'])
    db.close()
  })
})
