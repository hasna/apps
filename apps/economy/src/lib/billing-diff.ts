import type { SqliteAdapter as Database } from '../db/sqlite-adapter.js'
import { querySummary, queryBillingSummary, countBillingRecords } from '../db/database.js'
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

/**
 * Why a drift percentage could not be computed. `null` means it could.
 *
 * - `no_billing_records` — no provider billing rows exist for the period at
 *   all. Nothing was imported; there is no "actual" to compare against.
 * - `zero_actual_billing` — rows exist but total $0.00, so the denominator is
 *   still absent even though the import ran.
 */
export type BillingDiffIncomparableReason = 'no_billing_records' | 'zero_actual_billing'

/**
 * Estimated-vs-actual drift as a percentage, or `null` when there is no actual
 * to divide by.
 *
 * Returning `null` rather than `0` is the point. Three call sites independently
 * wrote `actual > 0 ? (delta / actual) * 100 : 0`, and every one of them then
 * rendered the fallback as a measured "0.0%" — reporting perfect agreement for
 * the case where nothing was there to agree with.
 */
export function billingDeltaPct(estimatedUsd: number, actualUsd: number): number | null {
  if (!(actualUsd > 0)) return null
  return ((estimatedUsd - actualUsd) / actualUsd) * 100
}

export interface BillingDiffSummary {
  period: Period
  estimated_usd: number
  actual_usd: number
  delta_usd: number
  delta_pct: number
  threshold_pct: number
  is_alert: boolean
  /**
   * Whether `delta_pct` is a measurement at all. False means the two sides
   * could not be compared, and `delta_pct` carries 0 only because the type is
   * a number — read this before reporting the percentage as agreement.
   */
  comparable: boolean
  incomparable_reason: BillingDiffIncomparableReason | null
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
  const billingRecords = countBillingRecords(db, period)
  const delta = estimated.total_usd - actual.total_usd

  // A zero actual makes the ratio undefined, not zero. Returning 0 here was
  // the defect: it reported "estimated and actual agree perfectly" for the
  // case where there is no actual to agree with, so the threshold alert could
  // never fire on a missing billing import.
  const measuredPct = billingDeltaPct(estimated.total_usd, actual.total_usd)
  const incomparableReason: BillingDiffIncomparableReason | null =
    measuredPct !== null ? null
      : billingRecords === 0 ? 'no_billing_records'
      : 'zero_actual_billing'
  const comparable = incomparableReason === null
  const deltaPct = measuredPct ?? 0

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
    // An incomparable diff is not an alert either — it is unmeasured. Callers
    // distinguish the two through `comparable`; see `billingDriftCheck`.
    is_alert: comparable && Math.abs(deltaPct) > thresholdPct,
    comparable,
    incomparable_reason: incomparableReason,
    by_agent,
    by_provider: actual.by_provider,
  }
}

/**
 * The health verdict `economy doctor` reports for billing drift.
 *
 * Kept beside the diff rather than in the CLI because the interesting case is
 * a semantic one: an unmeasurable drift must not render as a measured 0.0%.
 * A check that cannot distinguish "the sides agree" from "there is nothing to
 * compare" cannot fail, and this one is consulted to decide whether the rest
 * of the tool's numbers are trustworthy.
 */
export function billingDriftCheck(diff: BillingDiffSummary): { ok: boolean; msg: string } {
  if (diff.comparable) {
    return {
      ok: !diff.is_alert,
      msg: `billing drift ${diff.period}: ${Math.abs(diff.delta_pct).toFixed(1)}%`,
    }
  }
  const estimated = `estimated $${diff.estimated_usd.toFixed(2)}`
  const detail = diff.incomparable_reason === 'no_billing_records'
    ? `no provider billing records imported for this period (${estimated}); run: economy billing sync`
    : `provider billing records exist but total $0.00 (${estimated})`
  return { ok: false, msg: `billing drift ${diff.period}: UNKNOWN — ${detail}` }
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
