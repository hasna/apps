import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDatabase } from '../db/database.js'
import { createHandler } from '../server/serve.js'
import { resolveEconomyCloudStorage } from './cloud-storage.js'
import type { ActiveEconomyCloudStorage } from './cloud-storage.js'
import type { SqliteAdapter as Database } from '../db/sqlite-adapter.js'
import { syncAllToCloud, billingSyncToCloud, getIngestCachePath } from './cloud-ingest.js'

/** Recursively list every *.db / *.sqlite / *.sqlite3 file under a root. */
function sqliteFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full))
    else if (/\.(?:db|sqlite3?)$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * Regression guard for the port lane: provider/billing ingest must work on the
 * hosted backend, not only the local SQLite. Pre-port, the CLI sync / billing
 * sync commands and the MCP sync tool refused in cloud-client mode
 * ("cloud mode: ingest is a local-only operation"). These tests exercise the
 * real hosted path: on-box provider files are read by the client, pushed to
 * the shared API's /v1/ingest endpoint, and land in the server-side database.
 */

const CLOUD_ENV = {
  HASNA_ECONOMY_API_URL: 'http://localhost:3456',
  HASNA_ECONOMY_API_KEY: 'test-key',
}

const SESSION_ID = '11111111-1111-4111-8111-111111111111'

function jsonl(...rows: unknown[]): string {
  return rows.map(r => JSON.stringify(r)).join('\n') + '\n'
}

function writeClaudeFixture(projectsDir: string): void {
  const projectDir = join(projectsDir, '-tmp-economy-claude-project')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, `${SESSION_ID}.jsonl`), jsonl(
    {
      type: 'user',
      uuid: 'user-1',
      cwd: '/tmp/economy-claude-project',
      sessionId: SESSION_ID,
      timestamp: '2026-05-08T10:00:00.000Z',
      message: { role: 'user', content: 'hi' },
    },
    {
      type: 'assistant',
      uuid: 'assistant-1',
      requestId: 'req-cache-tiered',
      cwd: '/tmp/economy-claude-project',
      sessionId: SESSION_ID,
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
      sessionId: SESSION_ID,
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
}

describe('cloud-client provider ingest (cloud-ingest port)', () => {
  let serverDb: Database
  let handler: (req: Request) => Promise<Response>
  let cloud: ActiveEconomyCloudStorage
  let root: string
  let cachePath: string
  const originalFetch = globalThis.fetch

  function withProviderFetchStub<T>(stub: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, fn: () => Promise<T>): Promise<T> {
    globalThis.fetch = stub as typeof fetch
    return fn().finally(() => {
      globalThis.fetch = originalFetch
    })
  }

  beforeEach(() => {
    serverDb = openDatabase(':memory:', true)
    handler = createHandler(serverDb)
    cloud = resolveEconomyCloudStorage(CLOUD_ENV, {
      fetchImpl: (input, init) => handler(new Request(String(input), init)),
    })
    root = mkdtempSync(join(tmpdir(), 'economy-cloud-ingest-'))
    cachePath = join(root, 'ingest-cache.json')
    // Short-circuit account resolution so ingest never calls the accounts API
    // (the same per-agent override production machines configure).
    process.env['ECONOMY_CLAUDE_ACCOUNT_KEY'] = 'claude:work'
  })

  afterEach(() => {
    delete process.env['ECONOMY_CLAUDE_ACCOUNT_KEY']
    rmSync(root, { recursive: true, force: true })
  })

  it('pushes on-box provider files into the hosted API (no local-only refusal)', async () => {
    const projectsDir = join(root, 'projects')
    mkdirSync(projectsDir, { recursive: true })
    writeClaudeFixture(projectsDir)

    const result = await withProviderFetchStub(
      async () => { throw new Error('unexpected provider fetch during ingest') },
      () => syncAllToCloud(cloud, { claude: true, projectsDir, cachePath }),
    )

    expect(result.posted).toBe(true)
    expect(result.ingested?.['requests']).toBe(2)
    expect(result.ingested?.['sessions']).toBe(1)

    // The rows landed in the SERVER-side database — the hosted backend.
    const reqs = serverDb.prepare(`SELECT * FROM requests ORDER BY timestamp`).all() as Array<Record<string, unknown>>
    expect(reqs).toHaveLength(2)
    expect(reqs[0]!['agent']).toBe('claude')
    expect(reqs[0]!['session_id']).toBe(SESSION_ID)
    expect(reqs[0]!['machine_id']).toBeTruthy()
    const sess = serverDb.prepare(`SELECT * FROM sessions WHERE id = ?`).get(SESSION_ID) as Record<string, unknown> | null
    expect(sess).toBeTruthy()
    expect(sess!['agent']).toBe('claude')
    expect(Number(sess!['request_count'])).toBe(2)
  })

  it('posts nothing on a second run over unchanged files (mtime cache idempotency)', async () => {
    const projectsDir = join(root, 'projects')
    mkdirSync(projectsDir, { recursive: true })
    writeClaudeFixture(projectsDir)

    const first = await withProviderFetchStub(
      async () => { throw new Error('unexpected provider fetch during ingest') },
      () => syncAllToCloud(cloud, { claude: true, projectsDir, cachePath }),
    )
    expect(first.posted).toBe(true)

    const second = await withProviderFetchStub(
      async () => { throw new Error('unexpected provider fetch during ingest') },
      () => syncAllToCloud(cloud, { claude: true, projectsDir, cachePath }),
    )
    expect(second.posted).toBe(false)

    const count = serverDb.prepare(`SELECT COUNT(*) AS n FROM requests`).get() as { n: number }
    expect(count.n).toBe(2)

    // The cross-run state is a JSON cache, never a SQLite file: a hosted sync
    // leaves nothing matching *.db behind (hasna/apps#1720 (f)).
    expect(existsSync(cachePath)).toBe(true)
    expect(JSON.parse(readFileSync(cachePath, 'utf8'))).toMatchObject({ version: 1 })
    expect(sqliteFilesUnder(root)).toEqual([])
  })

  it('treats a pre-existing empty or non-JSON cache file as an empty cache', async () => {
    const projectsDir = join(root, 'projects')
    mkdirSync(projectsDir, { recursive: true })
    writeClaudeFixture(projectsDir)
    // What an older station has at the override path: bytes that are not the
    // JSON cache (an empty file, or a legacy SQLite header).
    writeFileSync(cachePath, 'SQLite format 3\0not-a-json-cache')

    const result = await withProviderFetchStub(
      async () => { throw new Error('unexpected provider fetch during ingest') },
      () => syncAllToCloud(cloud, { claude: true, projectsDir, cachePath }),
    )

    expect(result.posted).toBe(true)
    expect(JSON.parse(readFileSync(cachePath, 'utf8'))).toMatchObject({ version: 1 })
  })

  it('picks up a new provider file on the next cloud sync', async () => {
    const projectsDir = join(root, 'projects')
    mkdirSync(projectsDir, { recursive: true })
    writeClaudeFixture(projectsDir)

    await withProviderFetchStub(
      async () => { throw new Error('unexpected provider fetch during ingest') },
      () => syncAllToCloud(cloud, { claude: true, projectsDir, cachePath }),
    )

    // Second session file with its own requests.
    const projectDir = join(projectsDir, '-tmp-economy-claude-project')
    const session2 = '22222222-2222-4222-8222-222222222222'
    writeFileSync(join(projectDir, `${session2}.jsonl`), jsonl(
      {
        type: 'assistant',
        uuid: 'assistant-3',
        requestId: 'req-session2-1',
        cwd: '/tmp/economy-claude-project',
        sessionId: session2,
        timestamp: '2026-05-08T11:00:01.000Z',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 10 },
        },
      },
    ))

    const again = await withProviderFetchStub(
      async () => { throw new Error('unexpected provider fetch during ingest') },
      () => syncAllToCloud(cloud, { claude: true, projectsDir, cachePath }),
    )
    expect(again.posted).toBe(true)

    const count = serverDb.prepare(`SELECT COUNT(*) AS n FROM requests`).get() as { n: number }
    expect(count.n).toBe(3)
  })

  it('pushes provider billing rows into the hosted API via the cloud path', async () => {
    process.env['HASNAXYZ_ANTHROPIC_LIVE_ADMIN_API_KEY'] = 'test-anthropic-admin-key'
    try {
      const result = await withProviderFetchStub(
        async (input) => {
          const url = String(input)
          if (url.startsWith('https://api.anthropic.com/v1/organizations/cost_report')) {
            return new Response(JSON.stringify({
              data: [
                {
                  starting_at: '2026-08-01T00:00:00Z',
                  results: [{ amount: '123.45', description: 'Messages' }],
                },
              ],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } })
          }
          throw new Error(`unexpected provider fetch: ${url}`)
        },
        () => billingSyncToCloud(cloud, { anthropic: true, days: 3 }),
      )

      expect(result.posted).toBe(true)
      const row = serverDb.prepare(`SELECT * FROM billing_daily WHERE provider = 'anthropic'`).get() as Record<string, unknown> | null
      expect(row).toBeTruthy()
      expect(Number(row!['cost_usd'])).toBeCloseTo(1.2345)
    } finally {
      delete process.env['HASNAXYZ_ANTHROPIC_LIVE_ADMIN_API_KEY']
    }
  })
})

