import { loadConfig } from './config.js'
import { getBudgetStatuses, getIngestState, setIngestState } from '../db/database.js'
import type { Database } from 'bun:sqlite'

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
    if (lastFired === String(pctBucket)) continue // already fired at this threshold

    await fireWebhook(url, {
      event: 'budget_alert',
      budget_id: b.id,
      project: b.project_path ?? 'global',
      period: b.period,
      spend: b.current_spend_usd,
      limit: b.limit_usd,
      percent: Math.round(b.percent_used * 10) / 10,
    })
    setIngestState(db, 'webhook', key, String(pctBucket))
  }
}

async function fireWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* silently ignore webhook failures */ }
}
