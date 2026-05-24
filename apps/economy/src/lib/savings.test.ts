import { describe, expect, test } from 'bun:test'
import { openDatabase } from '../db/database.js'
import { computeSavedUsd, querySavingsSummary } from './savings.js'
import { AGENTS, isAgent } from './agents.js'

describe('agents registry', () => {
  test('includes all planned coding agents', () => {
    expect(AGENTS).toContain('opencode')
    expect(AGENTS).toContain('cursor')
    expect(AGENTS).toContain('hermes')
    expect(isAgent('claude')).toBe(true)
    expect(isAgent('unknown')).toBe(false)
  })
})

describe('savings math', () => {
  test('computeSavedUsd never returns negative savings', () => {
    expect(computeSavedUsd(10, 20, 5)).toBe(0)
    expect(computeSavedUsd(100, 20, 10)).toBe(70)
  })

  test('querySavingsSummary returns zeroes for empty db', () => {
    const db = openDatabase(':memory:', true)
    const summary = querySavingsSummary(db, 'month')
    expect(summary.api_equivalent_usd).toBe(0)
    expect(summary.saved_usd).toBe(0)
    db.close()
  })
})