describe('ingest cache location', () => {
  const saved = {
    cacheHome: process.env['HASNA_CACHE_HOME'],
    explicit: process.env['HASNA_ECONOMY_INGEST_CACHE'],
  }
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  afterEach(() => {
    restore('HASNA_CACHE_HOME', saved.cacheHome)
    restore('HASNA_ECONOMY_INGEST_CACHE', saved.explicit)
  })

  it('defaults to a JSON file under the cache root — never a *.db, never the app home', () => {
    const cacheHome = mkdtempSync(join(tmpdir(), 'economy-cache-home-'))
    try {
      delete process.env['HASNA_ECONOMY_INGEST_CACHE']
      process.env['HASNA_CACHE_HOME'] = cacheHome
      const path = getIngestCachePath()
      expect(path).toBe(join(cacheHome, 'economy', 'ingest-cache.json'))
      expect(path).not.toContain('.hasna')
      expect(path.endsWith('.db')).toBe(false)
    } finally {
      rmSync(cacheHome, { recursive: true, force: true })
    }
  })

  it('HASNA_ECONOMY_INGEST_CACHE names the file explicitly', () => {
    process.env['HASNA_ECONOMY_INGEST_CACHE'] = join(tmpdir(), 'economy-explicit', 'ingest-cache.json')
    expect(getIngestCachePath()).toBe(join(tmpdir(), 'economy-explicit', 'ingest-cache.json'))
  })
})
