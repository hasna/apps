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

function toISODate(d: Date): string {
  return d.toISOString().substring(0, 10)
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
