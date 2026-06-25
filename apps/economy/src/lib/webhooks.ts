import { loadConfig } from './config.js'
import { getBudgetStatuses, getIngestState, setIngestState } from '../db/database.js'
import { getTodaySpike } from './spikes.js'
import type { Database } from '../db/database.js'

export async function checkAndFireWebhooks(db: Database): Promise<void> {
  const config = loadConfig()
  const url = config['webhook-url']
  if (!url) return

  // Check budget alerts
  const statuses = getBudgetStatuses(db)
  for (const b of statuses) {
    if (!b.is_over_alert) continue
    const key = `webhook-budget-${b.id}-${b.period}`
    const lastFired = getIngestState(db, 'webhook', key)
    const pctBucket = Math.floor(b.percent_used / 10) * 10
    if (lastFired === String(pctBucket)) continue

    const delivered = await fireWebhook(url, {
      event: 'budget_alert',
      budget_id: b.id,
      project: b.project_path ?? 'global',
      period: b.period,
      spend: b.current_spend_usd,
      limit: b.limit_usd,
      percent: Math.round(b.percent_used * 10) / 10,
    })
    if (delivered) setIngestState(db, 'webhook', key, String(pctBucket))
  }

  const spike = getTodaySpike(db)
  if (spike) {
    const key = `webhook-spike-${spike.date}`
    if (getIngestState(db, 'webhook', key) !== '1') {
      const delivered = await fireWebhook(url, {
        event: 'cost_spike',
        date: spike.date,
        cost_usd: spike.cost_usd,
        average_usd: spike.average_usd,
        ratio: Math.round(spike.ratio * 100) / 100,
      })
      if (delivered) setIngestState(db, 'webhook', key, '1')
    }
  }
}

async function fireWebhook(url: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}
