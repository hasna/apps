import type { SqliteAdapter as Database } from '../db/sqlite-adapter.js'
import {
  querySummary, querySessions, queryTopSessions,
  queryModelBreakdown, queryProjectBreakdown, queryProjectBreakdownSince, queryAgentBreakdown, queryDailyBreakdown, queryHourlyBreakdown,
  queryAccountBreakdown, queryCostCenterBreakdown,
  queryModelBreakdownSince, queryAgentBreakdownSince, queryAccountBreakdownSince,
  getBudgetStatuses, upsertBudget, deleteBudget,
  listProjects, upsertProject, deleteProject,
  listModelPricing, upsertModelPricing, deleteModelPricing,
  upsertGoal, deleteGoal, getGoalStatuses,
  listSubscriptions, upsertSubscription, deleteSubscription,
  listMachines, getMachineId,
  listMachineRegistry,
  queryBillingSummary,
  insertFeedback,
  openDatabase,
  bulkIngest,
  rollupSession,
} from '../db/database.js'
import { ensurePricingSeeded } from '../lib/pricing.js'
import { AGENTS, isAgent } from '../lib/agents.js'
import { syncAll } from '../lib/sync-all.js'
import { querySavingsSummary } from '../lib/savings.js'
import { buildBrief } from '../lib/brief.js'
import {
  queryProjectDetail,
  queryExportRows,
  queryRangeStats,
  queryForecast,
  queryModelEfficiency,
  type ExportType,
} from '../lib/analytics.js'
import { queryRequestsSince } from '../db/database.js'
import { usageSnapshotFilterForPeriod } from '../lib/periods.js'
import { queryBillingDiff } from '../lib/billing-diff.js'
import { queryUsageSnapshots } from '../db/database.js'
import { isAuthorizedRequest } from '../lib/serve-auth.js'
import { randomUUID } from 'crypto'
import { getServeBindHost } from '../lib/serve-auth.js'
import { packageMetadata } from '../lib/package-metadata.js'
import { isPostgresBackend, resolveEconomyServerBackend, openCloudDatabase, resolveSigningSecret, createCloudPool, authClientFromPool } from '../db/cloud.js'
import { verifyApiKey, ApiKeyStore } from '@hasna/contracts/auth'
import { openApiSpec } from '../openapi.js'
import type { CostCenterKind, Period } from '../types/index.js'
import type { Agent } from '../lib/agents.js'

/** The serve OpenAPI document (source of the generated SDK), version-synced. */
export function openApiDocument(): Record<string, unknown> {
  const spec = openApiSpec as unknown as Record<string, unknown>
  return { ...spec, info: { ...(spec['info'] as object), version: packageMetadata.version } }
}

/**
 * Framework-agnostic API-key verifier shape (matches `@hasna/contracts/auth`
 * `ApiKeyVerifier`). Kept structural so serve.ts has no hard dependency on the
 * auth package; the entry point injects the real verifier.
 */
export interface ApiAuthenticator {
  authenticate(
    headers: Headers,
    context?: { method?: string | null; path?: string | null; requiredScopes?: readonly string[] },
  ): Promise<{ ok: boolean; status: number; reason?: string; message?: string }>
}

/**
 * `GET /health` — `{ status, version, backend }`, validated by the contract's
 * `HealthResponseSchema`. That schema is STRICT, so this object must carry those
 * three keys and nothing else: the `mode` and `service` keys this envelope used
 * to add are what made the payload fail the `health_shape` conformance gate.
 */
function healthEnvelope(status: 'ok' | 'degraded' | 'unavailable'): Record<string, unknown> {
  return { status, version: packageMetadata.version, backend: resolveEconomyServerBackend() }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Economy-Token',
}
const APP = 'economy'
const ECONOMY_WRITE_SCOPE = `${APP}:write`
const AGENT_ERROR = `agent must be one of: ${AGENTS.join(', ')}`
const SYNC_SOURCES = ['all', ...AGENTS, 'loops'] as const

