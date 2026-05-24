import type { SqliteAdapter as Database } from '@hasna/cloud'
import { querySummary, queryBillingSummary } from '../db/database.js'
import type { Period } from '../types/index.js'

const PROVIDER_TO_AGENT: Record<string, string> = {
  anthropic: 'claude',
  openai: 'codex',
  gemini: 'gemini',
  google: 'gemini',
}

export interface BillingDiffRow {
  agent: string
  estimated_usd: number
  actual_usd: number
  delta_usd: number
  delta_pct: number
}

export interface BillingDiffSummary {
  period: Period
  estimated_usd: number
  actual_usd: number
  delta_usd: number
  delta_pct: number
  threshold_pct: number
  is_alert: boolean
  by_agent: BillingDiffRow[]
  by_provider: Record<string, number>
}

export function queryBillingDiff(
  db: Database,
  period: Period,
  thresholdPct = 15,
): BillingDiffSummary {
  const estimated = querySummary(db, period, undefined, true)
  const actual = queryBillingSummary(db, period)
  const delta = estimated.total_usd - actual.total_usd
  const deltaPct = actual.total_usd > 0 ? (delta / actual.total_usd) * 100 : 0

  const agentRows = db.prepare(`
    SELECT agent, COALESCE(SUM(cost_usd), 0) as estimated_usd
    FROM requests
    WHERE ${periodWhere(period, 'timestamp')}
    GROUP BY agent
  `).all() as Array<{ agent: string; estimated_usd: number }>

  const by_agent: BillingDiffRow[] = agentRows.map((row) => {
    const provider = Object.entries(PROVIDER_TO_AGENT).find(([, a]) => a === row.agent)?.[0]
    const actualUsd = provider ? (actual.by_provider[provider] ?? 0) : 0
    const rowDelta = row.estimated_usd - actualUsd
    const rowPct = actualUsd > 0 ? (rowDelta / actualUsd) * 100 : 0
    return {
      agent: row.agent,
      estimated_usd: row.estimated_usd,
      actual_usd: actualUsd,
      delta_usd: rowDelta,
      delta_pct: rowPct,
    }
  }).sort((a, b) => Math.abs(b.delta_usd) - Math.abs(a.delta_usd))

  return {
    period,
    estimated_usd: estimated.total_usd,
    actual_usd: actual.total_usd,
    delta_usd: delta,
    delta_pct: deltaPct,
    threshold_pct: thresholdPct,
    is_alert: Math.abs(deltaPct) > thresholdPct,
    by_agent,
    by_provider: actual.by_provider,
  }
}

function periodWhere(period: Period, column: string): string {
  switch (period) {
    case 'today': return `DATE(${column}) = DATE('now')`
    case 'yesterday': return `DATE(${column}) = DATE('now', '-1 day')`
    case 'week': return `${column} >= DATE('now', 'weekday 0', '-7 days')`
    case 'month': return `${column} >= DATE('now', 'start of month')`
    case 'year': return `${column} >= DATE('now', 'start of year')`
    case 'all': return '1=1'
  }
}
