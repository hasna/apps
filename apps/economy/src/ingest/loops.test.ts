import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Database as BunDatabase } from 'bun:sqlite'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getCostCenter, openDatabase, queryCostCenterBreakdown } from '../db/database.js'
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
      target_json TEXT DEFAULT '{}'
    );

    CREATE TABLE loop_runs (
      id TEXT PRIMARY KEY,
      loop_id TEXT,
      loop_name TEXT,
      started_at TEXT,
      finished_at TEXT,
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
      phase TEXT,
      status TEXT,
      tokens_used INTEGER DEFAULT 0,
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
    INSERT INTO loops (id, name, labels_json, target_json)
    VALUES (?, ?, ?, ?)
  `).run('loop-1', 'fleet-evaluator', '{"team":"ops"}', '{"agent":"codex","account_profile":"work"}')
  loopsDb.prepare(`
    INSERT INTO loop_runs (id, loop_id, loop_name, started_at, finished_at, goal_run_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('loop-run-1', 'loop-1', 'fleet-evaluator', '2026-06-24T10:00:00.000Z', '2026-06-24T10:00:10.000Z', 'goal-run-1')
  loopsDb.prepare(`
    INSERT INTO goals (id, objective, loop_id, loop_run_id)
    VALUES (?, ?, ?, ?)
  `).run('goal-1', 'Evaluate fleet', 'loop-1', 'loop-run-1')
  loopsDb.prepare(`
    INSERT INTO goal_runs (id, goal_id, loop_id, loop_run_id, phase, status, tokens_used, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('goal-run-1', 'goal-1', 'loop-1', 'loop-run-1', 'judge', 'succeeded', 372, '2026-06-24T10:00:01.000Z', '2026-06-24T10:00:09.000Z')
  loopsDb.prepare(`
    INSERT INTO goal_runs (id, goal_id, loop_id, loop_run_id, phase, status, tokens_used, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('goal-run-empty', 'goal-1', 'loop-1', 'loop-run-1', 'dispatch', 'succeeded', 0, '2026-06-24T10:00:02.000Z', '2026-06-24T10:00:03.000Z')
  loopsDb.prepare(`
    INSERT INTO workflow_step_runs (id, workflow_run_id, step_id, sequence, account_profile, account_tool, goal_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('step-run-1', 'workflow-run-1', 'judge', 1, 'work', 'codex', 'goal-run-1')
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
  })
})
