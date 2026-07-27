import { describe, it, expect } from 'bun:test'
import { translateSql, translateParams } from './dialect.js'

// These assertions pin the exact rewrites the self-hosted Postgres path has always
// performed. They are a regression harness for the translator, not a wish list:
// changing an expectation here changes what runs against production RDS.
describe('translateSql', () => {
  it('is a no-op for the sqlite dialect', () => {
    const sql = "SELECT * FROM requests WHERE agent LIKE ? AND ts > DATETIME('now', '-1 days')"
    expect(translateSql(sql, 'sqlite')).toBe(sql)
  })

  it('numbers positional placeholders left to right', () => {
    expect(translateSql('SELECT * FROM t WHERE a = ? AND b = ? AND c = ?', 'pg')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $3',
    )
  })

  it('maps datetime(now) and signed relative offsets to NOW()/INTERVAL', () => {
    expect(translateSql("SELECT datetime('now')", 'pg')).toBe('SELECT NOW()')
    expect(translateSql("SELECT datetime('now', '-30 minutes')", 'pg')).toBe("SELECT NOW() - INTERVAL '30 minutes'")
    expect(translateSql("SELECT datetime('now', '-1 hours')", 'pg')).toBe("SELECT NOW() - INTERVAL '1 hour'")
    expect(translateSql("SELECT datetime('now', '2 days')", 'pg')).toBe("SELECT NOW() + INTERVAL '2 days'")
  })

  it('translates the SQLite function idioms economy emits', () => {
    expect(translateSql('SELECT GROUP_CONCAT(name) FROM t', 'pg')).toBe('SELECT STRING_AGG(name) FROM t')
    expect(translateSql('SELECT IFNULL(cost, 0) FROM t', 'pg')).toBe('SELECT COALESCE(cost, 0) FROM t')
    expect(translateSql("SELECT json_extract(meta, '$.model') FROM t", 'pg')).toBe("SELECT meta->>'model' FROM t")
    expect(translateSql('SELECT lower(hex(randomblob(16)))', 'pg')).toBe('SELECT gen_random_uuid()::text')
  })

  it('makes LIKE case-insensitive without double-prefixing an existing ILIKE', () => {
    expect(translateSql("SELECT * FROM t WHERE a LIKE 'x%'", 'pg')).toBe("SELECT * FROM t WHERE a ILIKE 'x%'")
    expect(translateSql("SELECT * FROM t WHERE a ILIKE 'x%'", 'pg')).toBe("SELECT * FROM t WHERE a ILIKE 'x%'")
  })

  it('degrades INSERT OR REPLACE to a bare INSERT (no conflict clause is synthesised)', () => {
    // Callers that need re-runnable PG writes must emit their own ON CONFLICT —
    // see the bulk-ingest path in database.ts, which documents exactly this.
    expect(translateSql('INSERT OR REPLACE INTO requests (id, cost) VALUES (?, ?)', 'pg')).toBe(
      'INSERT INTO "requests" (id, cost) VALUES ($1, $2)',
    )
    expect(translateSql('INSERT OR REPLACE INTO requests VALUES (?)', 'pg')).toBe('INSERT INTO requests VALUES ($1)')
  })

  it('turns INSERT OR IGNORE into an ON CONFLICT DO NOTHING upsert', () => {
    expect(translateSql('INSERT OR IGNORE INTO pricing (model) VALUES (?)', 'pg')).toBe(
      'INSERT INTO pricing (model) VALUES ($1) ON CONFLICT DO NOTHING',
    )
    expect(translateSql('INSERT OR IGNORE INTO pricing (model) VALUES (?);', 'pg')).toBe(
      'INSERT INTO pricing (model) VALUES ($1) ON CONFLICT DO NOTHING',
    )
  })

  it('rewrites AUTOINCREMENT to an identity column', () => {
    expect(translateSql('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)', 'pg')).toBe(
      'CREATE TABLE t (id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY)',
    )
  })
})

describe('translateParams', () => {
  it('unwraps a single array argument into a flat param list', () => {
    expect(translateParams([['a', 'b']])).toEqual(['a', 'b'])
  })

  it('passes variadic params through unchanged', () => {
    expect(translateParams(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('maps undefined to null, which pg would otherwise reject', () => {
    expect(translateParams(['a', undefined, 0, null, false])).toEqual(['a', null, 0, null, false])
    expect(translateParams([[undefined, 'b']])).toEqual([null, 'b'])
  })
})
