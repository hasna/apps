import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Database as BunDatabase } from 'bun:sqlite'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDatabase } from '../db/database.js'
import { syncAll } from './sync-all.js'

let root: string
let loopsDbPath: string

beforeEach(() => {
  root = join(tmpdir(), `economy-sync-all-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(root, { recursive: true })
  loopsDbPath = join(root, 'loops.db')
  process.env['HASNA_ECONOMY_LOOPS_DB_PATH'] = loopsDbPath
  process.env['HASNA_ECONOMY_CODEX_DB_PATH'] = join(root, 'missing-codex.sqlite')
})

afterEach(() => {
  delete process.env['HASNA_ECONOMY_LOOPS_DB_PATH']
  delete process.env['HASNA_ECONOMY_CODEX_DB_PATH']
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

function writeLoopsDb(): void {
  const loopsDb = new BunDatabase(loopsDbPath)
  loopsDb.exec(`
    CREATE TABLE loops (id TEXT PRIMARY KEY, name TEXT NOT NULL, labels_json TEXT DEFAULT '{}', target_json TEXT DEFAULT '{}', schedule_json TEXT DEFAULT '{}');
    CREATE TABLE loop_runs (id TEXT PRIMARY KEY, loop_id TEXT, loop_name TEXT, scheduled_for TEXT, status TEXT, started_at TEXT, finished_at TEXT, duration_ms INTEGER, attempt INTEGER DEFAULT 1);
    CREATE TABLE goals (id TEXT PRIMARY KEY, objective TEXT, loop_id TEXT, loop_run_id TEXT);
    CREATE TABLE goal_runs (id TEXT PRIMARY KEY, goal_id TEXT, loop_id TEXT, loop_run_id TEXT, workflow_run_id TEXT, workflow_step_id TEXT, phase TEXT, status TEXT, tokens_used INTEGER DEFAULT 0, evidence_json TEXT, raw_response_json TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE workflow_step_runs (id TEXT PRIMARY KEY, goal_run_id TEXT, account_profile TEXT, account_tool TEXT);
  `)
  loopsDb.prepare(`INSERT INTO loops (id, name, target_json, schedule_json) VALUES (?, ?, ?, ?)`)
    .run('loop-1', 'sync-loop', '{"provider":"codex","model":"gpt-5-codex"}', '{"type":"interval","minutes":15}')
  loopsDb.prepare(`INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, status, started_at, finished_at, duration_ms, attempt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('run-1', 'loop-1', 'sync-loop', '2026-06-24T10:00:00.000Z', 'succeeded', '2026-06-24T10:00:00.000Z', '2026-06-24T10:00:02.000Z', 2000, 1)
  loopsDb.prepare(`INSERT INTO goals (id, objective, loop_id, loop_run_id) VALUES (?, ?, ?, ?)`).run('goal-1', 'Sync loop', 'loop-1', 'run-1')
  loopsDb.prepare(`INSERT INTO goal_runs (id, goal_id, loop_id, loop_run_id, workflow_run_id, workflow_step_id, phase, status, tokens_used, evidence_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('goal-run-1', 'goal-1', 'loop-1', 'run-1', 'workflow-run-1', 'workflow-step-1', 'judge', 'succeeded', 50, '{"thread_id":"thread-1"}', '2026-06-24T10:00:01.000Z', '2026-06-24T10:00:02.000Z')
  loopsDb.prepare(`INSERT INTO workflow_step_runs (id, goal_run_id, account_profile, account_tool) VALUES (?, ?, ?, ?)`)
    .run('step-run-1', 'goal-run-1', 'pro', 'codex')
  loopsDb.close()
}

describe('syncAll', () => {
  it('runs loops ingest for explicit loops sync', async () => {
    writeLoopsDb()
    const db = openDatabase(':memory:', true)

    const result = await syncAll(db, { loops: true })

    expect(result.loops).toEqual({ sessions: 1, requests: 1 })
    expect((db.prepare(`SELECT COUNT(*) as cnt FROM requests WHERE agent = 'loop'`).get() as { cnt: number }).cnt).toBe(1)
    expect((db.prepare(`SELECT COUNT(*) as cnt FROM loop_attributions WHERE loop_id = 'loop-1' AND thread_id = 'thread-1'`).get() as { cnt: number }).cnt).toBe(1)
  })
})
