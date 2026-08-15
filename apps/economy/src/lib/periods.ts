import type { Period } from '../types/index.js'

function ymd(date: Date): string {
  return date.toISOString().substring(0, 10)
}

export function usageSnapshotFilterForPeriod(period: Period): { date?: string; since?: string } {
  const now = new Date()
  switch (period) {
    case 'today':
      return { date: ymd(now) }
    case 'yesterday': {
      const yesterday = new Date(now)
      yesterday.setUTCDate(yesterday.getUTCDate() - 1)
      return { date: ymd(yesterday) }
    }
    case 'week': {
      const weekAgo = new Date(now)
      weekAgo.setUTCDate(weekAgo.getUTCDate() - 7)
      return { since: ymd(weekAgo) }
    }
    case 'month':
      return { since: ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))) }
    case 'year':
      return { since: ymd(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))) }
    case 'all':
      return {}
  }
}
