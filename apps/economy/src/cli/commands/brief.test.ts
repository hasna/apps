import { describe, expect, test } from 'bun:test'
import { openDatabase, upsertRequest, upsertSession } from '../../db/database.js'
import { buildBrief, renderBriefText } from './brief.js'
import type { EconomyRequest, EconomySession } from '../../types/index.js'

function session(overrides: Partial<EconomySession> = {}): EconomySession {
  const now = new Date().toISOString()
  return {
    id: 'session-1',
    agent: 'claude',
    project_path: '/home/hasna/workspace/open-economy',
    project_name: 'open-economy',
    started_at: now,
    ended_at: now,
    total_cost_usd: 0.01,
    total_tokens: 2_000,
    request_count: 1,
    machine_id: 'spark01',
    account_key: 'claude:work@example.com',
    account_tool: 'claude',
    account_name: 'work',
    account_email: 'work@example.com',
    account_source: 'test',
    ...overrides,
  }
}

function request(overrides: Partial<EconomyRequest> = {}): EconomyRequest {
  const now = new Date().toISOString()
  return {
    id: 'request-1',
    agent: 'claude',
    session_id: 'session-1',
    model: 'claude-opus-4-8',
    input_tokens: 1_000,
    output_tokens: 500,
    cache_read_tokens: 200,
    cache_create_tokens: 300,
    cache_create_5m_tokens: 100,
    cache_create_1h_tokens: 200,
    cost_usd: 0.01,
    duration_ms: 1000,
    timestamp: now,
    source_request_id: 'source-request-1',
    machine_id: 'spark01',
    account_key: 'claude:work@example.com',
    account_tool: 'claude',
    account_name: 'work',
    account_email: 'work@example.com',
    account_source: 'test',
    ...overrides,
  }
}

describe('economy brief', () => {
  test('builds fleet summaries, breakdowns, and freshness lines', () => {
    const db = openDatabase(':memory:', true)
    const now = new Date('2026-06-24T12:00:00.000Z')
    const recent = '2026-06-24T11:55:00.000Z'
    const syncAt = '2026-06-24T11:50:00.000Z'

    upsertSession(db, session({ id: 'session-1', started_at: recent, ended_at: recent, machine_id: 'spark01' }))
    upsertRequest(db, request({ id: 'request-1', session_id: 'session-1', timestamp: recent, machine_id: 'spark01' }))
    upsertSession(db, session({
      id: 'session-2',
      agent: 'codex',
      started_at: recent,
      ended_at: recent,
      total_cost_usd: 0.02,
      total_tokens: 1_500,
      request_count: 2,
      machine_id: 'spark02',
      account_key: 'codex:dev@example.com',
      account_tool: 'codex',
      account_name: 'dev',
      account_email: 'dev@example.com',
    }))
    db.prepare(`
      INSERT INTO machines (machine_id, hostname, last_seen_at, last_push_at, last_pull_at, economy_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('spark02', 'spark02', syncAt, null, syncAt, '0.2.35', syncAt)

    const brief = buildBrief(db, { since: '24h', machine: 'all', now })
    const text = renderBriefText(brief)

    expect(brief.summaries.find(row => row.period === 'since')?.total_tokens).toBe(3_500)
    expect(brief.summaries.find(row => row.period === 'since')?.cache_create_1h_tokens).toBe(200)
    expect(brief.machines.map(row => row.machine_id).sort()).toEqual(['spark01', 'spark02'])
    expect(brief.agents.map(row => row.agent).sort()).toEqual(['claude', 'codex'])
    expect(brief.accounts.map(row => row.account_email).sort()).toEqual(['dev@example.com', 'work@example.com'])
    expect(brief.freshness.max_request_line).toContain('spark01')
    expect(brief.freshness.merge_sync_line).toContain('spark02')
    expect(text).toContain('SUMMARY')
    expect(text).toContain('PER-MACHINE')
    expect(text).toContain('PER-AGENT')
    expect(text).toContain('PER-ACCOUNT')
    expect(text).toContain('FRESHNESS')
  })

  test('filters the brief to one machine', () => {
    const db = openDatabase(':memory:', true)
    const now = new Date('2026-06-24T12:00:00.000Z')
    const recent = '2026-06-24T11:55:00.000Z'

    upsertSession(db, session({ id: 'session-1', started_at: recent, ended_at: recent, machine_id: 'spark01' }))
    upsertRequest(db, request({ id: 'request-1', session_id: 'session-1', timestamp: recent, machine_id: 'spark01' }))
    upsertSession(db, session({
      id: 'session-2',
      agent: 'codex',
      started_at: recent,
      ended_at: recent,
      total_cost_usd: 0.02,
      total_tokens: 1_500,
      request_count: 2,
      machine_id: 'spark02',
      account_key: 'codex:dev@example.com',
      account_tool: 'codex',
      account_email: 'dev@example.com',
    }))

    const brief = buildBrief(db, { since: '24h', machine: 'spark01', now })

    expect(brief.machine).toBe('spark01')
    expect(brief.machines.map(row => row.machine_id)).toEqual(['spark01'])
    expect(brief.agents.map(row => row.agent)).toEqual(['claude'])
    expect(brief.accounts.map(row => row.account_email)).toEqual(['work@example.com'])
  })

  test('uses explicit local sync time for the current machine freshness row', () => {
    const db = openDatabase(':memory:', true)
    const now = new Date('2026-06-24T12:00:00.000Z')
    const recent = '2026-06-24T11:55:00.000Z'
    const staleSync = '2026-06-06T10:49:23.282Z'

    upsertSession(db, session({ id: 'session-1', started_at: recent, ended_at: recent, machine_id: 'spark01' }))
    upsertRequest(db, request({ id: 'request-1', session_id: 'session-1', timestamp: recent, machine_id: 'spark01' }))
    db.prepare(`
      INSERT INTO machines (machine_id, hostname, last_seen_at, last_push_at, last_pull_at, economy_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('spark01', 'spark01', staleSync, staleSync, staleSync, '0.2.30', staleSync)

    const brief = buildBrief(db, {
      since: '24h',
      machine: 'all',
      now,
      currentMachineId: 'spark01',
      localSyncAt: now,
    })
    const spark01 = brief.freshness.machines.find(row => row.machine_id === 'spark01')

    expect(spark01?.last_merge_sync_at).toBe(now.toISOString())
    expect(spark01?.merge_sync_age).toBe('<1m')
  })
})
