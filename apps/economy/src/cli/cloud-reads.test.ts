// Regression tests for issue #1585: read-only CLI verbs (brief, efficiency)
// must not issue a POST to /v1/ingest in self_hosted/cloud (API) mode.
//
// In API mode the reads come straight from the shared API's GET routes — there
// is no local store to flush, and the /v1/ingest push belongs to the explicit
// `economy sync` verb only. Before the fix every read ran autoSync(), which in
// API mode ingested the on-box provider corpus and POSTed the rows; against a
// hosted /ingest that faults (500) the read itself failed with
// "Hasna cloud request failed: POST /ingest -> 500".
//
// This suite reproduces that environment: a real economy server (seeded
// SQLite) behind an in-process middleware that answers POST /v1/ingest with
// HTTP 500 (the prod symptom) and records every request. The CLI is spawned in
// API mode with HASNA_ECONOMY_AUTOSYNC_INTERVAL=0 (always-enter autosync under
// the old code) and a NON-empty on-box claude corpus — so a regression that
// tries to POST /ingest deterministically produces rows, hits the 500, and
// fails the read. The fixed CLI must answer from the GET routes and never POST.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDatabase, upsertRequest, upsertSession } from '../db/database.js'
import { createHandler } from '../server/serve.js'
import type { SqliteAdapter as Database } from '../db/sqlite-adapter.js'
import type { EconomyRequest, EconomySession } from '../types/index.js'

const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const tempRoots: string[] = []
const servers: ReturnType<typeof Bun.serve>[] = []

// A real-ish claude session JSONL with one assistant usage line. If autosync
// runs this corpus through the ingest reader, it produces requests rows, which
// a regression would then POST to /v1/ingest.
const CLAUDE_JSONL = JSON.stringify({
  timestamp: '2026-09-04T08:00:00.000Z',
  sessionId: 'sa-1585-cloud-reads-sess',
  cwd: '/proj/cloud-reads',
  message: {
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
})

function session(overrides: Partial<EconomySession> = {}): EconomySession {
  const now = new Date().toISOString()
  return {
    id: 'sess-1',
    agent: 'claude',
    project_path: '/proj/cloud-reads',
    project_name: 'cloud-reads',
    started_at: now,
    ended_at: now,
    total_cost_usd: 0.01,
    total_tokens: 2_000,
    request_count: 1,
    machine_id: 'test-station',
    account_key: 'claude:test@example.com',
    account_tool: 'claude',
    account_name: 'test',
    account_email: 'test@example.com',
    account_source: 'test',
    ...overrides,
  }
}

function request(overrides: Partial<EconomyRequest> = {}): EconomyRequest {
  const now = new Date().toISOString()
  return {
    id: 'request-1',
    agent: 'claude',
    session_id: 'sess-1',
    model: 'claude-sonnet-4-6',
    input_tokens: 1_000,
    output_tokens: 500,
    cache_read_tokens: 200,
    cache_create_tokens: 300,
    cache_create_5m_tokens: 100,
    cache_create_1h_tokens: 200,
    cost_usd: 0.01,
    cost_basis: 'metered_api',
    duration_ms: 1000,
    timestamp: now,
    source_request_id: 'source-request-1',
    machine_id: 'test-station',
    account_key: 'claude:test@example.com',
    account_tool: 'claude',
    account_name: 'test',
    account_email: 'test@example.com',
    account_source: 'test',
    ...overrides,
  }
}

interface RecordedRequest {
  method: string
  path: string
}

interface CloudApi {
  url: string
  recorded: RecordedRequest[]
}

/** Serve the real economy handler on an ephemeral port, recording every call.
 *  POST /v1/ingest answers with `ingestStatus` (default 500 === the prod
 *  symptom that turned read commands into failures). */
function startCloudApi(db: Database, ingestStatus = 500): CloudApi {
  const recorded: RecordedRequest[] = []
  const inner = createHandler(db)
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (req) => {
      const url = new URL(req.url)
      recorded.push({ method: req.method, path: url.pathname })
      if (req.method === 'POST' && (url.pathname === '/v1/ingest' || url.pathname === '/api/ingest')) {
        return new Response(JSON.stringify({ error: 'something went wrong' }), {
          status: ingestStatus,
          headers: { 'content-type': 'application/json' },
        })
      }
      return inner(req)
    },
  })
  servers.push(server)
  return { url: `http://127.0.0.1:${server.port}`, recorded }
}

