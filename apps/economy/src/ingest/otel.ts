import type { SqliteAdapter as Database } from '@hasna/cloud'
import { upsertRequest, upsertSession, rollupSession, getMachineId, upsertCostCenter } from '../db/database.js'
import { isAgent } from '../lib/agents.js'
import type { CostBasis, CostCenterKind, EconomyAgent } from '../types/index.js'

export interface OtelIngestRow {
  agent: EconomyAgent
  session_id: string
  model: string
  cost_usd: number
  input_tokens: number
  output_tokens: number
  timestamp: string
  source_request_id: string
  cost_basis?: CostBasis
  cost_center?: string
  cost_center_kind?: CostCenterKind
  cost_center_id?: string
  attribution_tag?: string
  project_path?: string
  project_name?: string
  repo?: string
  account_key?: string
  account_tool?: string
  account_name?: string
  account_email?: string
  account_source?: string
}

interface OtlpAttribute {
  key?: string
  value?: { stringValue?: string; intValue?: string; doubleValue?: number }
}

function attrValue(attr: OtlpAttribute | undefined): string | number | undefined {
  if (!attr?.value) return undefined
  if (attr.value.stringValue != null) return attr.value.stringValue
  if (attr.value.doubleValue != null) return attr.value.doubleValue
  if (attr.value.intValue != null) return Number(attr.value.intValue)
  return undefined
}

function attrsMap(attributes: OtlpAttribute[] | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const a of attributes ?? []) {
    if (!a.key) continue
    const v = attrValue(a)
    if (v != null) out[a.key] = v
  }
  return out
}

const COST_CENTER_KINDS: readonly CostCenterKind[] = ['loop', 'app', 'repo', 'service', 'team']
const PSEUDO_AGENTS: readonly EconomyAgent[] = ['app', 'service', 'repo', 'loop']

function isCostCenterKind(value: string): value is CostCenterKind {
  return (COST_CENTER_KINDS as readonly string[]).includes(value)
}

function asString(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value).trim()
  return text ? text : undefined
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(source[key])
    if (value) return value
  }
  return undefined
}

function normalizeCostCenterKind(raw: string | undefined): CostCenterKind | undefined {
  if (!raw) return undefined
  const value = raw.toLowerCase()
  return isCostCenterKind(value) ? value : undefined
}

function normalizeAgent(raw: string | undefined, kind: CostCenterKind | undefined): EconomyAgent {
  if (raw && isAgent(raw)) return raw
  if (raw && (PSEUDO_AGENTS as readonly string[]).includes(raw)) return raw as EconomyAgent
  if (kind && (PSEUDO_AGENTS as readonly string[]).includes(kind)) return kind as EconomyAgent
  return 'service'
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'
}

function costCenterId(kind: CostCenterKind | undefined, name: string | undefined, explicitId?: string): string | undefined {
  if (explicitId) return explicitId
  if (!kind || !name) return undefined
  return `${kind}:${slug(name)}`
}

function projectNameFromPath(projectPath: string | undefined): string | undefined {
  if (!projectPath) return undefined
  return projectPath.split('/').filter(Boolean).at(-1)
}

function extractAttribution(source: Record<string, unknown>): Pick<
  OtelIngestRow,
  'agent' | 'cost_center' | 'cost_center_kind' | 'cost_center_id' | 'attribution_tag' |
  'project_path' | 'project_name' | 'repo' | 'account_key' | 'account_tool' |
  'account_name' | 'account_email' | 'account_source' | 'cost_basis'
> {
  const sourceKind = firstString(source, ['source', 'source_kind', 'ai.source'])
  const rawKind = firstString(source, ['cost_center_kind', 'cost_center.kind', 'economy.cost_center.kind']) ?? sourceKind
  const costCenterKind = normalizeCostCenterKind(rawKind)
  const costCenter = firstString(source, [
    'cost_center',
    'cost_center_name',
    'cost_center.name',
    'economy.cost_center',
    'service.name',
    'app',
    'app.name',
    'repo',
    'repository',
  ])
  const projectPath = firstString(source, ['project_path', 'project.path', 'repo_path', 'repository.path'])
  const explicitId = firstString(source, ['cost_center_id', 'cost_center.id', 'economy.cost_center.id'])
  const costBasisRaw = firstString(source, ['cost_basis', 'economy.cost_basis'])
  const costBasis = costBasisRaw && ['metered_api', 'subscription_included', 'estimated', 'unknown'].includes(costBasisRaw)
    ? costBasisRaw as CostBasis
    : undefined

  return {
    agent: normalizeAgent(firstString(source, ['agent', 'ai.agent']) ?? sourceKind, costCenterKind),
    cost_center: costCenter,
    cost_center_kind: costCenterKind,
    cost_center_id: costCenterId(costCenterKind, costCenter, explicitId),
    attribution_tag: firstString(source, ['attribution_tag', 'attribution.tag', 'economy.attribution_tag']),
    project_path: projectPath,
    project_name: firstString(source, ['project_name', 'project.name']) ?? projectNameFromPath(projectPath) ?? costCenter,
    repo: firstString(source, ['repo', 'repository', 'repository.name']),
    account_key: firstString(source, ['account_key', 'account.key', 'economy.account_key']),
    account_tool: firstString(source, ['account_tool', 'account.tool', 'economy.account_tool']),
    account_name: firstString(source, ['account_name', 'account.name', 'economy.account_name']),
    account_email: firstString(source, ['account_email', 'account.email', 'economy.account_email']),
    account_source: firstString(source, ['account_source', 'account.source', 'economy.account_source']),
    cost_basis: costBasis,
  }
}

