import { existsSync, readFileSync } from 'fs'
import type { Database } from '../db/database.js'
import {
  getIngestState, setIngestState, getMachineId, upsertUsageSnapshot, upsertSubscription,
} from '../db/database.js'
import { agentPaths } from '../lib/paths.js'

const WHAM_USAGE_URL = process.env['CODEX_USAGE_URL']
  ?? 'https://chatgpt.com/backend-api/wham/usage'

interface CodexAuthFile {
  auth_mode?: string
  tokens?: {
    access_token?: string
    account_id?: string
  }
}

interface CodexRateWindow {
  used_percent?: number
  reset_at?: number
  limit_window_seconds?: number
}

interface CodexUsageResponse {
  plan_type?: string
  rate_limit?: {
    primary_window?: CodexRateWindow
    secondary_window?: CodexRateWindow
  }
  credits?: {
    has_credits?: boolean
    balance?: number
  }
}

function readCodexAuth(): { token: string; accountId?: string; authMode: string } | null {
  const fromEnv = process.env['CODEX_OAUTH_TOKEN']
  if (fromEnv) return { token: fromEnv, authMode: 'chatgpt' }

  const authPath = agentPaths().codexAuth
  if (!existsSync(authPath)) return null
  try {
    const auth = JSON.parse(readFileSync(authPath, 'utf-8')) as CodexAuthFile
    const token = auth.tokens?.access_token
    if (!token) return null
    return {
      token,
      accountId: auth.tokens?.account_id,
      authMode: auth.auth_mode ?? 'chatgpt',
    }
  } catch {
    return null
  }
}

function planMonthlyFee(planType?: string): number {
  const plan = (planType ?? '').toLowerCase()
  if (plan.includes('pro')) return 200
  if (plan.includes('plus')) return 20
  if (plan.includes('team')) return 30
  return 20
}

async function fetchCodexUsage(token: string, accountId?: string): Promise<CodexUsageResponse | null> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'economy-cli',
    }
    if (accountId) headers['ChatGPT-Account-Id'] = accountId

    const res = await fetch(WHAM_USAGE_URL, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return await res.json() as CodexUsageResponse
  } catch {
    return null
  }
}

export async function ingestCodexQuota(db: Database, verbose = false): Promise<{ snapshots: number }> {
  const auth = readCodexAuth()
  if (!auth) {
    if (verbose) console.log('  codex quota: skipped — no ~/.codex/auth.json or CODEX_OAUTH_TOKEN')
    return { snapshots: 0 }
  }
  if (auth.authMode === 'api_key' || auth.authMode === 'api') {
    if (verbose) console.log('  codex quota: skipped — API key mode (no subscription quota)')
    return { snapshots: 0 }
  }

  const today = new Date().toISOString().substring(0, 10)
  const prev = getIngestState(db, 'codex', `quota-${today}`)
  if (prev) return { snapshots: 0 }

  const usage = await fetchCodexUsage(auth.token, auth.accountId)
  if (!usage) {
    if (verbose) console.log('  codex quota: wham/usage endpoint unavailable')
    return { snapshots: 0 }
  }

  const machineId = getMachineId()
  let snapshots = 0
  const now = new Date().toISOString()

  const windows: Array<[string, CodexRateWindow | undefined]> = [
    ['five_hour_utilization', usage.rate_limit?.primary_window],
    ['seven_day_utilization', usage.rate_limit?.secondary_window],
  ]

  for (const [metric, window] of windows) {
    if (window?.used_percent == null) continue
    upsertUsageSnapshot(db, {
      agent: 'codex',
      date: today,
      metric,
      value: window.used_percent,
      unit: 'percent',
      machine_id: machineId,
    })
    snapshots++
    if (window.reset_at) {
      upsertUsageSnapshot(db, {
        agent: 'codex',
        date: today,
        metric: `${metric}_resets_at`,
        value: window.reset_at * 1000,
        unit: 'epoch_ms',
        machine_id: machineId,
      })
      snapshots++
    }
  }

  if (usage.credits?.balance != null) {
    upsertUsageSnapshot(db, {
      agent: 'codex',
      date: today,
      metric: 'credits_balance_usd',
      value: usage.credits.balance,
      unit: 'usd',
      machine_id: machineId,
    })
    snapshots++
  }

  const monthlyFee = planMonthlyFee(usage.plan_type)
  upsertSubscription(db, {
    id: 'openai-codex-oauth',
    provider: 'openai',
    agent: 'codex',
    plan: usage.plan_type ?? 'chatgpt_plus',
    monthly_fee_usd: monthlyFee,
    included_usage_usd: monthlyFee,
    billing_cycle_start: null,
    reset_policy: 'monthly',
    active: 1,
    created_at: now,
    updated_at: now,
  })

  setIngestState(db, 'codex', `quota-${today}`, now)
  if (verbose) console.log(`  codex quota: ${snapshots} snapshots (${usage.plan_type ?? 'unknown plan'})`)
  return { snapshots }
}
