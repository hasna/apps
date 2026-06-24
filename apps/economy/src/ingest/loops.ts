import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { Database as BunDatabase } from 'bun:sqlite'
import type { SqliteAdapter as Database } from '@hasna/cloud'
import {
  getIngestState,
  getMachineId,
  rollupSession,
  setIngestState,
  upsertCostCenter,
  upsertRequest,
  upsertSession,
} from '../db/database.js'
import { computeCostFromDb } from '../lib/pricing.js'

const DEFAULT_LOOPS_DB_PATH = join(homedir(), '.hasna', 'loops', 'loops.db')
const LOOPS_INGEST_VERSION = 'goal-runs-orchestration-v1'

type LoopGoalRunRow = {
  goal_run_id: string
  goal_id: string
  loop_id: string | null
  loop_run_id: string | null
  loop_name: string | null
  labels_json: string | null
  target_json: string | null
  objective: string | null
  phase: string | null
  status: string | null
  tokens_used: number
  created_at: string | null
  updated_at: string | null
  loop_run_started_at: string | null
  account_profile: string | null
  account_tool: string | null
}

function loopsDbPath(): string {
  return process.env['HASNA_ECONOMY_LOOPS_DB_PATH'] ?? DEFAULT_LOOPS_DB_PATH
}

function loopsModel(): string {
  return process.env['HASNA_ECONOMY_LOOPS_MODEL'] ?? process.env['ECONOMY_LOOPS_MODEL'] ?? 'gpt-5.3-codex'
}

function openLoopsDb(dbPath: string, verbose: boolean): BunDatabase | null {
  let lastError: unknown
  for (const readonly of [true, false]) {
    let loopsDb: BunDatabase | null = null
    try {
      loopsDb = readonly ? new BunDatabase(dbPath, { readonly: true }) : new BunDatabase(dbPath)
      loopsDb.prepare('PRAGMA schema_version').get()
      return loopsDb
    } catch (error) {
      lastError = error
      loopsDb?.close()
    }
  }
  if (verbose) {
    const message = lastError instanceof Error ? lastError.message : String(lastError)
    console.log('OpenLoops DB unreadable:', dbPath, message)
  }
  return null
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'
}