function mergeAttribution<T extends Partial<OtelIngestRow>>(
  row: T,
  attribution: Partial<OtelIngestRow>,
): T {
  return {
    ...row,
    ...Object.fromEntries(Object.entries(attribution).filter(([, value]) => value !== undefined && value !== '')),
  } as T
}

function metricKind(body: Record<string, unknown>): 'cost' | 'input_tokens' | 'output_tokens' | null {
  const name = String(body['name'] ?? '').toLowerCase()
  if (name.includes('cost') || name.includes('.usd')) return 'cost'
  if (name.includes('input') && name.includes('token')) return 'input_tokens'
  if (name.includes('output') && name.includes('token')) return 'output_tokens'
  if (name.endsWith('.token.usage') || name.includes('tokens.input')) return 'input_tokens'
  if (name.includes('tokens.output')) return 'output_tokens'
  return null
}

/** Parse OTLP/HTTP JSON metrics into normalized ingest rows. */
export function parseOtlpMetrics(body: unknown): OtelIngestRow[] {
  if (!body || typeof body !== 'object') return []
  const resourceMetrics = (body as Record<string, unknown>)['resourceMetrics']
  if (!Array.isArray(resourceMetrics)) return []

  const partial = new Map<string, Partial<OtelIngestRow> & { key: string }>()

  for (const rm of resourceMetrics) {
    if (!rm || typeof rm !== 'object') continue
    const resourceAttrs = attrsMap((rm as Record<string, unknown>)['resource'] as { attributes?: OtlpAttribute[] } | undefined
      ? ((rm as Record<string, unknown>)['resource'] as { attributes?: OtlpAttribute[] }).attributes
      : undefined)
    const scopeMetrics = (rm as Record<string, unknown>)['scopeMetrics']
    if (!Array.isArray(scopeMetrics)) continue

    for (const sm of scopeMetrics) {
      if (!sm || typeof sm !== 'object') continue
      const metrics = (sm as Record<string, unknown>)['metrics']
      if (!Array.isArray(metrics)) continue

      for (const metric of metrics) {
        if (!metric || typeof metric !== 'object') continue
        const kind = metricKind(metric as Record<string, unknown>)
        if (!kind) continue

        const sum = (metric as Record<string, unknown>)['sum'] as { dataPoints?: unknown[] } | undefined
        const gauge = (metric as Record<string, unknown>)['gauge'] as { dataPoints?: unknown[] } | undefined
        const dataPoints = sum?.dataPoints ?? gauge?.dataPoints ?? []

        for (const dp of dataPoints) {
          if (!dp || typeof dp !== 'object') continue
          const pointAttrs = attrsMap((dp as { attributes?: OtlpAttribute[] }).attributes)
          const merged = { ...resourceAttrs, ...pointAttrs }
          const attribution = extractAttribution(merged)
          const agent = attribution.agent
          const sessionId = String(merged['session_id'] ?? merged['session.id'] ?? 'otel-session')
          const model = String(merged['model'] ?? merged['ai.model'] ?? 'unknown')
          const sourceId = String(merged['request_id'] ?? merged['event.id'] ?? `${sessionId}-${kind}`)
          const key = `${agent}:${sourceId}`

          const row = mergeAttribution(partial.get(key) ?? {
            key,
            agent,
            session_id: sessionId,
            model,
            cost_usd: 0,
            input_tokens: 0,
            output_tokens: 0,
            timestamp: new Date().toISOString(),
            source_request_id: sourceId,
          }, attribution)

          const asDouble = (dp as { asDouble?: number }).asDouble
          const asInt = (dp as { asInt?: string }).asInt
          const value = asDouble ?? (asInt != null ? Number(asInt) : 0)
          if (kind === 'cost') row.cost_usd = value
          if (kind === 'input_tokens') row.input_tokens = Math.round(value)
          if (kind === 'output_tokens') row.output_tokens = Math.round(value)

          const timeUnixNano = (dp as { timeUnixNano?: string }).timeUnixNano
          if (timeUnixNano) {
            row.timestamp = new Date(Number(timeUnixNano) / 1_000_000).toISOString()
          }

          partial.set(key, row)
        }
      }
    }
  }

  return [...partial.values()]
    .filter((r) => (r.cost_usd ?? 0) > 0 || (r.input_tokens ?? 0) + (r.output_tokens ?? 0) > 0)
    .map((r) => ({
      agent: r.agent!,
      session_id: r.session_id!,
      model: r.model!,
      cost_usd: r.cost_usd ?? 0,
      input_tokens: r.input_tokens ?? 0,
      output_tokens: r.output_tokens ?? 0,
      timestamp: r.timestamp!,
      source_request_id: r.source_request_id!,
      cost_basis: r.cost_basis,
      cost_center: r.cost_center,
      cost_center_kind: r.cost_center_kind,
      cost_center_id: r.cost_center_id,
      attribution_tag: r.attribution_tag,
      project_path: r.project_path,
      project_name: r.project_name,
      repo: r.repo,
      account_key: r.account_key,
      account_tool: r.account_tool,
      account_name: r.account_name,
      account_email: r.account_email,
      account_source: r.account_source,
    }))
}

