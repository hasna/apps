import { readFileSync } from 'fs'
import type { SqliteAdapter as Database } from '@hasna/cloud'
import { upsertBillingDaily, clearBillingRange } from '../db/database.js'

function getAnthropicAdminKey(): string | null {
  return process.env['HASNAXYZ_ANTHROPIC_LIVE_ADMIN_API_KEY']
    ?? process.env['ANTHROPIC_ADMIN_API_KEY']
    ?? null
}

function getOpenAIAdminKey(): string | null {
  return process.env['HASNAXYZ_OPENAI_LIVE_ADMIN_API_KEY']
    ?? process.env['OPENAI_ADMIN_API_KEY']
    ?? null
}

function getGeminiBillingExportPath(): string | null {
  return process.env['HASNA_ECONOMY_GEMINI_BILLING_EXPORT_PATH']
    ?? process.env['HASNAXYZ_ECONOMY_GEMINI_BILLING_EXPORT_PATH']
    ?? process.env['GEMINI_BILLING_EXPORT_PATH']
    ?? null
}

function toISODate(d: Date): string {
  return d.toISOString().substring(0, 10)
}

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.substring(0, 10)
  return toISODate(d)
}

function parseCsv(content: string): Array<Record<string, unknown>> {
  const lines = content.split(/\r?\n/).filter(line => line.trim())
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]!).map(h => h.trim())
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, i) => [header, values[i]?.trim() ?? '']))
  })
}

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let value = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"'
        i++
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      values.push(value)
      value = ''
    } else {
      value += char
    }
  }
  values.push(value)
  return values
}

function parseBillingRows(content: string): Array<Record<string, unknown>> {
  const trimmed = content.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)['rows'])) {
      return (parsed as Record<string, unknown>)['rows'] as Array<Record<string, unknown>>
    }
  } catch { /* try JSONL/CSV below */ }

  const jsonlRows: Array<Record<string, unknown>> = []
  for (const line of trimmed.split(/\r?\n/)) {
    try {
      const parsed = JSON.parse(line) as unknown
      if (parsed && typeof parsed === 'object') jsonlRows.push(parsed as Record<string, unknown>)
    } catch {
      jsonlRows.length = 0
      break
    }
  }
  if (jsonlRows.length > 0) return jsonlRows
  return parseCsv(content)
}

interface AnthropicBucket {
  starting_at: string
  ending_at: string
  results: Array<{ amount: string; description: string | null; model: string | null }>
}

interface AnthropicCostResponse {
  data?: AnthropicBucket[]
  has_more?: boolean
  next_page?: string
  error?: { message: string }
}

export async function syncAnthropicBilling(
  db: Database,
  opts: { days?: number; fromDate?: string; toDate?: string } = {},
): Promise<{ days: number; totalUsd: number }> {
  const key = getAnthropicAdminKey()
  if (!key) throw new Error('Missing Anthropic admin key (HASNAXYZ_ANTHROPIC_LIVE_ADMIN_API_KEY)')

  const now = new Date()
  const end = opts.toDate ? new Date(opts.toDate) : new Date(now.getTime() + 24 * 3600_000)
  const days = opts.days ?? 31
  const start = opts.fromDate
    ? new Date(opts.fromDate)
    : new Date(end.getTime() - days * 24 * 3600_000)

  const startIso = start.toISOString().replace(/\.\d+/, '').replace(/:\d{2}Z$/, ':00Z')
  const endIso = end.toISOString().replace(/\.\d+/, '').replace(/:\d{2}Z$/, ':00Z')

  let totalUsd = 0
  const buckets: AnthropicBucket[] = []
  let nextPage: string | undefined

  do {
    const url = new URL('https://api.anthropic.com/v1/organizations/cost_report')
    url.searchParams.set('starting_at', startIso)
    url.searchParams.set('ending_at', endIso)
    url.searchParams.set('bucket_width', '1d')
    url.searchParams.set('limit', '31')
    url.searchParams.append('group_by[]', 'description')
    if (nextPage) url.searchParams.set('page', nextPage)

    const res = await fetch(url.toString(), {
      headers: { 'anthropic-version': '2023-06-01', 'x-api-key': key },
    })
    const data = await res.json() as AnthropicCostResponse
    if (data.error) throw new Error(`Anthropic API: ${data.error.message}`)
    if (data.data) buckets.push(...data.data)
    nextPage = data.has_more ? data.next_page : undefined
  } while (nextPage)

  // Clear existing rows in the date range so we can replace
  const fromDateStr = toISODate(start)
  const toDateStr = toISODate(new Date(end.getTime() - 1000))
  clearBillingRange(db, 'anthropic', fromDateStr, toDateStr)

  const updatedAt = new Date().toISOString()
  for (const bucket of buckets) {
    const date = bucket.starting_at.substring(0, 10)
    for (const r of bucket.results) {
      // Anthropic cost amounts are in cents as decimal strings
      const usd = Number(r.amount) / 100
      if (usd === 0) continue
      const desc = (r.description ?? 'unknown').substring(0, 200)
      upsertBillingDaily(db, { date, provider: 'anthropic', description: desc, cost_usd: usd, updated_at: updatedAt })
      totalUsd += usd
    }
  }

  return { days: buckets.length, totalUsd }
}

