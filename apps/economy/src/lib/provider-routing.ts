import type { SqliteAdapter as Database } from '@hasna/cloud'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { listSubscriptions } from '../db/database.js'
import type {
  EconomyProvider,
  ModelPricing,
  ProviderHealth,
  ProviderReadinessRow,
  ProviderReadinessSummary,
} from '../types/index.js'
import { getPricing, getPricingFromDb } from './pricing.js'

interface ProviderDefinition {
  provider: EconomyProvider
  representativeModel: string
  homePaths: string[]
  keyEnv?: string[]
  subscriptionFirst: boolean
  thirdPartyApi: boolean
  keyRequired: boolean
}

const PROVIDERS: ProviderDefinition[] = [
  {
    provider: 'codewith',
    representativeModel: 'gpt-5-codex',
    homePaths: ['.codewith'],
    subscriptionFirst: true,
    thirdPartyApi: false,
    keyRequired: false,
  },
  {
    provider: 'codex',
    representativeModel: 'gpt-5-codex',
    homePaths: ['.codex'],
    subscriptionFirst: true,
    thirdPartyApi: false,
    keyRequired: false,
  },
  {
    provider: 'claude',
    representativeModel: 'claude-sonnet-4-6',
    homePaths: ['.claude', join('.claude', 'projects')],
    subscriptionFirst: true,
    thirdPartyApi: false,
    keyRequired: false,
  },
  {
    provider: 'cursor',
    representativeModel: 'gpt-5-codex',
    homePaths: ['.cursor', join('.config', 'Cursor')],
    keyEnv: ['CURSOR_SESSION_TOKEN'],
    subscriptionFirst: false,
    thirdPartyApi: false,
    keyRequired: true,
  },
  {
    provider: 'aicopilot',
    representativeModel: 'gpt-5.4-mini',
    homePaths: ['.aicopilot'],
    keyEnv: ['AICOPILOT_API_KEY'],
    subscriptionFirst: false,
    thirdPartyApi: true,
    keyRequired: true,
  },
  {
    provider: 'opencode',
    representativeModel: 'qwen/qwen3.6-plus',
    homePaths: [join('.local', 'share', 'opencode'), '.opencode'],
    keyEnv: ['OPENCODE_API_KEY'],
    subscriptionFirst: false,
    thirdPartyApi: true,
    keyRequired: true,
  },
  {
    provider: 'gemini',
    representativeModel: 'gemini-3.1-pro-preview',
    homePaths: ['.gemini'],
    keyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    subscriptionFirst: false,
    thirdPartyApi: true,
    keyRequired: true,
  },
]

const SUBSCRIPTION_FIRST: EconomyProvider[] = ['codewith', 'codex', 'claude']
const MATERIAL_SAVINGS_RATIO = 0.9
const BASELINE_MODEL = 'claude-sonnet-4-6'

function currentHome(): string {
  return process.env['HOME'] || process.env['USERPROFILE'] || homedir()
}

function hasHomePath(home: string, relativePath: string): boolean {
  return existsSync(join(home, relativePath))
}

function hasAnyKey(envNames: string[] | undefined): boolean {
  if (!envNames || envNames.length === 0) return false
  return envNames.some(name => Boolean(process.env[name]))
}

function pricingCostPer1M(pricing: ModelPricing | null): number | null {
  if (!pricing) return null
  return pricing.inputPer1M + pricing.outputPer1M
}

function pricingForModel(db: Database, model: string): ModelPricing | null {
  return getPricingFromDb(db, model) ?? getPricing(model)
}

function activeSubscriptionProviders(db: Database): Set<EconomyProvider> {
  const set = new Set<EconomyProvider>()
  for (const sub of listSubscriptions(db)) {
    if (!sub.active) continue
    if ((PROVIDERS.some(def => def.provider === sub.provider))) set.add(sub.provider as EconomyProvider)
    if (sub.agent && PROVIDERS.some(def => def.provider === sub.agent)) set.add(sub.agent as EconomyProvider)
  }
  return set
}