export function parseSimpleIngest(body: unknown): OtelIngestRow | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const attribution = extractAttribution(b)
  const cost = Number(b['cost_usd'] ?? 0)
  const input = Number(b['input_tokens'] ?? 0)
  const output = Number(b['output_tokens'] ?? 0)
  if (cost <= 0 && input + output <= 0) return null
  const sessionId = String(b['session_id'] ?? 'otel-session')
  const sourceId = String(b['request_id'] ?? b['source_request_id'] ?? `${sessionId}-${Date.now()}`)
  return {
    ...attribution,
    agent: attribution.agent,
    session_id: sessionId,
    model: String(b['model'] ?? 'unknown'),
    cost_usd: cost,
    input_tokens: input,
    output_tokens: output,
    timestamp: String(b['timestamp'] ?? new Date().toISOString()),
    source_request_id: sourceId,
  }
}

function ensureCostCenter(db: Database, row: OtelIngestRow): string | undefined {
  const id = row.cost_center_id ?? costCenterId(row.cost_center_kind, row.cost_center)
  if (!id || !row.cost_center_kind || !row.cost_center) return id
  const labels: Record<string, string> = { source: 'otel' }
  if (row.repo) labels['repo'] = row.repo
  upsertCostCenter(db, {
    id,
    kind: row.cost_center_kind,
    name: row.cost_center,
    repo_path: row.project_path ?? null,
    labels_json: JSON.stringify(labels),
    created_at: row.timestamp,
  })
  return id
}

export async function ingestOtelRows(db: Database, rows: OtelIngestRow[]): Promise<{ requests: number; sessions: number }> {
  const machineId = getMachineId()
  const sessions = new Set<string>()
  let requests = 0

  for (const row of rows) {
    const costCenterId = ensureCostCenter(db, row)
    const requestScope = slug(costCenterId ?? row.cost_center ?? row.project_path ?? row.session_id)
    const reqId = `otel-${row.agent}-${requestScope}-${row.source_request_id}`
    upsertRequest(db, {
      id: reqId,
      agent: row.agent,
      session_id: row.session_id,
      model: row.model,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_read_tokens: 0,
      cache_create_tokens: 0,
      cost_usd: row.cost_usd,
      cost_basis: row.cost_basis ?? 'estimated',
      duration_ms: 0,
      timestamp: row.timestamp,
      source_request_id: row.source_request_id,
      machine_id: machineId,
      cost_center_id: costCenterId ?? null,
      attribution_tag: row.attribution_tag ?? 'otel',
      account_key: row.account_key ?? '',
      account_tool: row.account_tool ?? '',
      account_name: row.account_name ?? '',
      account_email: row.account_email ?? '',
      account_source: row.account_source ?? '',
    })

    if (!sessions.has(row.session_id)) {
      upsertSession(db, {
        id: row.session_id,
        agent: row.agent,
        project_path: row.project_path ?? '',
        project_name: row.project_name ?? row.repo ?? row.cost_center ?? '',
        started_at: row.timestamp,
        ended_at: null,
        total_cost_usd: 0,
        total_tokens: 0,
        request_count: 0,
        machine_id: machineId,
        cost_center_id: costCenterId ?? null,
        attribution_tag: row.attribution_tag ?? 'otel',
        account_key: row.account_key ?? '',
        account_tool: row.account_tool ?? '',
        account_name: row.account_name ?? '',
        account_email: row.account_email ?? '',
        account_source: row.account_source ?? '',
      })
      sessions.add(row.session_id)
    }
    requests++
  }

  for (const sessionId of sessions) rollupSession(db, sessionId)
  return { requests, sessions: sessions.size }
}
