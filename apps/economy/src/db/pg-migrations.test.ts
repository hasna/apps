import { describe, expect, it } from 'bun:test'
import { PG_MIGRATIONS } from './pg-migrations.js'

function indexOfSql(fragment: string): number {
  return PG_MIGRATIONS.findIndex(sql => sql.includes(fragment))
}

describe('PG_MIGRATIONS', () => {
  it('adds cost center columns before creating dependent indexes', () => {
    expect(indexOfSql('ALTER TABLE requests ADD COLUMN IF NOT EXISTS cost_center_id')).toBeLessThan(indexOfSql('idx_requests_cost_center'))
    expect(indexOfSql('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cost_center_id')).toBeLessThan(indexOfSql('idx_sessions_cost_center'))
    expect(indexOfSql('ALTER TABLE budgets ADD COLUMN IF NOT EXISTS cost_center_id')).toBeLessThan(indexOfSql('idx_budgets_cost_center'))
  })

  it('creates loop attribution table before dependent indexes', () => {
    expect(indexOfSql('CREATE TABLE IF NOT EXISTS loop_attributions')).toBeLessThan(indexOfSql('idx_loop_attr_loop'))
    expect(indexOfSql('CREATE TABLE IF NOT EXISTS loop_attributions')).toBeLessThan(indexOfSql('idx_loop_attr_provider'))
  })
})