interface StartServerOptions {
  db?: Database
  hostname?: string
  log?: (message: string) => void
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

function ok(data: unknown, meta?: Record<string, unknown>): Response {
  return json({ data, meta: meta ?? {} })
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status)
}

function normalizeBudgetPeriod(value: unknown): 'daily' | 'weekly' | 'monthly' {
  switch (value) {
    case 'day':
    case 'daily':
      return 'daily'
    case 'week':
    case 'weekly':
      return 'weekly'
    case 'month':
    case 'monthly':
    default:
      return 'monthly'
  }
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function jsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null) as unknown
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function optionalAgent(value: unknown): Agent | null | undefined {
  if (value == null || value === '') return null
  return typeof value === 'string' && (AGENTS as readonly string[]).includes(value) ? value as Agent : undefined
}

function requiredScopesForRequest(method: string, path: string): readonly string[] | undefined {
  if (method === 'POST' && path === '/api/ingest') return [ECONOMY_WRITE_SCOPE]
  if (method === 'POST' && path === '/api/feedback') return [ECONOMY_WRITE_SCOPE]
  return undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Apply ?fields=f1,f2 filtering — reduces response size by 50-89% */
function applyFields<T extends Record<string, unknown>>(obj: T, fields?: string[]): Partial<T> {
  if (!fields || fields.length === 0) return obj
  return Object.fromEntries(fields.map(f => [f, obj[f] ?? null])) as Partial<T>
}

export interface HandlerOptions {
  /** API-key verifier (from `@hasna/contracts/auth`). When present, every
   * request outside the open foundation probes must present a valid
   * `economy:*` scoped key. This is the internet-facing auth path. */
  authenticator?: ApiAuthenticator
  /** Readiness probe proving storage is reachable + migrated. */
  readyCheck?: () => Promise<{ ready: boolean; detail?: string }>
}

export function createHandler(db: Database, options: HandlerOptions = {}) {
  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url)
    // Normalize the versioned prefix onto the internal /api route table so both
    // /v1/* (canonical) and /api/* (legacy) resolve to the same handlers.
    const rawPath = url.pathname
    const path = rawPath.startsWith('/v1/') ? '/api' + rawPath.slice(3) : rawPath === '/v1' ? '/api' : rawPath
    const method = req.method

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    // ── Open foundation probes (CONTRACT.md section 4) ──────────────────────
    // Each probe has its OWN strict shape; they deliberately no longer share one
    // envelope, because the shared envelope is what leaked `mode` into all three.
    //   /health  -> { status, version, backend }   HealthResponseSchema
    //   /version -> { version }                    VersionResponseSchema
    //   /ready   -> { ready, reason? }             ReadyResponseSchema
    if (method === 'GET' && (rawPath === '/health' || rawPath === '/healthz')) {
      return json(healthEnvelope('ok'))
    }
    if (method === 'GET' && (rawPath === '/version' || rawPath === '/v1/version')) {
      return json({ version: packageMetadata.version })
    }
    if (method === 'GET' && (rawPath === '/ready' || rawPath === '/readyz')) {
      const result = options.readyCheck ? await options.readyCheck() : { ready: true }
      return json(
        result.detail ? { ready: result.ready, reason: result.detail } : { ready: result.ready },
        result.ready ? 200 : 503,
      )
    }
    if (method === 'GET' && rawPath === '/openapi.json') {
      return json(openApiDocument())
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    // Internet-facing path: the @hasna/contracts API-key verifier. Local/dev
    // path: the legacy shared-token check. Foundation probes above are open.
    if (options.authenticator) {
      const decision = await options.authenticator.authenticate(req.headers, {
        method,
        path: rawPath,
        requiredScopes: requiredScopesForRequest(method, path),
      })
      if (!decision.ok) return json({ error: decision.reason ?? 'unauthorized', message: decision.message }, decision.status || 401)
    } else if (!isAuthorizedRequest(req, path)) {
      return err('Unauthorized', 401)
    }

    // Legacy health alias (kept for older clients; foundation probe above)
    if (path === '/health') return ok({ status: 'ok', ts: new Date().toISOString() })

    // Summary
    if (path === '/api/summary' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'today') as Period
      const machine = url.searchParams.get('machine') ?? undefined
      return ok(querySummary(db, period, machine))
    }

    // Machines
    if (path === '/api/machines' && method === 'GET') {
      return ok(listMachines(db), { current_machine: getMachineId() })
    }

    if (path === '/api/fleet' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'month') as Period
      const machine = url.searchParams.get('machine') ?? undefined
      return ok({
        summary: querySummary(db, period, machine),
        machines: listMachines(db, period),
        registry: listMachineRegistry(db),
        current_machine: getMachineId(),
      })
    }

    // Daily breakdown for charts
    if (path === '/api/daily' && method === 'GET') {
      const days = Number(url.searchParams.get('days') ?? 30)
      const machine = url.searchParams.get('machine') ?? undefined
      return ok(queryDailyBreakdown(db, days, machine))
    }

    if (path === '/api/hourly' && method === 'GET') {
      const machine = url.searchParams.get('machine') ?? undefined
      const rawHours = url.searchParams.get('hours')
      let hours: number | undefined
      if (rawHours != null) {
        const parsedHours = Number(rawHours)
        if (!Number.isInteger(parsedHours) || parsedHours < 1 || parsedHours > 48) {
          return err('hours must be between 1 and 48')
        }
        hours = parsedHours
      }
      return ok(queryHourlyBreakdown(db, machine, hours))
    }

    // Sessions — supports ?search=project|agent|session and legacy ?project=
    if (path === '/api/sessions' && method === 'GET') {
      const agent = url.searchParams.get('agent') as Agent | null
      const project = url.searchParams.get('project') ?? undefined
      const search = url.searchParams.get('search') ?? undefined
      const machine = url.searchParams.get('machine') ?? undefined
      const account = url.searchParams.get('account') ?? undefined
      const limit = Number(url.searchParams.get('limit') ?? 50)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const since = url.searchParams.get('since') ?? undefined
      const fieldsParam = url.searchParams.get('fields')
      const fields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()).filter(Boolean) : undefined
      const sessions = querySessions(db, {
        agent: agent ?? undefined,
        project,
        search,
        machine,
        account,
        limit,
        offset,
        since,
      })
      return ok(fields ? sessions.map(s => applyFields(s as unknown as Record<string, unknown>, fields)) : sessions, { limit, offset })
    }

    // Top sessions
    if (path === '/api/top' && method === 'GET') {
      const n = Number(url.searchParams.get('n') ?? 10)
      const agent = url.searchParams.get('agent') ?? undefined
      const since = url.searchParams.get('since') ?? undefined
      return ok(queryTopSessions(db, n, agent, since))
    }

    // Model breakdown
    if (path === '/api/models' && method === 'GET') {
      return ok(queryModelBreakdown(db))
    }

    // Ground-truth provider billing imported from admin APIs.
    if (path === '/api/billing' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'month') as Period
      return ok(queryBillingSummary(db, period))
    }

    if (path === '/api/billing/diff' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'month') as Period
      const threshold = Number(url.searchParams.get('threshold') ?? 15)
      return ok(queryBillingDiff(db, period, Number.isFinite(threshold) ? threshold : 15))
    }
    if (path === '/api/billing/sync' && method === 'POST') {
      const body = await jsonBody(req) ?? {}
      const days = Number(body['days'] ?? 31)
      if (!Number.isFinite(days) || days <= 0 || days > 366) return err('days must be between 1 and 366')
      const providers = Array.isArray(body['providers']) ? body['providers'] as string[] : ['anthropic', 'openai', 'gemini']
      const allowedProviders = new Set(['anthropic', 'openai', 'gemini'])
      if (providers.some(provider => !allowedProviders.has(provider))) return err('invalid billing provider')
      const results: Record<string, unknown> = {}
      const { syncAnthropicBilling, syncOpenAIBilling, syncGeminiBilling } = await import('../ingest/billing.js')
      async function capture(provider: string, fn: () => Promise<unknown>): Promise<void> {
        try {
          results[provider] = await fn()
        } catch (e) {
          results[provider] = { error: e instanceof Error ? e.message : String(e) }
        }
      }
      if (providers.includes('anthropic')) await capture('anthropic', () => syncAnthropicBilling(db, { days }))
      if (providers.includes('openai')) await capture('openai', () => syncOpenAIBilling(db, { days }))
      if (providers.includes('gemini')) await capture('gemini', () => syncGeminiBilling(db, { days }))
      return ok(results)
    }

    // Project breakdown
    if (path === '/api/projects' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'all') as Period
      const machine = url.searchParams.get('machine') ?? undefined
      return ok(queryProjectBreakdown(db, period, machine))
    }

    if (path === '/api/accounts' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'all') as Period
      const machine = url.searchParams.get('machine') ?? undefined
      return ok(queryAccountBreakdown(db, period, machine))
    }

    // Breakdown (alias)
    if (path === '/api/breakdown' && method === 'GET') {
      const by = url.searchParams.get('by') ?? 'model'
      const period = (url.searchParams.get('period') ?? 'all') as Period
      const since = url.searchParams.get('since') ?? undefined
      const machine = url.searchParams.get('machine') ?? undefined
      // `since` binds on EVERY dimension. It used to reach only `by=project`,
      // so the other dimensions — including `model`, which is the CLI's default
      // and therefore the bare `economy breakdown --since ...` — answered with
      // the all-time table at HTTP 200. A period-scoped question silently
      // returning the unscoped answer is worse than an error: the caller quotes
      // it as the period figure.
      if (by === 'project') return ok(since ? queryProjectBreakdownSince(db, since, machine) : queryProjectBreakdown(db, period, machine))
      if (by === 'agent') return ok(since ? queryAgentBreakdownSince(db, since) : queryAgentBreakdown(db, period, machine))
      if (by === 'account') return ok(since ? queryAccountBreakdownSince(db, since) : queryAccountBreakdown(db, period, machine))
      if (by === 'cost-center') return ok(queryCostCenterBreakdown(db, period, { machine, since }))
      if (['loop', 'app', 'repo', 'service', 'team'].includes(by)) return ok(queryCostCenterBreakdown(db, period, { kind: by as CostCenterKind, machine, since }))
      return ok(since ? queryModelBreakdownSince(db, since) : queryModelBreakdown(db))
    }

    // Budgets
    if (path === '/api/budgets' && method === 'GET') {
      return ok(getBudgetStatuses(db))
    }
    if (path === '/api/budgets' && method === 'POST') {
      const body = await jsonBody(req)
      if (!body) return err('invalid JSON body')
      const limitUsd = finiteNumber(body['limit_usd'])
      const alertAtPercent = finiteNumber(body['alert_at_percent'] ?? 80)
      if (limitUsd == null || limitUsd <= 0) return err('limit_usd must be a positive number')
      if (alertAtPercent == null || alertAtPercent <= 0 || alertAtPercent > 100) return err('alert_at_percent must be between 1 and 100')
      const agent = optionalAgent(body['agent'])
      if (agent === undefined) return err(AGENT_ERROR)
      const now = new Date().toISOString()
      const budget = {
        id: randomUUID(),
        project_path: (body['project_path'] as string | null) ?? null,
        agent,
        cost_center_id: optionalString(body['cost_center_id']) ?? null,
        period: normalizeBudgetPeriod(body['period']),
        limit_usd: limitUsd,
        alert_at_percent: alertAtPercent,
        created_at: now,
        updated_at: now,
      }
      upsertBudget(db, budget)
      return ok(getBudgetStatuses(db).find(b => b.id === budget.id) ?? budget)
    }
    const budgetMatch = path.match(/^\/api\/budgets\/(.+)$/)
    if (budgetMatch && method === 'DELETE') {
      deleteBudget(db, decodeURIComponent(budgetMatch[1]!))
      return ok({ ok: true })
    }

    // Project management
    if (path === '/api/project-registry' && method === 'GET') {
      return ok(listProjects(db))
    }
    if (path === '/api/project-registry' && method === 'POST') {
      const body = await jsonBody(req)
      if (!body) return err('invalid JSON body')
      const { basename } = await import('path')
      const projPath = optionalString(body['path'])?.trim()
      if (!projPath) return err('path is required')
      upsertProject(db, {
        id: randomUUID(),
        path: projPath,
        name: optionalString(body['name']) ?? basename(projPath),
        description: optionalString(body['description']),
        tags: stringArray(body['tags']),
        created_at: new Date().toISOString(),
      })
      return ok({ ok: true })
    }
    const projMatch = path.match(/^\/api\/project-registry\/(.+)$/)
    if (projMatch && method === 'DELETE') {
      deleteProject(db, decodeURIComponent(projMatch[1]!))
      return ok({ ok: true })
    }

    // Pricing
    if (path === '/api/pricing' && method === 'GET') {
      return ok(listModelPricing(db))
    }
    if (path === '/api/pricing' && method === 'POST') {
      const body = await jsonBody(req)
      if (!body) return err('invalid JSON body')
      const model = String(body['model'] ?? '').trim()
      if (!model) return err('model is required')
      const input = finiteNumber(body['input_per_1m'])
      const output = finiteNumber(body['output_per_1m'])
      const cacheRead = finiteNumber(body['cache_read_per_1m'] ?? 0)
      const cacheWrite = finiteNumber(body['cache_write_per_1m'] ?? 0)
      const cacheWrite1h = finiteNumber(body['cache_write_1h_per_1m'] ?? 0)
      const cacheStorage = finiteNumber(body['cache_storage_per_1m_hour'] ?? 0)
      if ([input, output, cacheRead, cacheWrite, cacheWrite1h, cacheStorage].some(v => v == null || v < 0)) {
        return err('pricing values must be non-negative numbers')
      }
      const pricing = {
        model,
        input_per_1m: input!,
        output_per_1m: output!,
        cache_read_per_1m: cacheRead!,
        cache_write_per_1m: cacheWrite!,
        cache_write_1h_per_1m: cacheWrite1h!,
        cache_storage_per_1m_hour: cacheStorage!,
        updated_at: new Date().toISOString(),
      }
      upsertModelPricing(db, pricing)
      return ok(pricing)
    }
    const pricingMatch = path.match(/^\/api\/pricing\/(.+)$/)
    if (pricingMatch && method === 'DELETE') {
      deleteModelPricing(db, decodeURIComponent(pricingMatch[1]!))
      return ok({ ok: true })
    }

    // Sync trigger
    if (path === '/api/sync' && method === 'POST') {
      const body = await jsonBody(req) ?? {}
      const sources = (body['sources'] as string | null) ?? 'all'
      if (!(SYNC_SOURCES as readonly string[]).includes(sources)) return err('invalid sync source')
      const results: Record<string, unknown> = {}
      if (sources === 'all') {
        try {
          const { syncOpenProjectsRegistry } = await import('../lib/open-projects.js')
          results['projects'] = await syncOpenProjectsRegistry(db)
        } catch { /* open-projects registry sync is optional */ }
      }
      const selected = sources === 'all'
        ? {}
        : { [sources]: true } as Record<string, boolean>
      const syncResult = await syncAll(db, selected)
      Object.assign(results, syncResult)
      try {
        const { checkAndFireWebhooks } = await import('../lib/webhooks.js')
        await checkAndFireWebhooks(db)
      } catch { /* webhooks are optional */ }
      return ok(results)
    }

    // Bulk ingest — import a client's local rows into the cloud DB over the
    // authed HTTPS API (self_hosted flip forbids a raw RDS DSN on fleet machines,
    // and the big time-series tables have no other write path). Merges by primary
    // key via explicit dialect-safe ON CONFLICT upserts, so re-runs are idempotent
    // (no duplicates) on both SQLite and Postgres. Body: { requests?, sessions?,
    // projects?, budgets?, goals?, billing_daily?, model_pricing?, subscriptions?,
    // usage_snapshots? } — each an array of that table's rows.
    if (path === '/api/ingest' && method === 'POST') {
      const body = await jsonBody(req)
      if (!body) return err('invalid JSON body')
      const result = bulkIngest(db, body)
      // Session rows in the payload are client-computed aggregates over only
      // the files that changed since that client's last sync (mtime delta).
      // Trusting them overwrites the hosted session totals with partial
      // aggregates (reproduced: two requests stored while the session reports
      // request_count: 1). The server's requests table is the authoritative,
      // idempotent store — recompute every session touched by this payload's
      // requests from it.
      const reqRows = Array.isArray(body?.['requests']) ? body['requests'] as Array<Record<string, unknown>> : []
      const touchedSessions = new Set<string>()
      for (const r of reqRows) {
        const sid = r?.['session_id']
        if (typeof sid === 'string' && sid) touchedSessions.add(sid)
      }
      for (const sid of touchedSessions) {
        const hasReq = db.prepare(`SELECT COUNT(*) AS c FROM requests WHERE session_id = ?`).get(sid) as { c: number } | undefined
        if (Number(hasReq?.c ?? 0) > 0) rollupSession(db, sid)
      }
      // Parity with the /api/sync route: fire budget/spike webhooks from the
      // authoritative store after the data landed. Cloud-client syncs push via
      // this route, so the webhook side-effect must live here, not on the client.
      try {
        const { checkAndFireWebhooks } = await import('../lib/webhooks.js')
        await checkAndFireWebhooks(db)
      } catch { /* webhooks are optional */ }
      return ok(result)
    }

    if (path === '/api/usage' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'month') as Period
      const agentParam = url.searchParams.get('agent') ?? undefined
      const agent = agentParam && isAgent(agentParam) ? agentParam : undefined
      return ok({
        snapshots: queryUsageSnapshots(db, {
          agent,
          ...usageSnapshotFilterForPeriod(period),
        }),
        summary: querySummary(db, period, undefined, true, agent),
      })
    }

    if (path === '/api/savings' && method === 'GET') {
      const period = (url.searchParams.get('period') ?? 'month') as Period
      const agent = url.searchParams.get('agent') ?? undefined
      return ok(querySavingsSummary(db, period, agent && isAgent(agent) ? agent : undefined))
    }

    // Fleet brief (economy brief)
    if (path === '/api/brief' && method === 'GET') {
      const since = url.searchParams.get('since') ?? undefined
      const machine = url.searchParams.get('machine') ?? undefined
      try {
        return ok(buildBrief(db, { since, machine }))
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e))
      }
    }

    // Project detail (economy project show)
    if (path === '/api/projects/detail' && method === 'GET') {
      const q = url.searchParams.get('q')?.trim()
      if (!q) return err('q is required')
      return ok(queryProjectDetail(db, q))
    }

    // CSV export rows (economy export)
    if (path === '/api/export' && method === 'GET') {
      const type = (url.searchParams.get('type') ?? 'sessions') as ExportType
      if (type !== 'sessions' && type !== 'requests') return err('type must be sessions or requests')
      const period = url.searchParams.get('period') ?? 'month'
      return ok(queryExportRows(db, type, period))
    }

    // Period comparison range stats (economy compare)
    if (path === '/api/compare' && method === 'GET') {
      const from = url.searchParams.get('from')?.trim()
      const to = url.searchParams.get('to')?.trim()
      if (!from || !to) return err('from and to are required (YYYY-MM-DD)')
      return ok(queryRangeStats(db, from, to))
    }

    // End-of-month forecast (economy forecast)
    if (path === '/api/forecast' && method === 'GET') {
      return ok(queryForecast(db))
    }

    // Per-model token efficiency (economy efficiency)
    if (path === '/api/efficiency' && method === 'GET') {
      return ok(queryModelEfficiency(db))
    }

    // Requests since a timestamp (economy watch live stream)
    if (path === '/api/requests' && method === 'GET') {
      const since = url.searchParams.get('since')?.trim()
      if (!since) return err('since is required (ISO timestamp)')
      return ok(queryRequestsSince(db, since))
    }

    if (path === '/api/subscriptions' && method === 'GET') {
      return ok(listSubscriptions(db))
    }

    if (path === '/api/subscriptions' && method === 'POST') {
      const body = await jsonBody(req)
      if (!body) return err('invalid JSON body')
      const provider = optionalString(body['provider'])?.trim()
      const plan = optionalString(body['plan'])?.trim()
      if (!provider) return err('provider is required')
      if (!plan) return err('plan is required')
      const monthlyFee = finiteNumber(body['monthly_fee_usd'] ?? body['fee_usd'] ?? 0)
      const includedUsage = finiteNumber(body['included_usage_usd'] ?? 0)
      if (monthlyFee == null || monthlyFee < 0) return err('monthly_fee_usd must be a non-negative number')
      if (includedUsage == null || includedUsage < 0) return err('included_usage_usd must be a non-negative number')
      const agent = optionalAgent(body['agent'])
      if (agent === undefined) return err(AGENT_ERROR)
      const now = new Date().toISOString()
      const subscription = {
        id: optionalString(body['id'])?.trim() || randomUUID(),
        agent,
        provider,
        plan,
        monthly_fee_usd: monthlyFee,
        included_usage_usd: includedUsage,
        billing_cycle_start: optionalString(body['billing_cycle_start']),
        reset_policy: optionalString(body['reset_policy']) ?? 'monthly',
        active: body['active'] === false || body['active'] === 0 ? 0 : 1,
        created_at: optionalString(body['created_at']) ?? now,
        updated_at: now,
      }
      upsertSubscription(db, subscription)
      return ok(subscription)
    }

    const subscriptionMatch = path.match(/^\/api\/subscriptions\/(.+)$/)
    if (subscriptionMatch && method === 'DELETE') {
      deleteSubscription(db, decodeURIComponent(subscriptionMatch[1]!))
      return ok({ ok: true })
    }

    // Session requests detail
    const sessionRequestsMatch = path.match(/^\/api\/sessions\/([^/]+)\/requests$/)
    if (sessionRequestsMatch && method === 'GET') {
      const sessionId = decodeURIComponent(sessionRequestsMatch[1]!)
      const session = db.prepare(`SELECT * FROM sessions WHERE id = ? OR id LIKE ?`).get(sessionId, `${sessionId}%`) as Record<string, unknown> | null
      if (!session) return err('Session not found', 404)
      const requests = db.prepare(`SELECT * FROM requests WHERE session_id = ? ORDER BY timestamp ASC`).all(session['id'] as string) as Array<Record<string, unknown>>
      return ok(requests, { session_id: session['id'], count: requests.length })
    }

    // Goals
    if (path === '/api/goals' && method === 'GET') {
      return ok(getGoalStatuses(db))
    }
    if (path === '/api/goals' && method === 'POST') {
      const body = await jsonBody(req)
      if (!body) return err('invalid JSON body')
      const period = body['period'] ?? 'month'
      if (!['day', 'week', 'month', 'year'].includes(String(period))) return err('period must be day, week, month, or year')
      const limitUsd = finiteNumber(body['limit_usd'])
      if (limitUsd == null || limitUsd <= 0) return err('limit_usd must be a positive number')
      const agent = optionalAgent(body['agent'])
      if (agent === undefined) return err(AGENT_ERROR)
      const now = new Date().toISOString()
      const goal = {
        id: randomUUID(),
        period: period as 'day' | 'week' | 'month' | 'year',
        project_path: optionalString(body['project_path']),
        agent,
        limit_usd: limitUsd,
        created_at: now,
        updated_at: now,
      }
      upsertGoal(db, goal)
      return ok(getGoalStatuses(db).find(g => g.id === goal.id) ?? goal)
    }
    const goalMatch = path.match(/^\/api\/goals\/(.+)$/)
    if (goalMatch && method === 'DELETE') {
      deleteGoal(db, decodeURIComponent(goalMatch[1]!))
      return ok({ ok: true })
    }

    // Feedback — the shared write path for the CLI/MCP send_feedback tool.
    if (path === '/api/feedback' && method === 'POST') {
      const body = await jsonBody(req)
      if (!body) return err('invalid JSON body')
      const message = optionalString(body['message'])?.trim()
      if (!message) return err('message is required')
      const email = optionalString(body['email'])?.trim() || null
      const rawCategory = optionalString(body['category'])?.trim() || 'general'
      if (!['bug', 'feature', 'general'].includes(rawCategory)) return err('category must be bug, feature, or general')
      insertFeedback(db, {
        message,
        email,
        category: rawCategory,
        version: packageMetadata.version,
        machine_id: getMachineId(),
      })
      return ok({ ok: true })
    }

    return err('Not found', 404)
  }
}

