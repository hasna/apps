import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SqliteAdapter } from './sqlite-adapter.js'

// Each case gets its own directory; WAL mode writes sidecar -wal/-shm files, so a
// bare unlink of the .db would leave them behind.
const dirs: string[] = []
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'economy-sqlite-adapter-'))
  dirs.push(dir)
  return join(dir, 'test.db')
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('SqliteAdapter', () => {
  it('enables WAL journalling and foreign-key enforcement on the connection', () => {
    const db = new SqliteAdapter(tempDbPath())
    try {
      expect(String(db.get('PRAGMA journal_mode')['journal_mode']).toLowerCase()).toBe('wal')
      // SQLite defaults foreign_keys to OFF per connection. If this regresses,
      // every ON DELETE CASCADE below silently degrades to a no-op.
      expect(db.get('PRAGMA foreign_keys')['foreign_keys']).toBe(1)
    } finally {
      db.close()
    }
  })

  it('cascades deletes to child rows (proves foreign_keys=ON is in force)', () => {
    const db = new SqliteAdapter(tempDbPath())
    try {
      db.exec('CREATE TABLE parent (id TEXT PRIMARY KEY)')
      db.exec('CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id) ON DELETE CASCADE)')
      db.run('INSERT INTO parent (id) VALUES (?)', 'p1')
      db.run('INSERT INTO child (id, parent_id) VALUES (?, ?)', 'c1', 'p1')
      expect(db.all('SELECT id FROM child')).toHaveLength(1)

      db.run('DELETE FROM parent WHERE id = ?', 'p1')
      expect(db.all('SELECT id FROM child')).toHaveLength(0)
    } finally {
      db.close()
    }
  })

  it('rejects a child row whose parent does not exist', () => {
    const db = new SqliteAdapter(tempDbPath())
    try {
      db.exec('CREATE TABLE parent (id TEXT PRIMARY KEY)')
      db.exec('CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id) ON DELETE CASCADE)')
      expect(() => db.run('INSERT INTO child (id, parent_id) VALUES (?, ?)', 'orphan', 'nope')).toThrow()
    } finally {
      db.close()
    }
  })

  it('reports changes and lastInsertRowid from run(), and supports prepare/get/all', () => {
    const db = new SqliteAdapter(tempDbPath())
    try {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)')
      const inserted = db.run('INSERT INTO t (name) VALUES (?)', 'a')
      expect(inserted.changes).toBe(1)
      expect(Number(inserted.lastInsertRowid)).toBe(1)

      const stmt = db.prepare('INSERT INTO t (name) VALUES (?)')
      stmt.run('b')
      stmt.run('c')
      stmt.finalize()

      expect(db.all('SELECT name FROM t ORDER BY id')).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
      expect(db.get('SELECT name FROM t WHERE name = ?', 'b')).toEqual({ name: 'b' })
      expect(db.run('DELETE FROM t').changes).toBe(3)
    } finally {
      db.close()
    }
  })

  it('rolls a transaction back when the callback throws', () => {
    const db = new SqliteAdapter(tempDbPath())
    try {
      db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)')
      expect(() =>
        db.transaction(() => {
          db.run('INSERT INTO t (id) VALUES (?)', 'x')
          throw new Error('boom')
        }),
      ).toThrow('boom')
      expect(db.all('SELECT id FROM t')).toHaveLength(0)

      const committed = db.transaction(() => {
        db.run('INSERT INTO t (id) VALUES (?)', 'y')
        return 'ok'
      })
      expect(committed).toBe('ok')
      expect(db.all('SELECT id FROM t')).toEqual([{ id: 'y' }])
    } finally {
      db.close()
    }
  })

  it('creates the database file on demand and exposes the raw bun:sqlite handle', () => {
    const db = new SqliteAdapter(tempDbPath())
    try {
      expect(db.raw).toBeDefined()
      expect(db.query('SELECT 1 AS one').get()).toEqual({ one: 1 })
    } finally {
      db.close()
    }
  })
})