/** Seed the same corpus shape the CLI would auto-sync from (see #1585). */
function seedClaudeCorpus(projectsDir: string, ingestCachePath: string): void {
  const projectDir = join(projectsDir, 'proj-cloud-reads')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'session-a1b2c3d4-e5f6-4a5b-9c8d-7e6f5a4b3c2d.jsonl'), CLAUDE_JSONL + '\n')
  writeFileSync(ingestCachePath, '')
}

async function runCli(
  args: string[],
  apiUrl: string,
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'economy-cloud-reads-test-'))
  tempRoots.push(tempRoot)
  const projectsDir = join(tempRoot, 'projects')
  mkdirSync(projectsDir, { recursive: true })
  const ingestCache = join(tempRoot, 'ingest-cache.db')
  seedClaudeCorpus(projectsDir, ingestCache)

  const proc = Bun.spawn(['bun', 'run', 'src/cli/index.ts', ...args], {
    cwd: root,
    env: {
      HOME: '',
      PATH: process.env['PATH'] ?? '',
      HASNA_ECONOMY_API_URL: apiUrl,
      HASNA_ECONOMY_API_KEY: 'test-key',
      // Always-enter the autosync gate: under the pre-fix code this forces the
      // cloud ingest POST, so the regression below manifests deterministically.
      HASNA_ECONOMY_AUTOSYNC_INTERVAL: '0',
      HASNA_ECONOMY_CLAUDE_PROJECTS_DIR: projectsDir,
      HASNA_ECONOMY_TAKUMI_PROJECTS_DIR: projectsDir,
      HASNA_ECONOMY_INGEST_CACHE: ingestCache,
      ...extraEnv,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

describe('read-only CLI verbs in API mode', () => {
  test('brief reads GET /v1/brief and never POSTs /v1/ingest (even when the server 500s it)', async () => {
    const db = openDatabase(':memory:', true)
    upsertSession(db, session())
    upsertRequest(db, request())
    db.prepare(`
      INSERT INTO machines (machine_id, hostname, last_seen_at, last_push_at, last_pull_at, economy_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('test-station', 'test-station', new Date().toISOString(), null, new Date().toISOString(), '0.3.28', new Date().toISOString())
    const api = startCloudApi(db, 500)

    const result = await runCli(['brief', '--since', '24h'], api.url)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).not.toContain('POST /ingest -> 500')
    expect(result.stdout).toContain('Economy Brief')
    expect(result.stdout).toContain('SUMMARY')
    expect(result.stdout).toContain('test-station')

    // The read went to the real GET route and answered from the served data.
    expect(api.recorded.some(r => r.method === 'GET' && r.path === '/v1/brief')).toBe(true)
    // And the write route was never touched by the read command.
    expect(api.recorded.filter(r => r.method === 'POST' && r.path === '/v1/ingest')).toHaveLength(0)
  })

  test('efficiency reads GET /v1/efficiency and never POSTs /v1/ingest', async () => {
    const db = openDatabase(':memory:', true)
    upsertSession(db, session())
    upsertRequest(db, request())
    const api = startCloudApi(db, 500)

    const result = await runCli(['efficiency'], api.url)

    expect(result.exitCode).toBe(0)
    expect(result.stderr).not.toContain('POST /ingest -> 500')
    expect(result.stdout).toContain('Token Efficiency')
    expect(result.stdout).toContain('claude-sonnet-4-6')

    expect(api.recorded.some(r => r.method === 'GET' && r.path === '/v1/efficiency')).toBe(true)
    expect(api.recorded.filter(r => r.method === 'POST' && r.path === '/v1/ingest')).toHaveLength(0)
  })

  test('the explicit `economy sync` verb STILL pushes to /v1/ingest in API mode', async () => {
    const db = openDatabase(':memory:', true)
    const api = startCloudApi(db, 200)

    const result = await runCli(['sync', '--claude'], api.url)

    expect(result.exitCode).toBe(0)
    // The explicit write verb keeps its ingest push (and the accepted response
    // is reported), so the read-command change did not disable cloud ingest.
    expect(api.recorded.some(r => r.method === 'POST' && r.path === '/v1/ingest')).toBe(true)
    expect(result.stdout).toMatch(/pushed .* to the shared API/i)
  })
})

afterEach(() => {
  for (const server of servers) server.stop(true)
  servers.length = 0
  for (const rootPath of tempRoots) rmSync(rootPath, { recursive: true, force: true })
  tempRoots.length = 0
})