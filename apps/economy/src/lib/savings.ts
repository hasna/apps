import type { SqliteAdapter as Database } from '@hasna/cloud'
import type { Agent, CostBasis } from './agents.js'
import type { Period } from '../types/index.js'

export interface SavingsSummary {
  period: Period
  api_equivalent_usd: number
  subscription_fee_usd: number
  included_consumed_usd: number
  on_demand_usd: number
  saved_usd: number
  by_agent: Record<string, Partial<SavingsSummary>>
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

function prorateMonthlyFee(monthlyFee: number, period: Period): number {
  const now = new Date()
  const dayOfMonth = now.getDate()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  switch (period) {
    case 'today':
    case 'yesterday':
      return monthlyFee / daysInMonth
    case 'week':
      return (monthlyFee / daysInMonth) * 7
    case 'month':
      return monthlyFee
    case 'year':
      return monthlyFee * 12
    case 'all':
      return monthlyFee
  }
}

/** saved = max(0, api_equivalent - on_demand - prorated_subscription_fee) */
export function computeSavedUsd(
  apiEquivalent: number,
  onDemand: number,
  subscriptionFee: number,
): number {
  return Math.max(0, apiEquivalent - onDemand - subscriptionFee)
}

export function querySavingsSummary(
  db: Database,
  period: Period,
  agent?: Agent,
): SavingsSummary {
  const where = periodWhere(period, 'timestamp')
  const agentClause = agent ? ' AND agent = ?' : ''
  const params = agent ? [agent] : []

  const apiRow = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total
    FROM requests
    WHERE ${where}${agentClause}
      AND COALESCE(cost_basis, 'estimated') IN ('metered_api', 'estimated', 'unknown')
  `).get(...params) as { total: number }

  const includedRow = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total
    FROM requests
    WHERE ${where}${agentClause}
      AND cost_basis = 'subscription_included'
  `).get(...params) as { total: number }

  const subWhere = periodWhere(period, 'date')
  const onDemandRow = db.prepare(`
    SELECT COALESCE(SUM(value), 0) as total
    FROM usage_snapshots
    WHERE ${subWhere}${agent ? ' AND agent = ?' : ''}
      AND metric = 'on_demand_usd'
  `).get(...params) as { total: number }

  const subs = db.prepare(`
    SELECT COALESCE(SUM(monthly_fee_usd), 0) as total
    FROM subscriptions
    WHERE active = 1${agent ? ' AND agent = ?' : ''}
  `).get(...(agent ? [agent] : [])) as { total: number }

  const subscriptionFee = prorateMonthlyFee(subs.total, period)
  const apiEquivalent = apiRow.total + includedRow.total
  const onDemand = onDemandRow.total
  const saved = computeSavedUsd(apiEquivalent, onDemand, subscriptionFee)

  const byAgent: Record<string, Partial<SavingsSummary>> = {}
  if (!agent) {
    for (const row of db.prepare(`
      SELECT agent, COALESCE(SUM(cost_usd), 0) as api_eq
      FROM requests WHERE ${where}
      GROUP BY agent
    `).all() as Array<{ agent: string; api_eq: number }>) {
      byAgent[row.agent] = {
        api_equivalent_usd: row.api_eq,
        saved_usd: row.api_eq,
      }
    }
  }

  return {
    period,
    api_equivalent_usd: apiEquivalent,
    subscription_fee_usd: subscriptionFee,
    included_consumed_usd: includedRow.total,
    on_demand_usd: onDemand,
    saved_usd: saved,
    by_agent: byAgent,
  }
}

export function defaultCostBasisForAgent(agent: Agent): CostBasis {
  if (agent === 'claude') return 'metered_api'
  if (agent === 'cursor') return 'subscription_included'
  return 'estimated'
}