interface OpenAICostBucket {
  start_time: number
  end_time: number
  results: Array<{ amount: { value: number; currency: string }; line_item?: string }>
}

interface OpenAICostResponse {
  data?: OpenAICostBucket[]
  has_more?: boolean
  next_page?: string
  error?: { message: string }
}

export async function syncOpenAIBilling(
  db: Database,
  opts: { days?: number; fromDate?: string; toDate?: string } = {},
): Promise<{ days: number; totalUsd: number }> {
  const key = getOpenAIAdminKey()
  if (!key) throw new Error('Missing OpenAI admin key (HASNAXYZ_OPENAI_LIVE_ADMIN_API_KEY)')

  const now = new Date()
  const end = opts.toDate ? new Date(opts.toDate) : now
  const days = opts.days ?? 31
  const start = opts.fromDate
    ? new Date(opts.fromDate)
    : new Date(end.getTime() - days * 24 * 3600_000)

  const startSec = Math.floor(start.getTime() / 1000)
  const endSec = Math.floor(end.getTime() / 1000)

  let totalUsd = 0
  const buckets: OpenAICostBucket[] = []
  let nextPage: string | undefined

  do {
    const url = new URL('https://api.openai.com/v1/organization/costs')
    url.searchParams.set('start_time', String(startSec))
    url.searchParams.set('end_time', String(endSec))
    url.searchParams.set('bucket_width', '1d')
    url.searchParams.set('limit', '31')
    url.searchParams.append('group_by[]', 'line_item')
    if (nextPage) url.searchParams.set('page', nextPage)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
    })
    const data = await res.json() as OpenAICostResponse
    if (data.error) throw new Error(`OpenAI API: ${data.error.message}`)
    if (data.data) buckets.push(...data.data)
    nextPage = data.has_more ? data.next_page : undefined
  } while (nextPage)

  const fromDateStr = toISODate(start)
  const toDateStr = toISODate(new Date(end.getTime() - 1000))
  clearBillingRange(db, 'openai', fromDateStr, toDateStr)

  const updatedAt = new Date().toISOString()
  for (const bucket of buckets) {
    const date = new Date(bucket.start_time * 1000).toISOString().substring(0, 10)
    for (const r of bucket.results) {
      const usd = Number(r.amount?.value ?? 0)
      if (usd === 0) continue
      const desc = (r.line_item ?? 'unknown').substring(0, 200)
      upsertBillingDaily(db, { date, provider: 'openai', description: desc, cost_usd: usd, updated_at: updatedAt })
      totalUsd += usd
    }
  }

  return { days: buckets.length, totalUsd }
}

export async function syncGeminiBilling(
  db: Database,
  opts: { days?: number; fromDate?: string; toDate?: string } = {},
): Promise<{ days: number; totalUsd: number; skipped?: string }> {
  const exportPath = getGeminiBillingExportPath()
  if (!exportPath) {
    return {
      days: 0,
      totalUsd: 0,
      skipped: 'Missing Gemini billing export path (HASNA_ECONOMY_GEMINI_BILLING_EXPORT_PATH, HASNAXYZ_ECONOMY_GEMINI_BILLING_EXPORT_PATH, or GEMINI_BILLING_EXPORT_PATH)',
    }
  }

  const now = new Date()
  const end = opts.toDate ? new Date(opts.toDate) : now
  const days = opts.days ?? 31
  const start = opts.fromDate
    ? new Date(opts.fromDate)
    : new Date(end.getTime() - days * 24 * 3600_000)
  const fromDateStr = toISODate(start)
  const toDateStr = toISODate(end)

  const rows = parseBillingRows(readFileSync(exportPath, 'utf-8'))
  clearBillingRange(db, 'gemini', fromDateStr, toDateStr)

  const updatedAt = new Date().toISOString()
  let totalUsd = 0
  const seenDays = new Set<string>()
  for (const row of rows) {
    const date = parseDate(row['date'] ?? row['usage_start_time'] ?? row['start_time'] ?? row['invoice.month'])
    if (!date || date < fromDateStr || date > toDateStr) continue
    const rawCost = row['cost_usd'] ?? row['costUsd'] ?? row['cost'] ?? row['amount']
    const costUsd = Number(rawCost)
    if (!Number.isFinite(costUsd) || costUsd === 0) continue
    const service = row['service.description'] ?? row['service'] ?? row['provider'] ?? ''
    const sku = row['sku.description'] ?? row['sku'] ?? row['description'] ?? 'Gemini API'
    const description = `${String(service || 'Google AI')}: ${String(sku)}`.substring(0, 200)
    upsertBillingDaily(db, { date, provider: 'gemini', description, cost_usd: costUsd, updated_at: updatedAt })
    totalUsd += costUsd
    seenDays.add(date)
  }

  return { days: seenDays.size, totalUsd }
}
