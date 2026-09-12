// Regression suite for the storage-mode retirement (owner directive 2026-08-15):
// stale `*_MODE` / `*_STORAGE_MODE` variables must gate NOTHING.
//
// The fleet shell historically exported HASNA_ECONOMY_STORAGE_MODE=cloud and
// wrapper scripts still carry the variable today. Pre-fix, economy treated a
// surviving mode variable as a hard error, which failed EVERY command in
// hosted mode and turned a stale wrapper into a broken CLI. The contract's own
// stance (`@hasna/contracts` 1.0.2 `no-deployment-modes.test.ts`) is that the
// retired variables are inert: resolvers never read them.
//
// These spawned-CLI tests pin the observable behavior: with any of the retired
// variables set, read commands still resolve and answer on BOTH transports —
// http (URL + key against a real serve handler) and sqlite (the explicit
// HASNA_ECONOMY_LOCAL=1 opt-in).

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDatabase, upsertRequest, upsertSession } from '../db/sqlite-store.js'
import { createHandler } from '../server/serve.js'
import type { SqliteAdapter as Database } from '../db/sqlite-adapter.js'
import type { EconomyRequest, EconomySession } from '../types/index.js'

const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const tempRoots: string[] = []
const servers: ReturnType<typeof Bun.serve>[] = []

const STALE_MODE_VARS = [
  'HASNA_ECONOMY_STORAGE_MODE',
  'HASNA_ECONOMY_MODE',
  'ECONOMY_STORAGE_MODE',
  'ECONOMY_MODE',
] as const

function session(overrides: Partial<EconomySession> = {}): EconomySession {
  const now = new Date().toISOString()
  return {
    id: 'stale-mode-session-1',
    agent: 'claude',
    project_path: '/proj/stale-mode',
    project_name: 'stale-mode',
    started_at: now,
    ended_at: now,
    total_cost_usd: 0.02,
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
    id: 'stale-mode-request-1',
    agent: 'claude',
    session_id: 'stale-mode-session-1',
    model: 'claude-sonnet-4-6',
    input_tokens: 1_000,
    output_tokens: 500,
    cache_read_tokens: 200,
    cache_create_tokens: 300,
    cache_create_5m_tokens: 100,
    cache_create_1h_tokens: 200,
    cost_usd: 0.02,
    cost_basis: 'metered_api',
    duration_ms: 1000,
    timestamp: now,
    project_path: '/proj/stale-mode',
    project_name: 'stale-mode',
    machine_id: 'test-station',
    ...overrides,
  }
}

function startCloudApi(db: Database): { url: string } {
  const inner = createHandler(db)
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (req) => inner(req),
  })
  servers.push(server)
  return { url: `http://127.0.0.1:${server.port}` }
}

interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

async function runCli(args: string[], env: Record<string, string>): Promise<CliResult> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'economy-stale-mode-test-'))
  tempRoots.push(tempRoot)
  const proc = Bun.spawn(['bun', 'run', 'src/cli/index.ts', ...args], {
    cwd: root,
    env: {
      PATH: process.env['PATH'] ?? '',
      HASNA_ECONOMY_AUTOSYNC_INTERVAL: '0',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

describe('stale storage-mode variables gate no command (owner directive 2026-08-15)', () => {
  afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true)
    for (const tempRoot of tempRoots.splice(0)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('hosted: transport and data reads resolve with every retired variable set', async () => {
    const db = openDatabase(':memory:', true)
    upsertSession(db, session())
    upsertRequest(db, request())
    const api = startCloudApi(db)

    for (const staleKey of STALE_MODE_VARS) {
      const env = {
        HOME: '',
        HASNA_ECONOMY_API_URL: api.url,
        HASNA_ECONOMY_API_KEY: 'test-key',
        [staleKey]: 'cloud',
      }

      const transport = await runCli(['transport', '--json'], env)
      expect(transport.exitCode, `${staleKey} must not fail transport`).toBe(0)
      expect(transport.stdout).toContain('"transport": "http"')
      expect(transport.stderr).not.toContain('was removed')

      const sessions = await runCli(['sessions', '--limit', '5'], env)
      expect(sessions.exitCode, `${staleKey} must not fail sessions`).toBe(0)
      expect(sessions.stdout).toContain('stale-mode')
    }
  })

  test('local opt-in: transport and data reads resolve with every retired variable set', async () => {
    for (const staleKey of STALE_MODE_VARS) {
      const tempRoot = mkdtempSync(join(tmpdir(), 'economy-stale-mode-local-'))
      tempRoots.push(tempRoot)
      mkdirSync(join(tempRoot, '.claude'), { recursive: true })
      const dbPath = join(tempRoot, 'economy.db')
      const db = openDatabase(dbPath)
      upsertSession(db, session())
      upsertRequest(db, request())
      db.close()

      const env = {
        HOME: tempRoot,
        HASNA_HOME: join(tempRoot, '.hasna'),
        HASNA_ECONOMY_LOCAL: '1',
        HASNA_ECONOMY_DB_PATH: dbPath,
        [staleKey]: 'local',
      }

      const transport = await runCli(['transport', '--json'], env)
      expect(transport.exitCode, `${staleKey} must not fail transport`).toBe(0)
      expect(transport.stdout).toContain('"transport": "sqlite"')

      const sessions = await runCli(['sessions', '--limit', '5'], env)
      expect(sessions.exitCode, `${staleKey} must not fail sessions`).toBe(0)
      expect(sessions.stdout).toContain('stale-mode')
      expect(sessions.stderr).not.toContain('was removed')
    }
  })
})
