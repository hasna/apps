import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase } from '../db/database.js'
import { ingestClaude } from './claude.js'
import type { SqliteAdapter as Database } from '@hasna/cloud'

let db: Database
let root: string
let projectsDir: string

function jsonl(...rows: unknown[]): string {
  return rows.map(r => JSON.stringify(r)).join('\n') + '\n'
}

beforeEach(() => {
  root = join(tmpdir(), `economy-claude-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  projectsDir = join(root, 'projects')
  mkdirSync(projectsDir, { recursive: true })
  db = openDatabase(':memory:', true)
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('ingestClaude', () => {
  it('ingests real Claude JSONL usage with cache tiers, raw request ids, and rollups', async () => {
    const projectDir = join(projectsDir, '-tmp-economy-claude-project')
    mkdirSync(projectDir, { recursive: true })
    const sessionId = '11111111-1111-4111-8111-111111111111'
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), jsonl(
      {
        type: 'user',
        uuid: 'user-1',
        cwd: '/tmp/economy-claude-project',
        sessionId,
        timestamp: '2026-05-08T10:00:00.000Z',
        message: { role: 'user', content: 'hi' },
      },
      {
        type: 'assistant',
        uuid: 'assistant-1',
        requestId: 'req-cache-tiered',
        cwd: '/tmp/economy-claude-project',
        sessionId,
        timestamp: '2026-05-08T10:00:01.000Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6-20251101',
          usage: {
            input_tokens: 1000,
            output_tokens: 100,
            cache_read_input_tokens: 500,
            cache_creation: {
              ephemeral_5m_input_tokens: 200,
              ephemeral_1h_input_tokens: 300,
            },
          },
        },
      },
      {
        type: 'assistant',
        uuid: 'assistant-2',
        requestId: 'req-cache-read-only',
        cwd: '/tmp/economy-claude-project',
        sessionId,
        timestamp: '2026-05-08T10:00:02.000Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          usage: {
            cache_read_input_tokens: 1000,
          },
        },
      },
    ))

    const result = await ingestClaude(db, false, projectsDir)
    expect(result).toEqual({ files: 1, requests: 2, sessions: 1 })

    const tiered = db.prepare(`SELECT * FROM requests WHERE source_request_id = ?`).get('req-cache-tiered') as Record<string, number | string>
    expect(tiered['input_tokens']).toBe(1000)
    expect(tiered['output_tokens']).toBe(100)
    expect(tiered['cache_read_tokens']).toBe(500)
    expect(tiered['cache_create_tokens']).toBe(500)
    expect(tiered['cache_create_5m_tokens']).toBe(200)
    expect(tiered['cache_create_1h_tokens']).toBe(300)
    expect(Number(tiered['cost_usd'])).toBeCloseTo(0.0072)

    const readOnly = db.prepare(`SELECT * FROM requests WHERE source_request_id = ?`).get('req-cache-read-only') as Record<string, number | string>
    expect(readOnly).toBeTruthy()
    expect(Number(readOnly['cost_usd'])).toBeCloseTo(0.0003)

    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as Record<string, number | string>
    expect(session['request_count']).toBe(2)
    expect(session['total_tokens']).toBe(3100)
    expect(Number(session['total_cost_usd'])).toBeCloseTo(0.0075)
  })

  it('applies Claude fast mode, data residency, and web-search tool pricing modifiers', async () => {
    const projectDir = join(projectsDir, '-tmp-economy-claude-project')
    mkdirSync(projectDir, { recursive: true })
    const sessionId = '22222222-2222-4222-8222-222222222222'
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), jsonl({
      type: 'assistant',
      uuid: 'assistant-fast',
      requestId: 'req-fast-us-search',
      cwd: '/tmp/economy-claude-project',
      sessionId,
      timestamp: '2026-05-08T11:00:00.000Z',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-6',
        usage: {
          input_tokens: 1000,
          output_tokens: 1000,
          speed: 'fast',
          inference_geo: 'us',
          server_tool_use: { web_search_requests: 1 },
        },
      },
    }))

    await ingestClaude(db, false, projectsDir)

    const row = db.prepare(`SELECT cost_usd FROM requests WHERE source_request_id = ?`).get('req-fast-us-search') as { cost_usd: number }
    expect(row.cost_usd).toBeCloseTo(0.208)
  })

  it('only applies Claude data residency pricing to supported model generations', async () => {
    const projectDir = join(projectsDir, '-tmp-economy-claude-project')
    mkdirSync(projectDir, { recursive: true })
    const sessionId = '33333333-3333-4333-8333-333333333333'
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), jsonl(
      {
        type: 'assistant',
        uuid: 'assistant-supported-residency',
        requestId: 'req-supported-residency',
        cwd: '/tmp/economy-claude-project',
        sessionId,
        timestamp: '2026-05-08T12:00:00.000Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6-20260217',
          usage: {
            input_tokens: 1000,
            output_tokens: 1000,
            inference_geo: 'us-only',
          },
        },
      },
      {
        type: 'assistant',
        uuid: 'assistant-legacy-residency',
        requestId: 'req-legacy-residency',
        cwd: '/tmp/economy-claude-project',
        sessionId,
        timestamp: '2026-05-08T12:00:01.000Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4',
          usage: {
            input_tokens: 1000,
            output_tokens: 1000,
            inference_geo: 'us',
          },
        },
      },
    ))

    await ingestClaude(db, false, projectsDir)

    const supported = db.prepare(`SELECT cost_usd FROM requests WHERE source_request_id = ?`).get('req-supported-residency') as { cost_usd: number }
    const legacy = db.prepare(`SELECT cost_usd FROM requests WHERE source_request_id = ?`).get('req-legacy-residency') as { cost_usd: number }
    expect(supported.cost_usd).toBeCloseTo(0.0198)
    expect(legacy.cost_usd).toBeCloseTo(0.018)
  })
})
