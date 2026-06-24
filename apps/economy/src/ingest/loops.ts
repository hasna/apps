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
  upsertLoopAttribution,
  upsertRequest,
  upsertSession,
} from '../db/database.js'
import { computeCostFromDb } from '../lib/pricing.js'
import type { CostBasis } from '../lib/agents.js'

const DEFAULT_LOOPS_DB_PATH = join(homedir(), '.hasna', 'loops', 'loops.db')
const LOOPS_INGEST_VERSION = 'goal-runs-orchestration-v1'

type LoopGoalRunRow = {
  goal_run_id: string
  goal_id: string
  loop_id: string | null
  loop_run_id: string | null
  workflow_run_id: string | null
  workflow_step_id: string | null
  loop_name: string | null
  labels_json: string | null
  target_json: string | null
  schedule_json: string | null
  objective: string | null
  phase: string | null
  status: string | null
  loop_status: string | null
  tokens_used: number
  scheduled_for: string | null
  created_at: string | null
  updated_at: string | null
  loop_run_started_at: string | null
  loop_run_finished_at: string | null
  duration_ms: number | null
  attempt: number | null
  evidence_json: string | null
  raw_response_json: string | null
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

function tableColumns(db: BunDatabase, table: string): Set<string> {
  try {
    return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name))
  } catch {
    return new Set()
  }
}

function selectColumn(columns: Set<string>, alias: string, column: string, fallback: string): string {
  return columns.has(column) ? `${alias}.${column}` : fallback
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

function providerFromTarget(row: LoopGoalRunRow): string {
  const target = parseTarget(row.target_json)
  return stringValue(target['provider'])
    || stringValue(target['tool'])
    || stringValue(target['agent'])
    || row.account_tool
    || 'loops'
}

function modelFromTarget(row: LoopGoalRunRow, fallback: string): string {
  const target = parseTarget(row.target_json)
  return stringValue(target['model'])
    || stringValue(target['model_id'])
    || stringValue(target['agent_model'])
    || fallback
}

function threadIdFromJsonText(raw: string | null): string {
  if (!raw) return ''
  const match = raw.match(/"thread_id"\s*:\s*"([^"]+)"/)
    ?? raw.match(/\\"thread_id\\"\s*:\s*\\"([^"\\]+)\\"/)
  return match?.[1] ?? ''
}

function threadIdForRow(row: LoopGoalRunRow): string {
  return threadIdFromJsonText(row.evidence_json) || threadIdFromJsonText(row.raw_response_json)
}

function costBasisForProvider(provider: string, tokens: number): CostBasis {
  if (tokens <= 0) return 'estimated'
  const normalized = provider.toLowerCase()
  if (['codewith', 'codex', 'claude'].includes(normalized)) return 'subscription_included'
  if (normalized === 'cursor') return process.env['CURSOR_SESSION_TOKEN'] ? 'subscription_included' : 'estimated'
  if (normalized && normalized !== 'deterministic' && normalized !== 'loops') return 'metered_api'
  return 'estimated'
}

function isOrchestrationPhase(row: LoopGoalRunRow): boolean {
  const phase = (row.phase || '').toLowerCase()
  const status = (row.status || '').toLowerCase()
  const text = `${phase} ${status}`
  if (/(execute|execution|worker|coding-agent|agent-run|dispatch|tool-call)/.test(text)) return false
  if (!phase) return false
  return /(judge|review|validate|validation|evaluate|evaluation|plan|planning|planner|orchestrat|coordinat|monitor|schedule)/.test(phase)
}

function isFailureOrRetry(row: LoopGoalRunRow): boolean {
  return (row.attempt ?? 0) > 1
    || row.loop_status === 'failed'
    || row.status === 'failed'
    || row.status === 'blocked'
}

