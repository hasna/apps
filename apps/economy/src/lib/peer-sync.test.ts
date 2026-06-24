import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getCostCenter, openDatabase, querySummary, upsertCostCenter, upsertProject, upsertRequest, upsertSession, upsertUsageSnapshot } from '../db/database.js'
import { CLOUD_TABLES } from './cloud-sync.js'
import { mergePeerDatabase } from './peer-sync.js'
import type { EconomyRequest, EconomySession } from '../types/index.js'

const NOW = new Date().toISOString()
const roots: string[] = []

function tempPath(name: string): string {
  const root = mkdtempSync(join(tmpdir(), 'economy-peer-sync-'))
  roots.push(root)
  return join(root, name)
}

function closeDb(db: { close?: () => void }): void {
  db.close?.()
}

function sampleSession(overrides: Partial<EconomySession> = {}): EconomySession {
  return {
    id: 'session-1',
    agent: 'claude',
    project_path: '/workspace/open-economy',
    project_name: 'open-economy',
    started_at: NOW,
    ended_at: null,
    total_cost_usd: 1,
    total_tokens: 100,
    request_count: 1,
    machine_id: 'spark02',
    ...overrides,
  }
}

function sampleRequest(overrides: Partial<EconomyRequest> = {}): EconomyRequest {
  return {
    id: 'request-1',
    agent: 'claude',
    session_id: 'session-1',
    model: 'claude-sonnet-4-6',
    input_tokens: 80,
    output_tokens: 20,
    cache_read_tokens: 0,
    cache_create_tokens: 0,
    cost_usd: 1,
    duration_ms: 100,
    timestamp: NOW,
    source_request_id: 'source-1',
    machine_id: 'spark02',
    ...overrides,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

describe('mergePeerDatabase', () => {
  test('imports peer data while preserving the target ingest cursor', () => {
    const targetPath = tempPath('target.db')
    const sourcePath = tempPath('source.db')
    const target = openDatabase(targetPath, true)
    const source = openDatabase(sourcePath, true)

    upsertSession(target, sampleSession({
      id: 'apple-session',
      machine_id: 'apple06',
      project_path: '/Users/hasna/open-economy',
      total_cost_usd: 2,
    }))
    upsertRequest(target, sampleRequest({
      id: 'apple-request',
      session_id: 'apple-session',
      machine_id: 'apple06',
      source_request_id: 'apple-source',
      cost_usd: 2,
    }))
    target.prepare(`INSERT OR REPLACE INTO ingest_state (source, key, value) VALUES ('codex', 'cursor', 'apple')`).run()

    upsertProject(source, {
      id: 'project-source',
      path: '/home/hasna/open-economy',
      name: 'open-economy',
      description: null,
      tags: [],
      created_at: NOW,
    })
    upsertSession(source, sampleSession())
    upsertRequest(source, sampleRequest())
    upsertUsageSnapshot(source, {
      agent: 'codex',
      date: NOW.substring(0, 10),
      metric: 'five_hour_utilization',
      value: 10,
      unit: 'percent',
      machine_id: 'spark02',
      updated_at: NOW,
    })
    source.prepare(`INSERT OR REPLACE INTO ingest_state (source, key, value) VALUES ('codex', 'cursor', 'spark')`).run()
    closeDb(source)

    const result = mergePeerDatabase(target, sourcePath)

    expect(result.source_machine).toBe('spark02')
    expect(result.rows_written).toBeGreaterThanOrEqual(4)
    expect(querySummary(target, 'all', undefined, true).total_usd).toBeCloseTo(3)
    expect(querySummary(target, 'all', 'spark02').total_usd).toBeCloseTo(1)
    expect(querySummary(target, 'all', 'apple06').total_usd).toBeCloseTo(2)
    expect((target.prepare(`SELECT COUNT(*) as cnt FROM usage_snapshots WHERE machine_id = 'spark02'`).get() as { cnt: number }).cnt).toBe(1)
    expect((target.prepare(`SELECT value FROM ingest_state WHERE source = 'codex' AND key = 'cursor'`).get() as { value: string }).value).toBe('apple')
    closeDb(target)
  })

  test('remaps cross-machine primary key collisions and reuses the remap on repeat imports', () => {
    const targetPath = tempPath('target-collision.db')
    const sourcePath = tempPath('source-collision.db')
    const target = openDatabase(targetPath, true)
    const source = openDatabase(sourcePath, true)

    upsertSession(target, sampleSession({
      id: 'same-session',
      machine_id: 'apple06',
      total_cost_usd: 5,
    }))
    upsertRequest(target, sampleRequest({
      id: 'same-request',
      session_id: 'same-session',
      machine_id: 'apple06',
      source_request_id: 'apple-source',
      cost_usd: 5,
    }))
    upsertSession(source, sampleSession({
      id: 'same-session',
      machine_id: 'spark02',
      total_cost_usd: 7,
    }))
    upsertRequest(source, sampleRequest({
      id: 'same-request',
      session_id: 'same-session',
      machine_id: 'spark02',
      source_request_id: 'spark-source',
      cost_usd: 7,
    }))
    closeDb(source)

    const first = mergePeerDatabase(target, sourcePath)
    const second = mergePeerDatabase(target, sourcePath)
    const sessions = target.prepare(`SELECT id, machine_id FROM sessions ORDER BY id`).all() as Array<{ id: string; machine_id: string }>
    const request = target.prepare(`SELECT id, session_id, machine_id FROM requests WHERE machine_id = 'spark02'`).get() as { id: string; session_id: string; machine_id: string }

    expect(first.collisions).toBe(2)
    expect(second.collisions).toBe(2)
    expect(sessions).toEqual([
      { id: 'same-session', machine_id: 'apple06' },
      { id: 'spark02:same-session', machine_id: 'spark02' },
    ])
    expect(request).toEqual({
      id: 'spark02:same-request',
      session_id: 'spark02:same-session',
      machine_id: 'spark02',
    })
    expect((target.prepare(`SELECT COUNT(*) as cnt FROM sessions`).get() as { cnt: number }).cnt).toBe(2)
    expect((target.prepare(`SELECT COUNT(*) as cnt FROM requests`).get() as { cnt: number }).cnt).toBe(2)
    closeDb(target)
  })

  test('sync table lists include cost center dictionary rows', () => {
    expect(CLOUD_TABLES).toContain('cost_centers')
  })

  test('imports cost centers from peer databases', () => {
    const targetPath = tempPath('target-cost-centers.db')
    const sourcePath = tempPath('source-cost-centers.db')
    const target = openDatabase(targetPath, true)
    const source = openDatabase(sourcePath, true)

    upsertCostCenter(source, {
      id: 'loop:fleet-evaluator',
      kind: 'loop',
      name: 'fleet-evaluator',
      repo_path: null,
      labels_json: '{"team":"ops"}',
      created_at: NOW,
    })
    closeDb(source)

    const result = mergePeerDatabase(target, sourcePath)

    expect(result.tables.some(table => table.table === 'cost_centers')).toBe(true)
    expect(getCostCenter(target, 'loop:fleet-evaluator')?.name).toBe('fleet-evaluator')
    closeDb(target)
  })
})
