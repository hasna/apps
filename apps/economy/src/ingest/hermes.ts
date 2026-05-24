import { existsSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { SqliteAdapter as Database } from '@hasna/cloud'
import {
  upsertRequest, upsertSession, rollupSession,
  getIngestState, setIngestState, getMachineId,
} from '../db/database.js'
import { defaultCostBasisForAgent } from '../lib/savings.js'

const HERMES_DB = join(homedir(), '.hermes', 'state.db')

interface HermesSessionRow {
  id: string
  source: string
  model: string | null
  started_at: number
  ended_at: number | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  estimated_cost_usd: number | null
  actual_cost_usd: number | null
  billing_mode: string | null
  parent_session_id: string | null
}

function mapCostBasis(billingMode: string | null): import('../lib/agents.js').CostBasis {
  if (billingMode === 'subscription') return 'subscription_included'
  if (billingMode === 'api') return 'metered_api'
  return defaultCostBasisForAgent('hermes')
}

export async function ingestHermes(db: Database, verbose = false): Promise<{ sessions: number; requests: number }> {
  if (!existsSync(HERMES_DB)) {
    return { sessions: 0, requests: 0 }
  }

  const { Database: Sqlite } = await import('bun:sqlite')
  const hermes = new Sqlite(HERMES_DB, { readonly: true })
  const rows = hermes.prepare(`
    SELECT id, source, model, started_at, ended_at,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           reasoning_tokens, estimated_cost_usd, actual_cost_usd, billing_mode, parent_session_id
    FROM sessions
    ORDER BY started_at DESC
  `).all() as HermesSessionRow[]

  const stateKey = 'state.db'
  const mtime = statSyncSafe(HERMES_DB)
  const prev = getIngestState(db, 'hermes', stateKey)
  if (prev && Number(prev) >= mtime && rows.length === 0) {
    hermes.close()
    return { sessions: 0, requests: 0 }
  }

  const machineId = getMachineId()
  const now = new Date().toISOString()
  let requests = 0

  for (const row of rows) {
    const sessionId = `hermes-${row.id}`
    const startedAt = new Date(row.started_at * 1000).toISOString()
    const endedAt = row.ended_at ? new Date(row.ended_at * 1000).toISOString() : null
    const cost = row.actual_cost_usd ?? row.estimated_cost_usd ?? 0
    const tokens = row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens + row.reasoning_tokens

    upsertSession(db, {
      id: sessionId,
      agent: 'hermes',
      project_path: row.source ?? '',
      project_name: row.source ?? '',
      started_at: startedAt,
      ended_at: endedAt,
      total_cost_usd: cost,
      total_tokens: tokens,
      request_count: 1,
      machine_id: machineId,
      updated_at: now,
    })

    const reqId = `hermes-${row.id}-rollup`
    upsertRequest(db, {
      id: reqId,
      agent: 'hermes',
      session_id: sessionId,
      model: row.model ?? 'unknown',
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens + row.reasoning_tokens,
      cache_read_tokens: row.cache_read_tokens,
      cache_create_tokens: row.cache_write_tokens,
      cost_usd: cost,
      cost_basis: mapCostBasis(row.billing_mode),
      duration_ms: 0,
      timestamp: endedAt ?? startedAt,
      source_request_id: row.id,
      machine_id: machineId,
      updated_at: now,
    })
    requests++
    rollupSession(db, sessionId)
    if (verbose) console.log(`  hermes: ${sessionId} $${cost.toFixed(4)}`)
  }

  setIngestState(db, 'hermes', stateKey, String(mtime))
  hermes.close()
  return { sessions: rows.length, requests }
}

function statSyncSafe(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}
