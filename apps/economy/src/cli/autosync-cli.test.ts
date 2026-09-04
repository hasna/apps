import { afterEach, describe, expect, test } from 'bun:test'
import { Database as BunDatabase } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDatabase, getIngestState } from '../db/database.js'
import { AUTOSYNC_STATE_SOURCE, AUTOSYNC_STATE_KEY } from '../lib/autosync-gate.js'

const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const tempRoots: string[] = []

// The spawned CLI must be hermetic: it must not inherit the fleet shell's
// HASNA_* exports (other apps' API URLs would make their SDKs connect over
// the network) and it must stay on the local economy store. Start from a
// minimal env: an empty HOME kills the contracts disk config tier
// (homeDir(env) requires a non-empty $HOME), the explicit-blank API
// URL/KEY pair selects no HTTP transport, and HASNA_ECONOMY_LOCAL is the
// explicit opt-in that keeps these local-store runs legal (without it the
// CLI fails closed — see src/lib/cloud-storage.ts).
const localStorageEnv = {
  HOME: '',
  PATH: process.env['PATH'] ?? '',
  HASNA_ECONOMY_API_URL: '',
  HASNA_ECONOMY_API_KEY: '',
  ECONOMY_API_URL: '',
  ECONOMY_API_KEY: '',
  HASNA_ECONOMY_LOCAL: '1',
  ECONOMY_LOCAL: '1',
} as const

// The quota ingests fetch provider usage endpoints with a 10s timeout each;
// pre-seed their per-day markers so a test run that forces the ingest stays
// hermetic (no network, no 10s waits).
function seedQuotaMarkers(dbPath: string): void {
  const db = openDatabase(dbPath)
  try {
    const today = new Date().toISOString().substring(0, 10)
    for (const source of ['claude', 'codex']) {
      db.prepare(`INSERT OR REPLACE INTO ingest_state (source, key, value) VALUES (?, ?, '1')`).run(source, `quota-${today}`)
    }
  } finally {
    db.close()
  }
}

async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'economy-autosync-test-'))
  tempRoots.push(tempRoot)
  // The codex ingest reads provider thread DBs that can be multi-GB on a fleet
  // machine; point both at temp sqlite files with an empty threads table so a
  // forced ingest stays hermetic (zero threads, nothing walked).
  for (const name of ['codex.db', 'codewith.db']) {
    const providerDb = new BunDatabase(join(tempRoot, name))
    providerDb.run('CREATE TABLE threads (id TEXT, cwd TEXT, created_at INTEGER, updated_at INTEGER, tokens_used INTEGER, title TEXT)')
    providerDb.close()
  }
  const proc = Bun.spawn(['bun', 'run', 'src/cli/index.ts', ...args], {
    cwd: root,
    env: {
      ...localStorageEnv,
      HASNA_ECONOMY_DB_PATH: join(tempRoot, 'economy.db'),
      HASNA_ECONOMY_CODEX_DB_PATH: join(tempRoot, 'codex.db'),
      HASNA_ECONOMY_CODEWITH_DB_PATH: join(tempRoot, 'codewith.db'),
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

function markerValue(dbPath: string): string | null {
  const db = openDatabase(dbPath, true)
  try {
    return getIngestState(db, AUTOSYNC_STATE_SOURCE, AUTOSYNC_STATE_KEY)
  } finally {
    db.close()
  }
}

describe('read-only verbs respect the autosync staleness gate', () => {
  test('a fresh autosync marker makes machines answer without re-running the ingest', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'economy-autosync-db-'))
    tempRoots.push(tempRoot)
    const dbPath = join(tempRoot, 'economy.db')
    const projectsDir = join(tempRoot, 'projects')

    // Seed a store that was auto-synced moments ago.
    const db = openDatabase(dbPath)
    const now = String(Date.now())
    db.prepare(`INSERT OR REPLACE INTO ingest_state (source, key, value) VALUES (?, ?, ?)`).run(AUTOSYNC_STATE_SOURCE, AUTOSYNC_STATE_KEY, now)
    db.close()

    const result = await runCli(['machines'], { HASNA_ECONOMY_DB_PATH: dbPath, HASNA_ECONOMY_CLAUDE_PROJECTS_DIR: projectsDir, HASNA_ECONOMY_TAKUMI_PROJECTS_DIR: projectsDir })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/No machine data yet/i)

    // The gate skipped the ingest: the marker was NOT refreshed and no claude
    // ingest-state rows were written.
    const after = markerValue(dbPath)
    expect(after).toBe(now)
    const post = openDatabase(dbPath, true)
    const claudeRows = post.prepare(`SELECT COUNT(*) AS n FROM ingest_state WHERE source = 'claude'`).get() as { n: number }
    post.close()
    expect(claudeRows.n).toBe(0)
  })

  test('a stale autosync marker makes machines refresh the ingest and the marker', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'economy-autosync-db-'))
    tempRoots.push(tempRoot)
    const dbPath = join(tempRoot, 'economy.db')
    const projectsDir = join(tempRoot, 'projects')

    // Seed a store whose last auto-sync is 20 minutes old (default interval 10m).
    const stale = String(Date.now() - 20 * 60_000)
    const db = openDatabase(dbPath)
    db.prepare(`INSERT OR REPLACE INTO ingest_state (source, key, value) VALUES (?, ?, ?)`).run(AUTOSYNC_STATE_SOURCE, AUTOSYNC_STATE_KEY, stale)
    db.close()
    seedQuotaMarkers(dbPath)

    const result = await runCli(['machines'], { HASNA_ECONOMY_DB_PATH: dbPath, HASNA_ECONOMY_CLAUDE_PROJECTS_DIR: projectsDir, HASNA_ECONOMY_TAKUMI_PROJECTS_DIR: projectsDir })
    expect(result.exitCode).toBe(0)

    // The ingest ran and the marker advanced to a fresh timestamp.
    const after = markerValue(dbPath)
    expect(after).not.toBeNull()
    expect(Math.abs(Number(after) - Date.now())).toBeLessThan(30_000)
  })

  test('HASNA_ECONOMY_AUTOSYNC_INTERVAL=0 keeps the legacy always-sync behavior', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'economy-autosync-db-'))
    tempRoots.push(tempRoot)
    const dbPath = join(tempRoot, 'economy.db')
    const projectsDir = join(tempRoot, 'projects')

    const fresh = String(Date.now())
    const db = openDatabase(dbPath)
    db.prepare(`INSERT OR REPLACE INTO ingest_state (source, key, value) VALUES (?, ?, ?)`).run(AUTOSYNC_STATE_SOURCE, AUTOSYNC_STATE_KEY, fresh)
    db.close()
    seedQuotaMarkers(dbPath)

    const result = await runCli(['machines'], {
      HASNA_ECONOMY_DB_PATH: dbPath,
      HASNA_ECONOMY_AUTOSYNC_INTERVAL: '0',
      HASNA_ECONOMY_CLAUDE_PROJECTS_DIR: projectsDir,
      HASNA_ECONOMY_TAKUMI_PROJECTS_DIR: projectsDir,
    })
    expect(result.exitCode).toBe(0)

    // With interval 0 the ingest always runs, so the marker advances even
    // though it was fresh.
    const after = markerValue(dbPath)
    expect(after).not.toBe(fresh)
  })
})

afterEach(() => {
  for (const rootPath of tempRoots) rmSync(rootPath, { recursive: true, force: true })
  tempRoots.length = 0
})
