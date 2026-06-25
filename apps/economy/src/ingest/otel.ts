import type { Database } from '../db/database.js'
import { upsertRequest, upsertSession, rollupSession, getMachineId } from '../db/database.js'
import { isAgent } from '../lib/agents.js'
import type { Agent } from '../lib/agents.js'

export interface OtelIngestRow {
  agent: Agent
  session_id: string
  model: string
  cost_usd: number
  input_tokens: number
  output_tokens: number
  timestamp: string
  source_request_id: string
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
          const agentRaw = String(merged['agent'] ?? merged['ai.agent'] ?? 'unknown')
          const agent = isAgent(agentRaw) ? agentRaw : 'opencode'
          const sessionId = String(merged['session_id'] ?? merged['session.id'] ?? 'otel-session')
          const model = String(merged['model'] ?? merged['ai.model'] ?? 'unknown')
          const sourceId = String(merged['request_id'] ?? merged['event.id'] ?? `${sessionId}-${kind}`)
          const key = `${agent}:${sourceId}`

          const row = partial.get(key) ?? {
            key,
            agent,
            session_id: sessionId,
            model,
            cost_usd: 0,
            input_tokens: 0,
            output_tokens: 0,
            timestamp: new Date().toISOString(),
            source_request_id: sourceId,
          }

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
    }))
}

export function parseSimpleIngest(body: unknown): OtelIngestRow | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const agentRaw = String(b['agent'] ?? '')
  if (!isAgent(agentRaw)) return null
  const cost = Number(b['cost_usd'] ?? 0)
  const input = Number(b['input_tokens'] ?? 0)
  const output = Number(b['output_tokens'] ?? 0)
  if (cost <= 0 && input + output <= 0) return null
  const sessionId = String(b['session_id'] ?? 'otel-session')
  const sourceId = String(b['request_id'] ?? b['source_request_id'] ?? `${sessionId}-${Date.now()}`)
  return {
    agent: agentRaw,
    session_id: sessionId,
    model: String(b['model'] ?? 'unknown'),
    cost_usd: cost,
    input_tokens: input,
    output_tokens: output,
    timestamp: String(b['timestamp'] ?? new Date().toISOString()),
    source_request_id: sourceId,
  }
}

export async function ingestOtelRows(db: Database, rows: OtelIngestRow[]): Promise<{ requests: number; sessions: number }> {
  const machineId = getMachineId()
  const sessions = new Set<string>()
  let requests = 0

  for (const row of rows) {
    const reqId = `otel-${row.agent}-${row.source_request_id}`
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
      cost_basis: 'estimated',
      duration_ms: 0,
      timestamp: row.timestamp,
      source_request_id: row.source_request_id,
      machine_id: machineId,
      attribution_tag: 'otel',
    })

    if (!sessions.has(row.session_id)) {
      upsertSession(db, {
        id: row.session_id,
        agent: row.agent,
        project_path: '',
        project_name: '',
        started_at: row.timestamp,
        ended_at: null,
        total_cost_usd: 0,
        total_tokens: 0,
        request_count: 0,
        machine_id: machineId,
      })
      sessions.add(row.session_id)
    }
    requests++
  }

  for (const sessionId of sessions) rollupSession(db, sessionId)
  return { requests, sessions: sessions.size }
}