function readLoopGoalRuns(loopsDb: BunDatabase): LoopGoalRunRow[] {
  const loopsColumns = tableColumns(loopsDb, 'loops')
  const loopRunColumns = tableColumns(loopsDb, 'loop_runs')
  const goalColumns = tableColumns(loopsDb, 'goals')
  const goalRunColumns = tableColumns(loopsDb, 'goal_runs')
  const workflowStepRunColumns = tableColumns(loopsDb, 'workflow_step_runs')
  const workflowStepJoin = workflowStepRunColumns.has('goal_run_id')
    ? `
    LEFT JOIN (
      SELECT goal_run_id,
             MIN(${workflowStepRunColumns.has('account_profile') ? 'account_profile' : "''"}) as account_profile,
             MIN(${workflowStepRunColumns.has('account_tool') ? 'account_tool' : "''"}) as account_tool
      FROM workflow_step_runs
      WHERE goal_run_id IS NOT NULL
      GROUP BY goal_run_id
    ) wsr ON wsr.goal_run_id = gr.id`
    : ''
  return loopsDb.prepare(`
    SELECT
      gr.id as goal_run_id,
      ${selectColumn(goalRunColumns, 'gr', 'goal_id', "''")} as goal_id,
      COALESCE(${selectColumn(goalRunColumns, 'gr', 'loop_id', 'NULL')}, ${selectColumn(goalColumns, 'g', 'loop_id', 'NULL')}, ${selectColumn(loopRunColumns, 'lr', 'loop_id', 'NULL')}) as loop_id,
      COALESCE(${selectColumn(goalRunColumns, 'gr', 'loop_run_id', 'NULL')}, ${selectColumn(goalColumns, 'g', 'loop_run_id', 'NULL')}, lr.id) as loop_run_id,
      ${selectColumn(goalRunColumns, 'gr', 'workflow_run_id', 'NULL')} as workflow_run_id,
      ${selectColumn(goalRunColumns, 'gr', 'workflow_step_id', 'NULL')} as workflow_step_id,
      COALESCE(${selectColumn(loopsColumns, 'l', 'name', 'NULL')}, ${selectColumn(loopRunColumns, 'lr', 'loop_name', 'NULL')}, 'unknown-loop') as loop_name,
      ${selectColumn(loopsColumns, 'l', 'labels_json', "'{}'")} as labels_json,
      ${selectColumn(loopsColumns, 'l', 'target_json', "'{}'")} as target_json,
      ${selectColumn(loopsColumns, 'l', 'schedule_json', "'{}'")} as schedule_json,
      ${selectColumn(goalColumns, 'g', 'objective', 'NULL')} as objective,
      ${selectColumn(goalRunColumns, 'gr', 'phase', 'NULL')} as phase,
      ${selectColumn(goalRunColumns, 'gr', 'status', 'NULL')} as status,
      ${selectColumn(loopRunColumns, 'lr', 'status', 'NULL')} as loop_status,
      COALESCE(${selectColumn(goalRunColumns, 'gr', 'tokens_used', '0')}, 0) as tokens_used,
      ${selectColumn(loopRunColumns, 'lr', 'scheduled_for', 'NULL')} as scheduled_for,
      ${selectColumn(goalRunColumns, 'gr', 'created_at', 'NULL')} as created_at,
      ${selectColumn(goalRunColumns, 'gr', 'updated_at', 'NULL')} as updated_at,
      ${selectColumn(loopRunColumns, 'lr', 'started_at', 'NULL')} as loop_run_started_at,
      ${selectColumn(loopRunColumns, 'lr', 'finished_at', 'NULL')} as loop_run_finished_at,
      ${selectColumn(loopRunColumns, 'lr', 'duration_ms', 'NULL')} as duration_ms,
      ${selectColumn(loopRunColumns, 'lr', 'attempt', 'NULL')} as attempt,
      ${selectColumn(goalRunColumns, 'gr', 'evidence_json', 'NULL')} as evidence_json,
      ${selectColumn(goalRunColumns, 'gr', 'raw_response_json', 'NULL')} as raw_response_json,
      ${workflowStepJoin ? 'wsr.account_profile' : "''"} as account_profile,
      ${workflowStepJoin ? 'wsr.account_tool' : "''"} as account_tool
    FROM goal_runs gr
    LEFT JOIN goals g ON g.id = ${selectColumn(goalRunColumns, 'gr', 'goal_id', "''")}
    LEFT JOIN loop_runs lr ON lr.id = COALESCE(${selectColumn(goalRunColumns, 'gr', 'loop_run_id', 'NULL')}, ${selectColumn(goalColumns, 'g', 'loop_run_id', 'NULL')})
    LEFT JOIN loops l ON l.id = COALESCE(${selectColumn(goalRunColumns, 'gr', 'loop_id', 'NULL')}, ${selectColumn(goalColumns, 'g', 'loop_id', 'NULL')}, ${selectColumn(loopRunColumns, 'lr', 'loop_id', 'NULL')})
    ${workflowStepJoin}
    ORDER BY ${selectColumn(goalRunColumns, 'gr', 'created_at', 'NULL')} ASC, gr.id ASC
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
      const provider = providerFromTarget(row)
      const rowModel = modelFromTarget(row, model)
      const materializeLoopRequest = row.tokens_used > 0 && isOrchestrationPhase(row)
      const costBasis = materializeLoopRequest ? costBasisForProvider(provider, row.tokens_used) : 'estimated'
      const costUsd = materializeLoopRequest ? computeCostFromDb(db, rowModel, row.tokens_used, 0) : 0
      const stateValue = [
        LOOPS_INGEST_VERSION,
        row.updated_at ?? '',
        row.tokens_used,
        rowModel,
        costCenterId,
        row.loop_status ?? '',
        row.status ?? '',
        row.duration_ms ?? 0,
        row.attempt ?? 0,
        materializeLoopRequest ? 'costed' : 'attribution-only',
      ].join(':')
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
      if (materializeLoopRequest) {
        const inputTokens = row.tokens_used
        const outputTokens = 0
        upsertRequest(db, {
          id: requestId,
          agent: 'loop',
          session_id: sessionId,
          model: rowModel,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: 0,
          cache_create_tokens: 0,
          cost_usd: costUsd,
          cost_basis: costBasis,
          duration_ms: row.duration_ms ?? 0,
          timestamp,
          source_request_id: requestId,
          machine_id: machineId,
          cost_center_id: costCenterId,
          attribution_tag: 'loops-orchestration',
          ...account,
        })
        requests++
      }

      upsertLoopAttribution(db, {
        id: requestId,
        request_id: materializeLoopRequest ? requestId : '',
        session_id: sessionId,
        loop_id: row.loop_id ?? '',
        loop_name: loopName,
        loop_run_id: row.loop_run_id ?? '',
        goal_id: row.goal_id,
        goal_run_id: row.goal_run_id,
        workflow_run_id: row.workflow_run_id ?? '',
        workflow_step_id: row.workflow_step_id ?? '',
        thread_id: threadIdForRow(row),
        account_key: account.account_key,
        account_tool: account.account_tool,
        account_name: account.account_name,
        provider,
        model: rowModel,
        phase: row.phase ?? '',
        status: row.status ?? '',
        loop_status: row.loop_status ?? '',
        schedule_json: row.schedule_json ?? '{}',
        scheduled_for: row.scheduled_for ?? '',
        started_at: row.loop_run_started_at ?? row.created_at ?? timestamp,
        finished_at: row.loop_run_finished_at ?? row.updated_at ?? '',
        duration_ms: row.duration_ms ?? 0,
        attempt: row.attempt ?? 0,
        tokens: row.tokens_used,
        api_equivalent_usd: costUsd,
        subscription_included_usd: costBasis === 'subscription_included' ? costUsd : 0,
        billable_usd: costBasis === 'metered_api' ? costUsd : 0,
        failure_retry_usd: isFailureOrRetry(row) ? costUsd : 0,
        cost_basis: costBasis,
        machine_id: machineId,
        created_at: row.created_at ?? timestamp,
        updated_at: timestamp,
      })

      sessions.add(sessionId)
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
