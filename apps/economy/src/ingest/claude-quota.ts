import { existsSync, readFileSync } from 'fs'
import type { Database } from '../db/database.js'
import { getIngestState, setIngestState, getMachineId, upsertUsageSnapshot, upsertSubscription } from '../db/database.js'
import { agentPaths } from '../lib/paths.js'

const CREDENTIALS_PATH = agentPaths().claudeCredentials
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA = 'oauth-2025-04-20'

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken?: string
    subscriptionType?: string
    rateLimitTier?: string
  }
}

interface ClaudeOAuthUsage {
  five_hour?: { utilization?: number; resets_at?: string }
  seven_day?: { utilization?: number; resets_at?: string }
  seven_day_sonnet?: { utilization?: number; resets_at?: string }
  seven_day_opus?: { utilization?: number; resets_at?: string }
  extra_usage?: { spend?: number; limit?: number }
}

function readClaudeToken(): { token: string; subscriptionType?: string; rateLimitTier?: string } | null {
  const fromEnv = process.env['CLAUDE_OAUTH_TOKEN'] ?? process.env['ANTHROPIC_OAUTH_TOKEN']
  if (fromEnv) return { token: fromEnv }

  if (!existsSync(CREDENTIALS_PATH)) return null
  try {
    const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8')) as ClaudeCredentials
    const oauth = creds.claudeAiOauth
    if (!oauth?.accessToken) return null
    return {
      token: oauth.accessToken,
      subscriptionType: oauth.subscriptionType,
      rateLimitTier: oauth.rateLimitTier,
    }
  } catch {
    return null
  }
}

function inferMonthlyFee(subscriptionType?: string, rateLimitTier?: string): number {
  const tier = `${subscriptionType ?? ''} ${rateLimitTier ?? ''}`.toLowerCase()
  if (tier.includes('max') && tier.includes('20')) return 200
  if (tier.includes('max')) return 100
  if (tier.includes('pro')) return 20
  if (tier.includes('team')) return 30
  return 20
}

async function fetchClaudeOAuthUsage(token: string): Promise<ClaudeOAuthUsage | null> {
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return await res.json() as ClaudeOAuthUsage
  } catch {
    return null
  }
}

export async function ingestClaudeQuota(db: Database, verbose = false): Promise<{ snapshots: number }> {
  const auth = readClaudeToken()
  if (!auth) {
    if (verbose) console.log('  claude quota: skipped — no OAuth token (~/.claude/.credentials.json or CLAUDE_OAUTH_TOKEN)')
    return { snapshots: 0 }
  }

  const today = new Date().toISOString().substring(0, 10)
  const prev = getIngestState(db, 'claude', `quota-${today}`)
  if (prev) return { snapshots: 0 }

  const usage = await fetchClaudeOAuthUsage(auth.token)
  if (!usage) {
    if (verbose) console.log('  claude quota: OAuth usage endpoint unavailable')
    return { snapshots: 0 }
  }

  const machineId = getMachineId()
  let snapshots = 0

  const windows: Array<[string, ClaudeOAuthUsage['five_hour']]> = [
    ['five_hour_utilization', usage.five_hour],
    ['seven_day_utilization', usage.seven_day],
    ['seven_day_sonnet_utilization', usage.seven_day_sonnet],
    ['seven_day_opus_utilization', usage.seven_day_opus],
  ]

  for (const [metric, window] of windows) {
    if (window?.utilization == null) continue
    upsertUsageSnapshot(db, {
      agent: 'claude',
      date: today,
      metric,
      value: Math.round(window.utilization * 1000) / 10,
      unit: 'percent',
      machine_id: machineId,
    })
    snapshots++
    if (window.resets_at) {
      upsertUsageSnapshot(db, {
        agent: 'claude',
        date: today,
        metric: `${metric}_resets_at`,
        value: Date.parse(window.resets_at),
        unit: 'epoch_ms',
        machine_id: machineId,
      })
      snapshots++
    }
  }

  if (usage.extra_usage?.spend != null) {
    upsertUsageSnapshot(db, {
      agent: 'claude',
      date: today,
      metric: 'on_demand_usd',
      value: usage.extra_usage.spend,
      unit: 'usd',
      machine_id: machineId,
    })
    snapshots++
  }
  if (usage.extra_usage?.limit != null) {
    upsertUsageSnapshot(db, {
      agent: 'claude',
      date: today,
      metric: 'on_demand_limit_usd',
      value: usage.extra_usage.limit,
      unit: 'usd',
      machine_id: machineId,
    })
    snapshots++
  }

  const monthlyFee = inferMonthlyFee(auth.subscriptionType, auth.rateLimitTier)
  const now = new Date().toISOString()
  upsertSubscription(db, {
    id: 'anthropic-claude-oauth',
    provider: 'anthropic',
    agent: 'claude',
    plan: auth.rateLimitTier ?? auth.subscriptionType ?? 'claude_pro',
    monthly_fee_usd: monthlyFee,
    included_usage_usd: monthlyFee,
    billing_cycle_start: null,
    reset_policy: 'monthly',
    active: 1,
    created_at: now,
    updated_at: now,
  })

  setIngestState(db, 'claude', `quota-${today}`, new Date().toISOString())
  if (verbose) console.log(`  claude quota: ${snapshots} snapshots`)
  return { snapshots }
}
