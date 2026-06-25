import type { Database } from '../db/database.js'

export interface SpikeInfo {
  date: string
  cost_usd: number
  average_usd: number
  ratio: number
}

/** Detect daily cost spikes: today > 2× rolling 7-day mean (min 7 days history). */
export function detectCostSpikes(
  dailyTotals: Array<{ date: string; cost_usd: number }>,
  opts?: { windowDays?: number; multiplier?: number },
): SpikeInfo[] {
  const windowDays = opts?.windowDays ?? 7
  const multiplier = opts?.multiplier ?? 2
  const sorted = [...dailyTotals].sort((a, b) => a.date.localeCompare(b.date))
  const spikes: SpikeInfo[] = []

  for (let i = windowDays; i < sorted.length; i++) {
    const window = sorted.slice(i - windowDays, i)
    const avg = window.reduce((s, d) => s + d.cost_usd, 0) / window.length
    const current = sorted[i]!
    if (avg > 0 && current.cost_usd > avg * multiplier) {
      spikes.push({
        date: current.date,
        cost_usd: current.cost_usd,
        average_usd: avg,
        ratio: current.cost_usd / avg,
      })
    }
  }

  return spikes
}

export function queryRecentSpikes(db: Database, days = 14): SpikeInfo[] {
  const rows = db.prepare(`
    SELECT DATE(timestamp) as date, COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM requests
    WHERE timestamp >= DATE('now', '-' || ? || ' days')
    GROUP BY DATE(timestamp)
    ORDER BY date ASC
  `).all(days) as Array<{ date: string; cost_usd: number }>

  return detectCostSpikes(rows)
}

export function getTodaySpike(db: Database): SpikeInfo | null {
  const today = new Date().toISOString().substring(0, 10)
  const spikes = queryRecentSpikes(db, 14)
  return spikes.find((s) => s.date === today) ?? null
}
