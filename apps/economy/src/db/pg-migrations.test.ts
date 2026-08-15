import { describe, expect, it } from 'bun:test'
import { PG_MIGRATIONS } from './pg-migrations.js'
import { translateSql } from './dialect.js'

function indexOfSql(fragment: string): number {
  return PG_MIGRATIONS.findIndex(sql => sql.includes(fragment))
}

describe('PG_MIGRATIONS', () => {
  it('adds cost center columns before creating dependent indexes', () => {
    expect(indexOfSql('ALTER TABLE requests ADD COLUMN IF NOT EXISTS cost_center_id')).toBeLessThan(indexOfSql('idx_requests_cost_center'))
    expect(indexOfSql('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cost_center_id')).toBeLessThan(indexOfSql('idx_sessions_cost_center'))
    expect(indexOfSql('ALTER TABLE budgets ADD COLUMN IF NOT EXISTS cost_center_id')).toBeLessThan(indexOfSql('idx_budgets_cost_center'))
  })

  // `applyPgMigrations` runs these statements verbatim. The previous runner piped
  // them through the SQLite->PG translator first; this asserts that was a no-op,
  // so the schema applied to an existing database is byte-identical. A future
  // migration that trips this must be written as PG the translator won't touch.
  it('is already Postgres DDL — the SQLite->PG translator would not rewrite it', () => {
    for (const [index, sql] of PG_MIGRATIONS.entries()) {
      expect(translateSql(sql, 'pg'), `PG_MIGRATIONS[${index}] is not translator-neutral`).toBe(sql)
    }
  })
})