function isLocalHost(host: string): boolean {
  return ['127.0.0.1', 'localhost', '::1'].includes(host)
}

export function startServer(port = 3456, options: StartServerOptions = {}): ReturnType<typeof Bun.serve> {
  const cloud = options.db ? false : isPostgresBackend()
  const hostname = options.hostname ?? (cloud ? (process.env['ECONOMY_HOST'] ?? '0.0.0.0') : getServeBindHost())
  const log = options.log ?? console.log

  const handlerOptions: HandlerOptions = {}
  let db: Database

  if (cloud) {
    // Amendment A1 (PURE REMOTE): the serve reads/writes RDS Postgres directly.
    db = openCloudDatabase()
    const pool = createCloudPool()
    const signingSecret = resolveSigningSecret()
    if (signingSecret) {
      const keys = new ApiKeyStore(authClientFromPool(pool))
      // Idempotent: the api_keys table is normally created by the migration
      // task, but ensureSchema keeps a fresh DB self-healing.
      keys.ensureSchema().catch((e: unknown) => log(`api_keys ensureSchema: ${e instanceof Error ? e.message : String(e)}`))
      handlerOptions.authenticator = verifyApiKey({
        app: APP,
        signingSecret,
        // Strict: anything other than "active" (unknown, revoked, expired)
        // denies. The contract refuses the deprecated `isRevoked`-only wiring
        // eagerly at construction — use the recommended `keyStatus` hook.
        keyStatus: keys.keyStatus,
        audit: (event) => log(JSON.stringify({ evt: 'api_auth', outcome: event.outcome, kid: event.kid, reason: event.reason, path: event.path, status: event.status })),
      }) as unknown as ApiAuthenticator
    } else if (!isLocalHost(hostname)) {
      throw new Error('economy-serve on a non-local host requires an API signing secret (HASNA_ECONOMY_API_SIGNING_KEY / API_KEY_SIGNING_SECRET)')
    }
    handlerOptions.readyCheck = async () => {
      try {
        const res = await pool.query('SELECT to_regclass($1) AS reg', ['public.requests'])
        if (!res.rows[0]?.reg) return { ready: false, detail: 'pending_migrations:requests' }
        return { ready: true }
      } catch (error) {
        return { ready: false, detail: error instanceof Error ? error.message : 'storage_unreachable' }
      }
    }
  } else {
    db = options.db ?? openDatabase()
    ensurePricingSeeded(db)
  }

  const apiHandler = createHandler(db, handlerOptions)
  const server = Bun.serve({
    port,
    hostname,
    fetch: apiHandler,
  })
  const address = `http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${server.port}`
  log(`economy-serve listening on ${address}`)
  return server
}
