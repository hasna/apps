import type { Database } from '../db/database.js'
import {
  getIngestState, setIngestState, getMachineId,
  upsertRequest, upsertSession, rollupSession, upsertUsageSnapshot,
} from '../db/database.js'
import { resolveAccountForAgent, withAccount } from '../lib/accounts.js'

interface CursorUsageResponse {
  premiumRequests?: number
  maxPremiumRequests?: number
  gpt4Requests?: number
}

interface CursorUsageSummary {
  individualUsage?: { spend?: number; includedSpend?: number }
  teamUsage?: { spend?: number }
}

function getCursorSessionToken(): string | null {
  return process.env['CURSOR_SESSION_TOKEN'] ?? process.env['CURSOR_API_TOKEN'] ?? null
}

async function cursorFetch(path: string, token: string): Promise<unknown | null> {
  try {
    const res = await fetch(`https://cursor.com${path}`, {
      headers: {
        Cookie: `WorkosCursorSessionToken=${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function ingestCursor(db: Database, verbose = false): Promise<{ requests: number; snapshots: number }> {
  const token = getCursorSessionToken()
  if (!token) {
    if (verbose) console.log('  cursor: skipped — set CURSOR_SESSION_TOKEN')
    return { requests: 0, snapshots: 0 }
  }

  const today = new Date().toISOString().substring(0, 10)
  const prev = getIngestState(db, 'cursor', `sync-${today}`)
  if (prev) return { requests: 0, snapshots: 0 }

  const machineId = getMachineId()
  const now = new Date().toISOString()
  let snapshots = 0
  const account = await resolveAccountForAgent('cursor')

  const usage = await cursorFetch('/api/usage', token) as CursorUsageResponse | null
  if (usage?.premiumRequests != null && usage.maxPremiumRequests) {
    upsertUsageSnapshot(db, {
      agent: 'cursor',
      date: today,
      metric: 'premium_requests_used',
      value: usage.premiumRequests,
      unit: 'count',
      machine_id: machineId,
    })
    upsertUsageSnapshot(db, {
      agent: 'cursor',
      date: today,
      metric: 'premium_requests_limit',
      value: usage.maxPremiumRequests,
      unit: 'count',
      machine_id: machineId,
    })
    snapshots += 2
  }

  const summary = await cursorFetch('/api/usage-summary', token) as CursorUsageSummary | null
  const onDemand = summary?.individualUsage?.spend ?? summary?.teamUsage?.spend ?? 0
  const included = summary?.individualUsage?.includedSpend ?? 0
  if (onDemand > 0) {
    upsertUsageSnapshot(db, {
      agent: 'cursor',
      date: today,
      metric: 'on_demand_usd',
      value: onDemand,
      unit: 'usd',
      machine_id: machineId,
    })
    snapshots++
  }
  if (included > 0) {
    upsertUsageSnapshot(db, {
      agent: 'cursor',
      date: today,
      metric: 'included_consumed_usd',
      value: included,
      unit: 'usd',
      machine_id: machineId,
    })
    snapshots++
  }

  const sessionId = `cursor-${today}-${machineId}`
  if (onDemand + included > 0) {
    upsertSession(db, withAccount({
      id: sessionId,
      agent: 'cursor',
      project_path: '',
      project_name: 'Cursor subscription',
      started_at: `${today}T00:00:00.000Z`,
      ended_at: now,
      total_cost_usd: onDemand + included,
      total_tokens: 0,
      request_count: 1,
      machine_id: machineId,
      updated_at: now,
    }, account))
    upsertRequest(db, withAccount({
      id: `cursor-${today}-${machineId}-usage`,
      agent: 'cursor',
      session_id: sessionId,
      model: 'cursor-subscription',
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_create_tokens: 0,
      cost_usd: onDemand + included,
      cost_basis: 'subscription_included',
      duration_ms: 0,
      timestamp: now,
      source_request_id: today,
      machine_id: machineId,
      updated_at: now,
    }, account))
    rollupSession(db, sessionId)
  }

  setIngestState(db, 'cursor', `sync-${today}`, now)
  if (verbose) console.log(`  cursor: on-demand $${onDemand.toFixed(2)}, included $${included.toFixed(2)}`)
  return { requests: onDemand + included > 0 ? 1 : 0, snapshots }
}
