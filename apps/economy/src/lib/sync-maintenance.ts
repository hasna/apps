// ── Sync maintenance helpers (shared by the local and cloud sync paths) ──────
//
// Extracted from the CLI `sync` action so the local SQLite path and the
// cloud-client path (cloud-ingest.ts) run the SAME backfill/recalculate logic
// on their respective databases — one implementation, two stores.

import type { SqliteAdapter as Database } from '../db/sqlite-adapter.js'
import { getMachineId, rollupSession, queryZeroCostTokenizedModels } from '../db/database.js'
import type { ZeroCostModelBreakdown } from '../types/index.js'

/** Tag rows that carry no machine_id with the current machine id. */
export function backfillMachineId(db: Database): { requests: number; sessions: number } {
  const machine = getMachineId()
  const reqCount = db.prepare(`UPDATE requests SET machine_id = ? WHERE machine_id = '' OR machine_id IS NULL`).run(machine)
  const sessCount = db.prepare(`UPDATE sessions SET machine_id = ? WHERE machine_id = '' OR machine_id IS NULL`).run(machine)
  return { requests: Number(reqCount.changes), sessions: Number(sessCount.changes) }
}

export interface RecalculateResult {
  fixed: number
  total: number
  buckets: ZeroCostModelBreakdown[]
}

/** Re-price zero-cost requests from the pricing table; re-rolls touched sessions. */
export async function recalculateZeroCostRequests(db: Database): Promise<RecalculateResult> {
  // Dynamic import: pricing imports db, so a static import would be circular.
  const { computeCostFromDb } = await import('./pricing.js')
  const zeroRows = db.prepare(
    `SELECT id, model, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cache_create_5m_tokens, cache_create_1h_tokens
     FROM requests
     WHERE cost_usd = 0
       AND (input_tokens > 0 OR output_tokens > 0 OR cache_read_tokens > 0 OR cache_create_tokens > 0)`,
  ).all() as Array<{
    id: string
    model: string
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_create_tokens: number
    cache_create_5m_tokens?: number
    cache_create_1h_tokens?: number
  }>

  let fixed = 0
  for (const r of zeroRows) {
    const cache5m = r.cache_create_5m_tokens ?? r.cache_create_tokens
    const cost = computeCostFromDb(db, r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens, cache5m, r.cache_create_1h_tokens ?? 0)
    if (cost > 0) {
      db.prepare(`UPDATE requests SET cost_usd = ? WHERE id = ?`).run(cost, r.id)
      fixed++
    }
  }

  if (fixed > 0) {
    const touchedSessions = new Set(zeroRows.map(r => {
      const row = db.prepare(`SELECT session_id FROM requests WHERE id = ?`).get(r.id) as { session_id: string } | null
      return row?.session_id
    }).filter(Boolean) as string[])
    for (const sid of touchedSessions) rollupSession(db, sid)
  }

  return { fixed, total: zeroRows.length, buckets: queryZeroCostTokenizedModels(db, 8) }
}
