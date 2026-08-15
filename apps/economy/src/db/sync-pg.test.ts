import { describe, it, expect } from 'bun:test'
import { translateSqliteDates, isTransientConnError } from './sync-pg.js'

describe('isTransientConnError', () => {
  it('matches dead-connection blips that are safe to retry (case-insensitive)', () => {
    for (const m of [
      'Connection terminated unexpectedly',
      'timeout exceeded when trying to connect',
      'read ECONNRESET',
      'connect ECONNREFUSED 10.0.0.1:5432',
      'terminating connection due to administrator command',
      'server closed the connection unexpectedly',
    ]) {
      expect(isTransientConnError(m)).toBe(true)
    }
  })

  it('does NOT retry genuine query errors', () => {
    for (const m of [
      'syntax error at or near "SELCT"',
      'relation "requests" does not exist',
      'duplicate key value violates unique constraint',
      'null value in column "id" violates not-null constraint',
    ]) {
      expect(isTransientConnError(m)).toBe(false)
    }
  })
})

describe('translateSqliteDates', () => {
  it("maps DATE('now') variants to ISO-text boundaries (text-comparable)", () => {
    expect(translateSqliteDates("DATE('now')")).toBe("to_char(now(), 'YYYY-MM-DD')")
    expect(translateSqliteDates("DATE('now', 'start of month')")).toBe("to_char(date_trunc('month', now()), 'YYYY-MM-DD')")
    expect(translateSqliteDates("DATE('now', 'start of year')")).toBe("to_char(date_trunc('year', now()), 'YYYY-MM-DD')")
    expect(translateSqliteDates("DATE('now', '-1 day')")).toBe("to_char(now() + interval '-1 days', 'YYYY-MM-DD')")
    expect(translateSqliteDates("DATE('now', '-30 days')")).toBe("to_char(now() + interval '-30 days', 'YYYY-MM-DD')")
  })

  it('maps the Sunday-based week start', () => {
    expect(translateSqliteDates("DATE('now', 'weekday 0', '-7 days')")).toBe(
      "to_char((date_trunc('week', now() + interval '1 day') - interval '1 day'), 'YYYY-MM-DD')",
    )
  })

  it('maps parameterized day offset (after $-placeholder rewrite)', () => {
    expect(translateSqliteDates("DATE('now', $1 || ' days')")).toBe("to_char(now() + (($1) || ' days')::interval, 'YYYY-MM-DD')")
  })

  it('maps DATETIME comparisons to timestamptz', () => {
    expect(translateSqliteDates("DATETIME('now', $1)")).toBe('(now() + ($1)::interval)')
    expect(translateSqliteDates('DATETIME(timestamp)')).toBe('CAST("timestamp" AS timestamptz)')
  })

  it('maps DATE(col) to the first 10 ISO chars and quotes keyword columns', () => {
    expect(translateSqliteDates('DATE(timestamp)')).toBe('substr("timestamp", 1, 10)')
    expect(translateSqliteDates('DATE(started_at)')).toBe('substr("started_at", 1, 10)')
    expect(translateSqliteDates('DATE(date)')).toBe('substr("date", 1, 10)')
  })

  it('maps STRFTIME hour extraction', () => {
    expect(translateSqliteDates("STRFTIME('%H', timestamp)")).toBe(`to_char(CAST("timestamp" AS timestamptz), 'HH24')`)
  })

  it('translates a realistic period predicate end to end', () => {
    const sql = "SELECT DATE(timestamp) as d FROM requests WHERE DATE(timestamp) = DATE('now') AND timestamp >= DATE('now', 'start of month')"
    const out = translateSqliteDates(sql)
    expect(out).not.toContain("DATE('now'")
    expect(out).not.toMatch(/\bDATE\(timestamp\)/)
    expect(out).toContain('substr("timestamp", 1, 10)')
    expect(out).toContain("to_char(date_trunc('month', now()), 'YYYY-MM-DD')")
  })

  it('leaves non-date SQL untouched', () => {
    const sql = 'SELECT id, cost_usd FROM budgets WHERE id = $1'
    expect(translateSqliteDates(sql)).toBe(sql)
  })
})