function parseTarget(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function accountFields(row: LoopGoalRunRow): {
  account_key: string
  account_tool: string
  account_name: string
  account_source: string
} {
  const target = parseTarget(row.target_json)
  const tool = stringValue(row.account_tool)
    || stringValue(target['account_tool'])
    || stringValue(target['tool'])
    || stringValue(target['agent'])
  const profile = stringValue(row.account_profile)
    || stringValue(target['account_profile'])
    || stringValue(target['profile'])
    || stringValue(target['account'])
  if (!tool || !profile) {
    return { account_key: '', account_tool: tool, account_name: profile, account_source: '' }
  }
  return {
    account_key: `${tool}:${profile}`,
    account_tool: tool,
    account_name: profile,
    account_source: 'loops',
  }
}

function readLoopGoalRuns(loopsDb: BunDatabase): LoopGoalRunRow[] {
  return loopsDb.prepare(`
    SELECT
      gr.id as goal_run_id,
      gr.goal_id as goal_id,
      COALESCE(gr.loop_id, g.loop_id, lr.loop_id) as loop_id,
      COALESCE(gr.loop_run_id, g.loop_run_id, lr.id) as loop_run_id,
      COALESCE(l.name, lr.loop_name, 'unknown-loop') as loop_name,
      l.labels_json as labels_json,
      l.target_json as target_json,
      g.objective as objective,
      gr.phase as phase,
      gr.status as status,
      COALESCE(gr.tokens_used, 0) as tokens_used,
      gr.created_at as created_at,
      gr.updated_at as updated_at,
      lr.started_at as loop_run_started_at,
      wsr.account_profile as account_profile,
      wsr.account_tool as account_tool
    FROM goal_runs gr
    LEFT JOIN goals g ON g.id = gr.goal_id
    LEFT JOIN loop_runs lr ON lr.id = COALESCE(gr.loop_run_id, g.loop_run_id)
    LEFT JOIN loops l ON l.id = COALESCE(gr.loop_id, g.loop_id, lr.loop_id)
    LEFT JOIN (
      SELECT goal_run_id, MIN(account_profile) as account_profile, MIN(account_tool) as account_tool
      FROM workflow_step_runs
      WHERE goal_run_id IS NOT NULL
      GROUP BY goal_run_id
    ) wsr ON wsr.goal_run_id = gr.id
    WHERE COALESCE(gr.tokens_used, 0) > 0
    ORDER BY gr.created_at ASC, gr.id ASC
  `).all() as LoopGoalRunRow[]
}

export async function ingestLoops(db: Database, verbose = false): Promise<{ sessions: number; requests: number }> {
  const dbPath = loopsDbPath()
  if (!existsSync(dbPath)) {
    if (verbose) console.log('OpenLoops DB not found:', dbPath)
    return { sessions: 0, requests: 0 }
  }

  const model = loopsModel()
  const machineId = getMachineId()
  let loopsDb: BunDatabase | null = null
  let requests = 0
  const sessions = new Set<string>()

  try {
    loopsDb = openLoopsDb(dbPath, verbose)
    if (!loopsDb) return { sessions: 0, requests: 0 }

    for (const row of readLoopGoalRuns(loopsDb)) {
      const loopName = row.loop_name || 'unknown-loop'
      const costCenterId = `loop:${slug(loopName)}`
      const sessionId = `loops-${row.loop_run_id ?? row.loop_id ?? row.goal_id}`
      const requestId = `loops-${row.goal_run_id}`
      const timestamp = row.updated_at ?? row.created_at ?? row.loop_run_started_at ?? new Date().toISOString()
      const stateValue = `${LOOPS_INGEST_VERSION}:${row.updated_at ?? ''}:${row.tokens_used}:${model}:${costCenterId}`
      if (getIngestState(db, 'loops', row.goal_run_id) === stateValue) continue

      upsertCostCenter(db, {
        id: costCenterId,
        kind: 'loop',
        name: loopName,
        repo_path: null,
        labels_json: row.labels_json ?? '{}',
        created_at: row.created_at ?? timestamp,
      })

      const account = accountFields(row)
      upsertSession(db, {
        id: sessionId,
        agent: 'loop',
        project_path: '',
        project_name: loopName,
        started_at: row.loop_run_started_at ?? row.created_at ?? timestamp,
        ended_at: row.updated_at ?? null,
        total_cost_usd: 0,
        total_tokens: 0,
        request_count: 0,
        machine_id: machineId,
        cost_center_id: costCenterId,
        attribution_tag: 'loops-orchestration',
        ...account,
      })

      // OpenLoops goal_runs record orchestrator/judge tokens only. Do not ingest
      // dispatched coding-agent work here; the heavy agent spend is captured by
      // the per-agent ingesters and can be analyzed alongside this loop cost
      // center through account/profile attribution without double-counting it.
      const inputTokens = row.tokens_used
      const outputTokens = 0
      upsertRequest(db, {
        id: requestId,
        agent: 'loop',
        session_id: sessionId,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: 0,
        cache_create_tokens: 0,
        cost_usd: computeCostFromDb(db, model, inputTokens, outputTokens),
        cost_basis: 'estimated',
        duration_ms: 0,
        timestamp,
        source_request_id: requestId,
        machine_id: machineId,
        cost_center_id: costCenterId,
        attribution_tag: 'loops-orchestration',
        ...account,
      })

      sessions.add(sessionId)
      requests++
      setIngestState(db, 'loops', row.goal_run_id, stateValue)
      if (verbose) console.log(`OpenLoops ${loopName}: ${row.tokens_used} orchestration tokens`)
    }
  } catch (error) {
    if (verbose) {
      const message = error instanceof Error ? error.message : String(error)
      console.log('OpenLoops ingest skipped:', message)
    }
    return { sessions: 0, requests: 0 }
  } finally {
    loopsDb?.close()
  }

  for (const sessionId of sessions) rollupSession(db, sessionId)
  return { sessions: sessions.size, requests }
}