function zeroCostTokenRows(db: Database): number {
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM requests
    WHERE COALESCE(cost_usd, 0) = 0
      AND COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
        + COALESCE(cache_read_tokens, 0) + COALESCE(cache_create_tokens, 0)
        + COALESCE(cache_create_5m_tokens, 0) + COALESCE(cache_create_1h_tokens, 0) > 0
  `).get() as { count: number }
  return row.count
}

function keyHealth(def: ProviderDefinition): ProviderHealth {
  if (!def.keyRequired) return 'not_required'
  return hasAnyKey(def.keyEnv) ? 'ok' : 'missing'
}

function providerRow(
  db: Database,
  home: string,
  subscriptions: Set<EconomyProvider>,
  def: ProviderDefinition,
  baselineCost: number | null,
): ProviderReadinessRow {
  const installed = def.homePaths.some(path => hasHomePath(home, path))
  const key_health = keyHealth(def)
  const pricing = pricingForModel(db, def.representativeModel)
  const api_cost_per_1m = pricingCostPer1M(pricing)
  const pricing_health: ProviderHealth = api_cost_per_1m == null ? 'missing' : 'ok'
  const subscription_backed = subscriptions.has(def.provider)
  const authenticated = def.keyRequired ? key_health === 'ok' : (installed || subscription_backed)
  const routable = def.keyRequired ? installed && authenticated : authenticated
  const available = routable
  const material_savings_vs_baseline = api_cost_per_1m != null &&
    baselineCost != null &&
    api_cost_per_1m <= baselineCost * MATERIAL_SAVINGS_RATIO
  const flags: string[] = []

  if (def.provider === 'cursor' && key_health === 'missing') flags.push('missing CURSOR_SESSION_TOKEN')
  else if (def.keyRequired && key_health === 'missing') flags.push(`missing ${def.keyEnv?.[0] ?? 'provider key'}`)
  if (!available) flags.push('unavailable provider')
  if (pricing_health === 'missing') flags.push(`missing pricing for ${def.representativeModel}`)
  if (def.thirdPartyApi && key_health === 'ok' && !material_savings_vs_baseline) {
    flags.push('third-party API not materially cheaper than subscription-backed baseline')
  }

  return {
    provider: def.provider,
    installed,
    available,
    authenticated,
    routable,
    key_health,
    pricing_health,
    subscription_backed,
    representative_model: def.representativeModel,
    api_cost_per_1m,
    material_savings_vs_baseline,
    flags,
  }
}

export function buildProviderReadiness(db: Database): ProviderReadinessSummary {
  const home = currentHome()
  const subscriptions = activeSubscriptionProviders(db)
  const baselineCost = pricingCostPer1M(pricingForModel(db, BASELINE_MODEL))
  const providers = PROVIDERS.map(def => providerRow(db, home, subscriptions, def, baselineCost))
  const zeroRows = zeroCostTokenRows(db)
  const flags = providers.flatMap(row => row.flags)

  if (zeroRows > 0) flags.push(`zero-cost token rows: ${zeroRows}`)

  const preferred = SUBSCRIPTION_FIRST.filter(provider => {
    const row = providers.find(candidate => candidate.provider === provider)
    return Boolean(row?.available)
  })
  const thirdPartyCandidates = providers
    .filter(row => {
      const def = PROVIDERS.find(candidate => candidate.provider === row.provider)
      return Boolean(def?.thirdPartyApi) &&
        row.available &&
        row.key_health === 'ok' &&
        row.pricing_health === 'ok' &&
        row.material_savings_vs_baseline
    })
    .map(row => row.provider)
  const avoid = providers
    .filter(row => !row.available || row.key_health === 'missing' || row.pricing_health === 'missing')
    .map(row => row.provider)

  return {
    generated_at: new Date().toISOString(),
    baseline_model: BASELINE_MODEL,
    baseline_api_cost_per_1m: baselineCost,
    zero_cost_token_rows: zeroRows,
    providers,
    flags: [...new Set(flags)],
    routing: {
      preferred,
      avoid: [...new Set(avoid)],
      third_party_candidates: thirdPartyCandidates,
      recommendation: 'Prefer subscription-backed Codewith/Codex/Claude first; recommend third-party APIs only when key health and pricing prove material savings.',
    },
  }
}
