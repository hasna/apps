import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Database as BunDatabase } from 'bun:sqlite'
import { openDatabase } from '../db/database.js'
import { ingestCodex, readCodexModel } from './codex.js'
import { computeCost } from '../lib/pricing.js'
import type { Database } from '../db/database.js'

let root: string
let codexDbPath: string
let configPath: string
let rolloutPath: string
let db: Database

beforeEach(() => {
  root = join(tmpdir(), `economy-codex-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(root, { recursive: true })
  codexDbPath = join(root, 'state_5.sqlite')
  configPath = join(root, 'config.toml')
  rolloutPath = join(root, 'rollout.jsonl')
  db = openDatabase(':memory:', true)
  process.env['HASNA_ECONOMY_CODEX_DB_PATH'] = codexDbPath
  process.env['HASNA_ECONOMY_CODEX_CONFIG_PATH'] = configPath
})

afterEach(() => {
  delete process.env['HASNA_ECONOMY_CODEX_DB_PATH']
  delete process.env['HASNA_ECONOMY_CODEX_CONFIG_PATH']
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

function writeCodexDb(tokensUsed = 1200, updatedAt = 2) {
  const codexDb = new BunDatabase(codexDbPath)
  codexDb.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      cwd TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      title TEXT,
      model_provider TEXT,
      model TEXT
    )
  `)
  codexDb.prepare(`
    INSERT INTO threads
      (id, rollout_path, cwd, created_at, updated_at, tokens_used, title, model_provider, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('thread-1', rolloutPath, '/tmp/codex-project', 1, updatedAt, tokensUsed, 'Test thread', 'openai', 'gpt-5.5')
  codexDb.close()
}

function writeLegacyCodexDb(tokensUsed = 1000) {
  const codexDb = new BunDatabase(codexDbPath)
  codexDb.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      title TEXT
    )
  `)
  codexDb.prepare(`
    INSERT INTO threads
      (id, cwd, created_at, updated_at, tokens_used, title)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('legacy-thread', '/tmp/legacy-project', 1, 2, tokensUsed, 'Legacy thread')
  codexDb.close()
}

function writeRollout(...usages: Array<Record<string, number> & { timestamp?: string }>) {
  writeFileSync(rolloutPath, usages.map((usage, index) => JSON.stringify({
    timestamp: usage.timestamp ?? `2026-05-08T10:00:0${index}.000Z`,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { last_token_usage: Object.fromEntries(Object.entries(usage).filter(([key]) => key !== 'timestamp')) },
    },
  })).join('\n') + '\n')
}

function writeRolloutEntries(entries: unknown[]) {
  writeFileSync(rolloutPath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
}

describe('ingestCodex', () => {
  it('computes current GPT-5 Codex cost from official text-token rates', () => {
    expect(computeCost('gpt-5-codex', 1_000_000, 1_000_000, 1_000_000)).toBeCloseTo(11.375)
  })

  it('returns zero counts when the Codex SQLite database is missing', async () => {
    const result = await ingestCodex(db)
    expect(result).toEqual({ sessions: 0, requests: 0 })
  })

  it('returns zero counts when the Codex SQLite path cannot be opened', async () => {
    mkdirSync(codexDbPath)

    const result = await ingestCodex(db, true)

    expect(result).toEqual({ sessions: 0, requests: 0 })
  })

  it('reads the configured Codex model and falls back when config is absent', () => {
    expect(readCodexModel()).toBe('gpt-5-codex')

    writeFileSync(configPath, 'model = "gpt-5.4"\n')
    expect(readCodexModel()).toBe('gpt-5.4')

    rmSync(configPath)
    mkdirSync(configPath)
    expect(readCodexModel()).toBe('gpt-5-codex')
  })

  it('ingests model identity and aggregate token usage from Codex rollout token events', async () => {
    writeCodexDb()
    writeRollout({
      input_tokens: 1000,
      cached_input_tokens: 400,
      output_tokens: 200,
      reasoning_output_tokens: 50,
      total_tokens: 1200,
    })

    const result = await ingestCodex(db)
    expect(result).toEqual({ sessions: 1, requests: 1 })

    const row = db.prepare(`SELECT * FROM requests WHERE agent = 'codex'`).get() as Record<string, number | string>
    expect(row['model']).toBe('gpt-5.5')
    expect(row['input_tokens']).toBe(600)
    expect(row['cache_read_tokens']).toBe(400)
    expect(row['output_tokens']).toBe(200)
    expect(row['timestamp']).toBe('2026-05-08T10:00:00.000Z')
    expect(Number(row['cost_usd'])).toBeCloseTo(0.0092)

    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get('codex-thread-1') as Record<string, number | string>
    expect(session['request_count']).toBe(1)
    expect(session['total_tokens']).toBe(1200)
    expect(Number(session['total_cost_usd'])).toBeCloseTo(0.0092)
  })

  it('uses final Codex total_token_usage snapshots as one aggregate request', async () => {
    writeCodexDb(1700)
    writeRolloutEntries([
      {
        timestamp: '2026-05-08T10:00:00.000Z',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: { input_tokens: 1000, cached_input_tokens: 100, output_tokens: 100, total_tokens: 1100 },
            total_token_usage: { input_tokens: 1000, cached_input_tokens: 100, output_tokens: 100, total_tokens: 1100 },
          },
        },
      },
      {
        timestamp: '2026-05-08T10:00:01.000Z',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: { input_tokens: 500, cached_input_tokens: 200, output_tokens: 100, total_tokens: 600 },
            total_token_usage: { input_tokens: 1500, cached_input_tokens: 300, output_tokens: 200, total_tokens: 1700 },
          },
        },
      },
    ])

    const result = await ingestCodex(db)
    expect(result).toEqual({ sessions: 1, requests: 1 })

    const row = db.prepare(`SELECT * FROM requests WHERE agent = 'codex'`).get() as Record<string, number | string>
    expect(row['input_tokens']).toBe(1200)
    expect(row['cache_read_tokens']).toBe(300)
    expect(row['output_tokens']).toBe(200)
    expect(row['timestamp']).toBe('2026-05-08T10:00:01.000Z')

    const session = db.prepare(`SELECT total_tokens FROM sessions WHERE id = ?`).get('codex-thread-1') as { total_tokens: number }
    expect(session.total_tokens).toBe(1700)
  })

  it('supports legacy thread schemas and falls back to aggregate token estimates', async () => {
    writeFileSync(configPath, 'model = "gpt-5.4"\n')
    writeLegacyCodexDb(1000)

    const result = await ingestCodex(db)
    expect(result).toEqual({ sessions: 1, requests: 1 })

    const row = db.prepare(`SELECT * FROM requests WHERE agent = 'codex'`).get() as Record<string, number | string>
    expect(row['model']).toBe('gpt-5.4')
    expect(row['input_tokens']).toBe(600)
    expect(row['output_tokens']).toBe(400)
    expect(row['cache_read_tokens']).toBe(0)
    expect(row['timestamp']).toBe('1970-01-01T00:00:01.000Z')

    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get('codex-legacy-thread') as Record<string, number | string>
    expect(session['project_name']).toBe('legacy-project')
    expect(session['request_count']).toBe(1)
    expect(session['total_tokens']).toBe(1000)
  })

  it('reprocesses active Codex threads when updated_at or tokens change', async () => {
    writeCodexDb(1200, 2)
    writeRollout({
      input_tokens: 1000,
      cached_input_tokens: 400,
      output_tokens: 200,
      total_tokens: 1200,
    })
    await ingestCodex(db)

    const codexDb = new BunDatabase(codexDbPath)
    codexDb.prepare(`UPDATE threads SET tokens_used = ?, updated_at = ? WHERE id = ?`).run(1500, 3, 'thread-1')
    codexDb.close()
    writeRollout(
      { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 200, total_tokens: 1200 },
      { input_tokens: 300, cached_input_tokens: 0, output_tokens: 100, total_tokens: 400 },
    )

    const result = await ingestCodex(db)
    expect(result).toEqual({ sessions: 1, requests: 1 })
    const count = db.prepare(`SELECT COUNT(*) as n FROM requests WHERE session_id = ?`).get('codex-thread-1') as { n: number }
    expect(count.n).toBe(1)
    const session = db.prepare(`SELECT total_tokens FROM sessions WHERE id = ?`).get('codex-thread-1') as { total_tokens: number }
    expect(session.total_tokens).toBe(1600)
  })

  it('dedupes repeated rollout usage payloads and removes stale aggregate request rows on reprocess', async () => {
    writeCodexDb(2400, 2)
    writeRollout(
      { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 200, total_tokens: 1200 },
      { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 200, total_tokens: 1200, timestamp: '2026-05-08T10:01:00.000Z' },
      { input_tokens: 900, cached_input_tokens: 100, output_tokens: 300, total_tokens: 1200 },
    )
    await ingestCodex(db)
    let count = db.prepare(`SELECT COUNT(*) as n FROM requests WHERE session_id = ?`).get('codex-thread-1') as { n: number }
    expect(count.n).toBe(1)
    let session = db.prepare(`SELECT total_tokens FROM sessions WHERE id = ?`).get('codex-thread-1') as { total_tokens: number }
    expect(session.total_tokens).toBe(2400)

    const codexDb = new BunDatabase(codexDbPath)
    codexDb.prepare(`UPDATE threads SET tokens_used = ?, updated_at = ? WHERE id = ?`).run(1200, 3, 'thread-1')
    codexDb.close()
    writeRollout(
      { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 200, total_tokens: 1200 },
      { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 200, total_tokens: 1200, timestamp: '2026-05-08T10:01:00.000Z' },
    )

    const result = await ingestCodex(db)
    expect(result).toEqual({ sessions: 1, requests: 1 })
    count = db.prepare(`SELECT COUNT(*) as n FROM requests WHERE session_id = ?`).get('codex-thread-1') as { n: number }
    expect(count.n).toBe(1)
    session = db.prepare(`SELECT total_tokens FROM sessions WHERE id = ?`).get('codex-thread-1') as { total_tokens: number }
    expect(session.total_tokens).toBe(1200)
  })
})
