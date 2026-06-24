import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Database as BunDatabase } from 'bun:sqlite'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getCostCenter, openDatabase, queryCostCenterBreakdown, queryLoopAttributions, queryLoopEfficiency } from '../db/database.js'
import { ingestLoops } from './loops.js'
import type { SqliteAdapter as Database } from '@hasna/cloud'

let root: string
let loopsDbPath: string
let db: Database

beforeEach(() => {
  root = join(tmpdir(), `economy-loops-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(root, { recursive: true })
  loopsDbPath = join(root, 'loops.db')
  db = openDatabase(':memory:', true)
  process.env['HASNA_ECONOMY_LOOPS_DB_PATH'] = loopsDbPath
})

afterEach(() => {
  delete process.env['HASNA_ECONOMY_LOOPS_DB_PATH']
  delete process.env['HASNA_ECONOMY_LOOPS_MODEL']
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

function writeLoopsDb(): void {
  const loopsDb = new BunDatabase(loopsDbPath)
  loopsDb.exec(`
    CREATE TABLE loops (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      labels_json TEXT DEFAULT '[]',
      target_json TEXT DEFAULT '{}',
      schedule_json TEXT DEFAULT '{}'
    );

    CREATE TABLE loop_runs (
      id TEXT PRIMARY KEY,
      loop_id TEXT,
      loop_name TEXT,
      scheduled_for TEXT,
      attempt INTEGER DEFAULT 1,
      status TEXT,
      started_at TEXT,
      finished_at TEXT,
      duration_ms INTEGER,
      error TEXT,
      goal_run_id TEXT
    );

    CREATE TABLE goals (
      id TEXT PRIMARY KEY,
      objective TEXT,
      loop_id TEXT,
      loop_run_id TEXT
    );

    CREATE TABLE goal_runs (
      id TEXT PRIMARY KEY,
      goal_id TEXT,
      loop_id TEXT,
      loop_run_id TEXT,
      workflow_run_id TEXT,
      workflow_step_id TEXT,
      phase TEXT,
      status TEXT,
      tokens_used INTEGER DEFAULT 0,
      evidence_json TEXT,
      raw_response_json TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE workflow_step_runs (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT,
      step_id TEXT,
      sequence INTEGER,
      account_profile TEXT,
      account_tool TEXT,
      goal_run_id TEXT
    );
  `)
  loopsDb.prepare(`
    INSERT INTO loops (id, name, labels_json, target_json, schedule_json)
    VALUES (?, ?, ?, ?, ?)
  `).run('loop-1', 'fleet-evaluator', '{"team":"ops"}', '{"type":"agent","provider":"codewith","model":"gpt-5-codex","agent":"codex","account_profile":"work"}', '{"type":"interval","everyMs":600000}')
  loopsDb.prepare(`
    INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at, duration_ms, error, goal_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('loop-run-1', 'loop-1', 'fleet-evaluator', '2026-06-24T10:00:00.000Z', 2, 'failed', '2026-06-24T10:00:00.000Z', '2026-06-24T10:00:10.000Z', 10000, 'judge failed', 'goal-run-1')
  loopsDb.prepare(`
    INSERT INTO goals (id, objective, loop_id, loop_run_id)
    VALUES (?, ?, ?, ?)
  `).run('goal-1', 'Evaluate fleet', 'loop-1', 'loop-run-1')
  loopsDb.prepare(`
    INSERT INTO goal_runs (id, goal_id, loop_id, loop_run_id, workflow_run_id, workflow_step_id, phase, status, tokens_used, evidence_json, raw_response_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('goal-run-1', 'goal-1', 'loop-1', 'loop-run-1', 'workflow-run-1', 'judge', 'judge', 'succeeded', 372, '{"stdout":"{\\"type\\":\\"thread.started\\",\\"thread_id\\":\\"thread-loop-1\\"}\\n"}', '{}', '2026-06-24T10:00:01.000Z', '2026-06-24T10:00:09.000Z')
  loopsDb.prepare(`
    INSERT INTO goal_runs (id, goal_id, loop_id, loop_run_id, workflow_run_id, workflow_step_id, phase, status, tokens_used, evidence_json, raw_response_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('goal-run-execute', 'goal-1', 'loop-1', 'loop-run-1', 'workflow-run-1', 'execute', 'dispatch', 'succeeded', 900, '{"stdout":"{\\"type\\":\\"thread.started\\",\\"thread_id\\":\\"thread-zero\\"}\\n"}', '{}', '2026-06-24T10:00:02.000Z', '2026-06-24T10:00:03.000Z')
  loopsDb.prepare(`
    INSERT INTO workflow_step_runs (id, workflow_run_id, step_id, sequence, account_profile, account_tool, goal_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('step-run-1', 'workflow-run-1', 'judge', 1, 'work', 'codex', 'goal-run-1')
  loopsDb.close()
}

function writeLegacyLoopsDb(): void {
  const loopsDb = new BunDatabase(loopsDbPath)
  loopsDb.exec(`
    CREATE TABLE loops (id TEXT PRIMARY KEY, name TEXT NOT NULL, labels_json TEXT DEFAULT '{}', target_json TEXT DEFAULT '{}');
    CREATE TABLE loop_runs (id TEXT PRIMARY KEY, loop_id TEXT, loop_name TEXT, started_at TEXT);
    CREATE TABLE goals (id TEXT PRIMARY KEY, objective TEXT, loop_id TEXT, loop_run_id TEXT);
    CREATE TABLE goal_runs (id TEXT PRIMARY KEY, goal_id TEXT, loop_id TEXT, loop_run_id TEXT, phase TEXT, status TEXT, tokens_used INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
    CREATE TABLE workflow_step_runs (id TEXT PRIMARY KEY, goal_run_id TEXT, account_profile TEXT, account_tool TEXT);
  `)
  loopsDb.prepare(`INSERT INTO loops (id, name, target_json) VALUES (?, ?, ?)`).run('legacy-loop', 'legacy-loop', '{"provider":"codex","model":"gpt-5-codex"}')
  loopsDb.prepare(`INSERT INTO loop_runs (id, loop_id, loop_name, started_at) VALUES (?, ?, ?, ?)`).run('legacy-run', 'legacy-loop', 'legacy-loop', '2026-06-24T10:00:00.000Z')
  loopsDb.prepare(`INSERT INTO goals (id, objective, loop_id, loop_run_id) VALUES (?, ?, ?, ?)`).run('legacy-goal', 'Legacy loop', 'legacy-loop', 'legacy-run')
  loopsDb.prepare(`INSERT INTO goal_runs (id, goal_id, loop_id, loop_run_id, phase, status, tokens_used, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('legacy-goal-run', 'legacy-goal', 'legacy-loop', 'legacy-run', 'judge', 'succeeded', 50, '2026-06-24T10:00:01.000Z', '2026-06-24T10:00:02.000Z')
  loopsDb.prepare(`INSERT INTO workflow_step_runs (id, goal_run_id, account_profile, account_tool) VALUES (?, ?, ?, ?)`)
    .run('legacy-step-run', 'legacy-goal-run', 'pro', 'codex')
  loopsDb.close()
}

describe('ingestLoops', () => {
  it('returns zero counts when the OpenLoops SQLite database is missing', async () => {
    const result = await ingestLoops(db)

    expect(result).toEqual({ sessions: 0, requests: 0 })
  })

  it('ingests loop orchestration tokens into loop cost centers without agent-spend duplication', async () => {
    process.env['HASNA_ECONOMY_LOOPS_MODEL'] = 'gpt-5-codex'
    writeLoopsDb()

    const result = await ingestLoops(db)

    expect(result).toEqual({ sessions: 1, requests: 1 })
    expect((db.prepare(`SELECT COUNT(*) as cnt FROM requests WHERE source_request_id = 'loops-goal-run-execute'`).get() as { cnt: number }).cnt).toBe(0)
    const request = db.prepare(`
      SELECT agent, session_id, model, input_tokens, output_tokens, cost_center_id,
             attribution_tag, account_key, account_tool, account_name, account_source
      FROM requests WHERE source_request_id = ?
    `).get('loops-goal-run-1') as Record<string, string | number>
    const session = db.prepare(`
      SELECT agent, project_name, cost_center_id, request_count, total_tokens, account_key
      FROM sessions WHERE id = ?
    `).get('loops-loop-run-1') as Record<string, string | number>
    const center = getCostCenter(db, 'loop:fleet-evaluator')
    const breakdown = queryCostCenterBreakdown(db, 'all', { kind: 'loop' })

    expect(request['agent']).toBe('loop')
    expect(request['session_id']).toBe('loops-loop-run-1')
    expect(request['model']).toBe('gpt-5-codex')
    expect(request['input_tokens']).toBe(372)
    expect(request['output_tokens']).toBe(0)
    expect(request['cost_center_id']).toBe('loop:fleet-evaluator')
    expect(request['attribution_tag']).toBe('loops-orchestration')
    expect(request['account_key']).toBe('codex:work')
    expect(request['account_tool']).toBe('codex')
    expect(request['account_name']).toBe('work')
    expect(request['account_source']).toBe('loops')
    expect(session['agent']).toBe('loop')
    expect(session['project_name']).toBe('fleet-evaluator')
    expect(session['cost_center_id']).toBe('loop:fleet-evaluator')
    expect(session['request_count']).toBe(1)
    expect(session['total_tokens']).toBe(372)
    expect(session['account_key']).toBe('codex:work')
    expect(center?.kind).toBe('loop')
    expect(center?.name).toBe('fleet-evaluator')
    expect(breakdown[0]?.name).toBe('fleet-evaluator')
    expect(breakdown[0]?.requests).toBe(1)
    expect(breakdown[0]?.total_tokens).toBe(372)

    const attribution = queryLoopAttributions(db, { loop: 'fleet-evaluator', provider: 'codewith', account: 'work', model: 'gpt-5' })
    expect(attribution).toHaveLength(2)
    const charged = attribution.find(row => row.goal_run_id === 'goal-run-1')
    expect(charged).toMatchObject({
      request_id: 'loops-goal-run-1',
      session_id: 'loops-loop-run-1',
      loop_id: 'loop-1',
      loop_name: 'fleet-evaluator',
      loop_run_id: 'loop-run-1',
      goal_id: 'goal-1',
      workflow_run_id: 'workflow-run-1',
      workflow_step_id: 'judge',
      thread_id: 'thread-loop-1',
      provider: 'codewith',
      model: 'gpt-5-codex',
      account_key: 'codex:work',
      schedule_json: '{"type":"interval","everyMs":600000}',
      scheduled_for: '2026-06-24T10:00:00.000Z',
      duration_ms: 10000,
      attempt: 2,
      tokens: 372,
      cost_basis: 'subscription_included',
    })
    expect(charged?.api_equivalent_usd).toBeGreaterThan(0)
    expect(charged?.subscription_included_usd).toBe(charged?.api_equivalent_usd)
    expect(charged?.failure_retry_usd).toBe(charged?.api_equivalent_usd)
    const executeOnly = attribution.find(row => row.goal_run_id === 'goal-run-execute')
    expect(executeOnly).toMatchObject({
      request_id: '',
      thread_id: 'thread-zero',
      tokens: 900,
      api_equivalent_usd: 0,
      subscription_included_usd: 0,
      billable_usd: 0,
      failure_retry_usd: 0,
      cost_basis: 'estimated',
    })

    const efficiency = queryLoopEfficiency(db, { loop: 'fleet-evaluator' })
    expect(efficiency.totals.row_count).toBe(2)
    expect(efficiency.totals.runs).toBe(1)
    expect(efficiency.totals.tokens).toBe(1272)
    expect(efficiency.totals.failure_retry_usd).toBe(charged?.api_equivalent_usd)
  })

  it('ingests legacy OpenLoops schemas with missing optional columns', async () => {
    process.env['HASNA_ECONOMY_LOOPS_MODEL'] = 'gpt-5-codex'
    writeLegacyLoopsDb()

    const result = await ingestLoops(db)

    expect(result).toEqual({ sessions: 1, requests: 1 })
    const attribution = queryLoopAttributions(db, { loop: 'legacy-loop' })
    expect(attribution).toHaveLength(1)
    expect(attribution[0]).toMatchObject({
      loop_id: 'legacy-loop',
      loop_name: 'legacy-loop',
      loop_run_id: 'legacy-run',
      workflow_run_id: '',
      workflow_step_id: '',
      schedule_json: '{}',
      tokens: 50,
      provider: 'codex',
      model: 'gpt-5-codex',
      account_key: 'codex:pro',
    })
  })
})
