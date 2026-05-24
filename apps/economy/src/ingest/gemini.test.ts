import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase } from '../db/database.js'
import { ingestGemini } from './gemini.js'
import type { SqliteAdapter as Database } from '@hasna/cloud'

let root: string
let tmpDir: string
let historyDir: string
let db: Database

beforeEach(() => {
  root = join(tmpdir(), `economy-gemini-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  tmpDir = join(root, 'gemini-tmp')
  historyDir = join(root, 'gemini-history')
  db = openDatabase(':memory:', true)
  process.env['HASNA_ECONOMY_GEMINI_TMP_DIR'] = tmpDir
  process.env['HASNA_ECONOMY_GEMINI_HISTORY_DIR'] = historyDir
})

afterEach(() => {
  delete process.env['HASNA_ECONOMY_GEMINI_TMP_DIR']
  delete process.env['HASNA_ECONOMY_GEMINI_HISTORY_DIR']
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('ingestGemini', () => {
  it('returns zero counts and logs when configured Gemini dirs are missing in verbose mode', async () => {
    const logs: unknown[][] = []
    const originalLog = console.log
    console.log = (...args: unknown[]) => { logs.push(args) }
    try {
      const result = await ingestGemini(db, true)
      expect(result).toEqual({ sessions: 0, requests: 0 })
      expect(logs[0]).toEqual(['Gemini tmp/history dirs not found:', tmpDir, historyDir])
    } finally {
      console.log = originalLog
    }
  })

  it('ingests Gemini chat usage as request rows and rolls sessions up', async () => {
    const projectDir = join(tmpDir, 'open-economy')
    const chatsDir = join(projectDir, 'chats')
    mkdirSync(chatsDir, { recursive: true })
    writeFileSync(join(projectDir, '.project_root'), '/tmp/open-economy\n')
    writeFileSync(join(chatsDir, 'session-a.json'), JSON.stringify({
      sessionId: 'gemini-session-a',
      startTime: '2026-05-08T12:00:00.000Z',
      lastUpdated: '2026-05-08T12:05:00.000Z',
      messages: [
        {
          id: 'msg-1',
          timestamp: '2026-05-08T12:01:00.000Z',
          model: 'models/gemini-2.5-flash',
          usage: {
            inputTokens: 1000,
            cachedInputTokens: 100,
            outputTokens: 200,
            totalTokens: 1200,
          },
        },
        {
          id: 'msg-2',
          timestamp: '2026-05-08T12:02:00.000Z',
          model: 'gemini-3.1-pro-preview',
          costUsd: 0.123,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
          },
        },
      ],
    }))

    const result = await ingestGemini(db)
    expect(result).toEqual({ sessions: 1, requests: 2 })

    const computed = db.prepare(`SELECT * FROM requests WHERE source_request_id = ?`).get('msg-1') as Record<string, number | string>
    expect(computed['model']).toBe('models/gemini-2.5-flash')
    expect(computed['input_tokens']).toBe(900)
    expect(computed['cache_read_tokens']).toBe(100)
    expect(computed['output_tokens']).toBe(200)
    expect(Number(computed['cost_usd'])).toBeCloseTo(0.000773)

    const exact = db.prepare(`SELECT cost_usd FROM requests WHERE source_request_id = ?`).get('msg-2') as { cost_usd: number }
    expect(exact.cost_usd).toBeCloseTo(0.123)

    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get('gemini-session-a') as Record<string, number | string>
    expect(session['project_path']).toBe('/tmp/open-economy')
    expect(session['request_count']).toBe(2)
    expect(session['total_tokens']).toBe(1350)
    expect(Number(session['total_cost_usd'])).toBeCloseTo(0.123773)
  })

  it('reads history usageMetadata with tool and thinking token fields', async () => {
    const projectDir = join(historyDir, 'open-economy')
    const chatsDir = join(projectDir, 'chats')
    mkdirSync(chatsDir, { recursive: true })
    writeFileSync(join(projectDir, '.project_root'), '/tmp/open-economy\n')
    writeFileSync(join(chatsDir, 'session-b.json'), JSON.stringify({
      sessionId: 'gemini-session-b',
      model: 'gemini-2.5-pro',
      startTime: '2026-05-08T12:00:00.000Z',
      messages: [
        {
          id: 'msg-usage-metadata',
          timestamp: '2026-05-08T12:01:00.000Z',
          response: {
            usageMetadata: {
              promptTokenCount: 220000,
              cachedContentTokenCount: 50000,
              candidatesTokenCount: 10000,
              thoughtsTokenCount: 5000,
              toolUsePromptTokenCount: 1000,
              totalTokenCount: 236000,
            },
          },
        },
      ],
    }))

    const result = await ingestGemini(db)
    expect(result).toEqual({ sessions: 1, requests: 1 })

    const row = db.prepare(`SELECT * FROM requests WHERE source_request_id = ?`).get('msg-usage-metadata') as Record<string, number | string>
    expect(row['input_tokens']).toBe(171000)
    expect(row['cache_read_tokens']).toBe(50000)
    expect(row['output_tokens']).toBe(15000)
    expect(Number(row['cost_usd'])).toBeCloseTo(0.665)
  })

  it('continues when .project_root cannot be read', async () => {
    const projectDir = join(tmpDir, 'unreadable-root')
    const chatsDir = join(projectDir, 'chats')
    mkdirSync(chatsDir, { recursive: true })
    mkdirSync(join(projectDir, '.project_root'))
    writeFileSync(join(chatsDir, 'session-c.json'), JSON.stringify({
      sessionId: 'gemini-session-c',
      model: 'gemini-2.5-flash-lite',
      startTime: '2026-05-08T13:00:00.000Z',
      messages: [{
        id: 'msg-no-project-root',
        timestamp: '2026-05-08T13:01:00.000Z',
        usage: {
          inputTokens: 1000,
          outputTokens: 100,
          totalTokens: 1100,
        },
      }],
    }))

    const result = await ingestGemini(db)
    expect(result).toEqual({ sessions: 1, requests: 1 })

    const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get('gemini-session-c') as Record<string, string | number>
    expect(session['project_path']).toBe('')
    expect(session['project_name']).toBe('')
  })
})
