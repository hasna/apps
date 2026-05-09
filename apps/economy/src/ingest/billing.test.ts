import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, queryBillingSummary } from '../db/database.js'
import { syncAnthropicBilling, syncGeminiBilling, syncOpenAIBilling } from './billing.js'
import type { SqliteAdapter as Database } from '@hasna/cloud'

let root: string
let db: Database
const realFetch = globalThis.fetch

beforeEach(() => {
  root = join(tmpdir(), `economy-billing-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(root, { recursive: true })
  db = openDatabase(':memory:', true)
})

afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env['HASNAXYZ_ANTHROPIC_LIVE_ADMIN_API_KEY']
  delete process.env['ANTHROPIC_ADMIN_API_KEY']
  delete process.env['HASNAXYZ_OPENAI_LIVE_ADMIN_API_KEY']
  delete process.env['OPENAI_ADMIN_API_KEY']
  delete process.env['HASNA_ECONOMY_GEMINI_BILLING_EXPORT_PATH']
  delete process.env['HASNAXYZ_ECONOMY_GEMINI_BILLING_EXPORT_PATH']
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('syncAnthropicBilling', () => {
  it('imports paginated Anthropic cost report rows from cents to USD', async () => {
    process.env['HASNAXYZ_ANTHROPIC_LIVE_ADMIN_API_KEY'] = 'anthropic-admin-test'
    const seenUrls: URL[] = []
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      seenUrls.push(url)
      expect(url.pathname).toBe('/v1/organizations/cost_report')
      expect(init?.headers).toMatchObject({
        'anthropic-version': '2023-06-01',
        'x-api-key': 'anthropic-admin-test',
      })

      if (url.searchParams.get('page') === 'page_2') {
        return Response.json({
          data: [{
            starting_at: '2026-05-09T00:00:00Z',
            ending_at: '2026-05-10T00:00:00Z',
            results: [{
              amount: '50',
              description: null,
              model: null,
            }],
          }],
          has_more: false,
          next_page: null,
        })
      }

      expect(url.searchParams.get('bucket_width')).toBe('1d')
      expect(url.searchParams.getAll('group_by[]')).toEqual(['description'])
      return Response.json({
        data: [{
          starting_at: '2026-05-08T00:00:00Z',
          ending_at: '2026-05-09T00:00:00Z',
          results: [{
            amount: '123.45',
            description: 'Claude Sonnet 4 Usage - Input Tokens',
            model: 'claude-sonnet-4',
          }],
        }],
        has_more: true,
        next_page: 'page_2',
      })
    }) as typeof fetch

    const result = await syncAnthropicBilling(db, { fromDate: '2026-05-08', toDate: '2026-05-10' })
    expect(result.days).toBe(2)
    expect(result.totalUsd).toBeCloseTo(1.7345)
    expect(seenUrls).toHaveLength(2)

    const summary = queryBillingSummary(db, 'all')
    expect(summary.by_provider.anthropic).toBeCloseTo(1.7345)
  })
})

describe('syncOpenAIBilling', () => {
  it('imports OpenAI organization cost rows grouped by line item', async () => {
    process.env['HASNAXYZ_OPENAI_LIVE_ADMIN_API_KEY'] = 'openai-admin-test'
    const seenUrls: URL[] = []
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      seenUrls.push(url)
      expect(url.pathname).toBe('/v1/organization/costs')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer openai-admin-test' })
      expect(url.searchParams.get('bucket_width')).toBe('1d')
      expect(url.searchParams.getAll('group_by[]')).toEqual(['line_item'])

      return Response.json({
        data: [{
          start_time: Math.floor(Date.parse('2026-05-08T00:00:00Z') / 1000),
          end_time: Math.floor(Date.parse('2026-05-09T00:00:00Z') / 1000),
          results: [
            { amount: { value: 2.75, currency: 'usd' }, line_item: 'GPT-5.5 input' },
            { amount: { value: '0.25', currency: 'usd' }, line_item: 'GPT-5.5 cached input' },
          ],
        }],
        has_more: false,
        next_page: null,
      })
    }) as typeof fetch

    const result = await syncOpenAIBilling(db, { fromDate: '2026-05-08', toDate: '2026-05-10' })
    expect(result.days).toBe(1)
    expect(result.totalUsd).toBeCloseTo(3)
    expect(seenUrls).toHaveLength(1)

    const summary = queryBillingSummary(db, 'all')
    expect(summary.by_provider.openai).toBeCloseTo(3)
  })
})

describe('syncGeminiBilling', () => {
  it('imports Gemini costs from a Google billing export file', async () => {
    const exportPath = join(root, 'gemini-billing.json')
    writeFileSync(exportPath, JSON.stringify([
      {
        date: '2026-05-08',
        'service.description': 'Google AI',
        'sku.description': 'Gemini API',
        cost_usd: 12.34,
      },
      {
        date: '2026-05-07',
        service: 'Google AI',
        sku: 'Gemini cached input',
        cost: '1.25',
      },
    ]))
    process.env['HASNA_ECONOMY_GEMINI_BILLING_EXPORT_PATH'] = exportPath

    const result = await syncGeminiBilling(db, { fromDate: '2026-05-01', toDate: '2026-05-09' })
    expect(result.days).toBe(2)
    expect(result.totalUsd).toBeCloseTo(13.59)

    const summary = queryBillingSummary(db, 'all')
    expect(summary.by_provider.gemini).toBeCloseTo(13.59)
  })

  it('returns an explicit skipped result when no Gemini export is configured', async () => {
    const result = await syncGeminiBilling(db)
    expect(result.days).toBe(0)
    expect(result.totalUsd).toBe(0)
    expect(result.skipped).toContain('HASNA_ECONOMY_GEMINI_BILLING_EXPORT_PATH')
    expect(result.skipped).toContain('HASNAXYZ_ECONOMY_GEMINI_BILLING_EXPORT_PATH')
    expect(result.skipped).toContain('GEMINI_BILLING_EXPORT_PATH')
  })

  it('supports the legacy HASNAXYZ Gemini billing export env alias', async () => {
    const exportPath = join(root, 'gemini-billing-legacy.jsonl')
    writeFileSync(exportPath, JSON.stringify({
      date: '2026-05-08',
      service: 'Google AI',
      sku: 'Gemini API',
      amount: 2.5,
    }))
    process.env['HASNAXYZ_ECONOMY_GEMINI_BILLING_EXPORT_PATH'] = exportPath

    const result = await syncGeminiBilling(db, { fromDate: '2026-05-01', toDate: '2026-05-09' })
    expect(result.days).toBe(1)
    expect(result.totalUsd).toBeCloseTo(2.5)
  })
})
