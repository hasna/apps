import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase, queryBillingSummary } from '../db/database.js'
import { syncGeminiBilling } from './billing.js'
import type { SqliteAdapter as Database } from '@hasna/cloud'

let root: string
let db: Database

beforeEach(() => {
  root = join(tmpdir(), `economy-billing-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(root, { recursive: true })
  db = openDatabase(':memory:', true)
})

afterEach(() => {
  delete process.env['HASNA_ECONOMY_GEMINI_BILLING_EXPORT_PATH']
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
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
    expect(result.skipped).toContain('Gemini billing export path')
  })
})
