import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDatabase, upsertCostCenter, upsertRequest, upsertSession } from '../db/database.js'

const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const tempRoots: string[] = []
// Storage-mode variables are retired. The fleet shell exports
// HASNA_ECONOMY_API_URL/KEY, so these tests pin the env to the local backend by
// clearing the API URL/KEY pair (the contracts 0.11.1 client selects the http
// transport purely from their presence).
const localStorageEnv = {
  // The contracts 0.11.1 client selects the http transport from the API
  // URL/KEY pair alone (modes are retired). The fleet shell exports
  // HASNA_ECONOMY_API_URL/KEY and the disk app-config tier derives from HOME,
  // so a spawned CLI needs both tiers neutralized to stay on the local store.
  HOME: '',
  HASNA_ECONOMY_API_URL: '',
  HASNA_ECONOMY_API_KEY: '',
  ECONOMY_API_URL: '',
  ECONOMY_API_KEY: '',
} as const

async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'economy-cli-test-'))
  tempRoots.push(tempRoot)
  const proc = Bun.spawn(['bun', 'run', 'src/cli/index.ts', ...args], {
    cwd: root,
    env: { ...process.env, ...localStorageEnv, HASNA_ECONOMY_DB_PATH: join(tempRoot, 'economy.db'), ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

function seedBreakdownRows(dbPath: string): void {
  const db = openDatabase(dbPath)
  const timestamp = '2026-06-24T12:00:00.000Z'
  for (let i = 0; i < 25; i++) {
    upsertSession(db, {
      id: `breakdown-session-${i}`,
      agent: 'codex',
      project_path: `/tmp/breakdown-project-${i}`,
      project_name: `breakdown-project-${i}`,
      started_at: timestamp,
      ended_at: null,
      total_cost_usd: i + 1,
      total_tokens: 1000 + i,
      request_count: 1,
      account_key: `codex:breakdown-account-${i}`,
      account_tool: 'codex',
      account_name: `breakdown-account-${i}`,
      account_email: `breakdown-account-${i}@example.test`,
      account_source: 'test',
    })
    upsertRequest(db, {
      id: `breakdown-request-${i}`,
      agent: 'codex',
      session_id: `breakdown-session-${i}`,
      model: `breakdown-model-${i}`,
      input_tokens: 100 + i,
      output_tokens: 20 + i,
      cache_read_tokens: 0,
      cache_create_tokens: 0,
      cost_usd: i + 1,
      cost_basis: 'metered_api',
      duration_ms: 10,
      timestamp,
      source_request_id: `breakdown-source-${i}`,
      account_key: `codex:breakdown-account-${i}`,
      account_tool: 'codex',
      account_name: `breakdown-account-${i}`,
      account_email: `breakdown-account-${i}@example.test`,
      account_source: 'test',
    })
  }
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true })
  }
})

describe('economy CLI help', () => {
  test('root help lists every supported coding agent', async () => {
    const { stdout, stderr, exitCode } = await runCli(['--help'])

    expect(exitCode).toBe(0)
    for (const agent of ['Claude', 'Takumi', 'Codex', 'Gemini', 'OpenCode', 'Cursor', 'Pi', 'Hermes']) {
      expect(stdout).toContain(agent)
    }
    expect(stderr).toBe('')
  })

  test('todos --help documents usage vs savings roadmap', async () => {
    const { stdout, stderr, exitCode } = await runCli(['todos', '--help'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('fleet sync, usage tracking, subscription savings')
    expect(stdout).toContain('Multi-machine storage')
    expect(stdout).toContain('shared /v1 API directly with URL + key')
    expect(stdout).toContain('included_consumed_usd')
    expect(stdout).toContain('opencode')
    expect(stdout).toContain('cursor')
    expect(stdout).toContain('hermes')
    expect(stdout).toContain('saved_usd')
    expect(stdout).toContain('economy todos list --verbose')
    expect(stderr).toBe('')
  })

  test('todos list is compact by default and points to detail paths', async () => {
    const { stdout, stderr, exitCode } = await runCli(['todos', 'list'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Economy Roadmap Tasks')
    expect(stdout).toContain('showing 20 of')
    expect(stdout).toContain('more tasks hidden')
    expect(stdout).toContain('--verbose')
    expect(stdout).toContain('economy todos show <task-id>')
    expect(stdout).not.toContain('14.5')
    expect(stderr).toBe('')
  })

  test('todos list JSON preserves the full filtered roadmap', async () => {
    const { stdout, stderr, exitCode } = await runCli(['todos', 'list', '--json'])

    expect(exitCode).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload.total).toBeGreaterThan(20)
    expect(payload.phases.some((phase: { id: string }) => phase.id === 'phase-14')).toBe(true)
    expect(stdout).toContain('14.5')
    expect(stderr).toBe('')
  })

  test('todos list includes OpenCode and Cursor ingest tasks', async () => {
    const { stdout, stderr, exitCode } = await runCli(['todos', 'list', '--phase', 'phase-4'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('phase-4')
    expect(stdout).toContain('Cursor Agent')
    expect(stdout).toContain('4.2')
    expect(stderr).toBe('')
  })

  test('todos list includes multi-machine auto sync phase', async () => {
    const { stdout, stderr, exitCode } = await runCli(['todos', 'list', '--phase', 'phase-9'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('phase-9')
    expect(stdout).toContain('Multi-machine auto sync')
    expect(stdout).toContain('9.7')
    expect(stdout).toContain('registerSyncSchedule')
    expect(stderr).toBe('')
  })

  test('machine and fleet commands document compact row controls', async () => {
    let result = await runCli(['machines', '--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--limit <n>')
    expect(result.stdout).toContain('--verbose')
    expect(result.stderr).toBe('')

    result = await runCli(['fleet', '--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--limit <n>')
    expect(result.stdout).toContain('--verbose')
    expect(result.stdout).toContain('--json')
    expect(result.stderr).toBe('')
  })

  test('breakdown documents compact row controls', async () => {
    const result = await runCli(['breakdown', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--limit <n>')
    expect(result.stdout).toContain('--verbose')
    expect(result.stdout).toContain('--json')
    expect(result.stderr).toBe('')
  })

  test('breakdown caps high-cardinality human output and keeps JSON complete', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'economy-breakdown-test-'))
    tempRoots.push(tempRoot)
    const dbPath = join(tempRoot, 'economy.db')
    seedBreakdownRows(dbPath)
    const env = { HASNA_ECONOMY_DB_PATH: dbPath }

    for (const by of ['model', 'project', 'account']) {
      const result = await runCli(['breakdown', '--by', by], env)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('more rows hidden')
      expect(result.stdout).toContain('--verbose')
      expect(result.stdout).toContain('--json')
      expect(result.stderr).toBe('')
    }

    const jsonResult = await runCli(['breakdown', '--by', 'model', '--json'], env)
    expect(jsonResult.exitCode).toBe(0)
    const payload = JSON.parse(jsonResult.stdout)
    expect(payload.by).toBe('model')
    expect(payload.total).toBe(25)
    expect(payload.rows).toHaveLength(25)
    expect(jsonResult.stderr).toBe('')
  })

  test('documents Gemini as a billing sync provider', async () => {
    const { stdout, stderr, exitCode } = await runCli(['billing', 'sync', '--help'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Sync actual billing from Anthropic, OpenAI, and Gemini billing sources')
    expect(stdout).toContain('--anthropic')
    expect(stdout).toContain('--openai')
    expect(stdout).toContain('--gemini')
    expect(stderr).toBe('')
  })

  test('documents account-scoped session filtering', async () => {
    const { stdout, stderr, exitCode } = await runCli(['sessions', '--help'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('--account <query>')
    expect(stdout).toContain('Filter by account key, name, or email')
    expect(stdout).toContain('opencode|cursor|pi|hermes')
    expect(stderr).toBe('')
  })

  test('documents account usage command', async () => {
    const { stdout, stderr, exitCode } = await runCli(['accounts', '--help'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('List account usage by email address and coding agent')
    expect(stdout).toContain('--json')
    expect(stderr).toBe('')
  })

  test('documents loops sync and cost-center breakdown flags', async () => {
    let result = await runCli(['sync', '--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--loops')

    result = await runCli(['breakdown', '--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('cost-center')
    expect(result.stdout).toContain('loop')
    expect(result.stdout).toContain('app')
    expect(result.stdout).toContain('repo')
  })
})

describe('economy CLI mutation validation', () => {
  test('budget set rejects invalid numeric and period values', async () => {
    let result = await runCli(['budget', 'set', '--limit', 'not-a-number'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--limit must be a number')
    expect(result.stdout).not.toContain('Budget set')

    result = await runCli(['budget', 'set', '--limit', '10', '--alert', '101'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--alert must be between 1 and 100')

    result = await runCli(['budget', 'set', '--limit', '10', '--period', 'quarterly'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--period must be one of: daily, weekly, monthly')

    result = await runCli(['budget', 'set', '--limit', '10', '--agent', 'unknown'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--agent must be one of: claude, takumi, codex, gemini, opencode, cursor, pi, hermes')
  })

  test('budget set and list support cost-center scope', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'economy-cli-budget-cost-center-'))
    tempRoots.push(tempRoot)
    const dbPath = join(tempRoot, 'economy.db')

    let result = await runCli(['budget', 'set', '--limit', '10', '--cost-center', 'loop:fleet-evaluator'], { HASNA_ECONOMY_DB_PATH: dbPath })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('loop:fleet-evaluator')

    result = await runCli(['budget', 'list'], { HASNA_ECONOMY_DB_PATH: dbPath })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('loop:fleet-evaluator')
  })

  test('breakdown supports cost-center and loop dimensions', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'economy-cli-breakdown-cost-center-'))
    tempRoots.push(tempRoot)
    const dbPath = join(tempRoot, 'economy.db')
    const db = openDatabase(dbPath, true)
    upsertCostCenter(db, {
      id: 'loop:fleet-evaluator',
      kind: 'loop',
      name: 'fleet-evaluator',
      repo_path: null,
      labels_json: '{}',
      created_at: new Date().toISOString(),
    })
    upsertSession(db, {
      id: 'loop-session',
      agent: 'loop',
      project_path: '',
      project_name: 'fleet-evaluator',
      started_at: new Date().toISOString(),
      ended_at: null,
      total_cost_usd: 0,
      total_tokens: 0,
      request_count: 0,
      cost_center_id: 'loop:fleet-evaluator',
    })
    upsertRequest(db, {
      id: 'loop-request',
      agent: 'loop',
      session_id: 'loop-session',
      model: 'gpt-5-codex',
      input_tokens: 50,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_create_tokens: 0,
      cost_usd: 0.01,
      duration_ms: 0,
      timestamp: new Date().toISOString(),
      source_request_id: 'loop-request',
      cost_center_id: 'loop:fleet-evaluator',
    })

    let result = await runCli(['breakdown', '--by', 'cost-center'], { HASNA_ECONOMY_DB_PATH: dbPath })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('fleet-evaluator')
    expect(result.stdout).toContain('loop')

    result = await runCli(['breakdown', '--by', 'loop'], { HASNA_ECONOMY_DB_PATH: dbPath })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('fleet-evaluator')
  })

  test('pricing set rejects invalid numeric values', async () => {
    let result = await runCli(['pricing', 'set', 'bad-model', '--input', '1', '--output', 'nan'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--output must be a number')

    result = await runCli(['pricing', 'set', 'bad-model', '--input', '1', '--output', '2', '--cache-read', '-0.1'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--cache-read must be non-negative')

    result = await runCli(['pricing', 'set', 'bad-model', '--input', '1', '--output', '2', '--cache-storage', '-0.1'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--cache-storage must be non-negative')
  })

  test('goal set rejects invalid limit and period values', async () => {
    let result = await runCli(['goal', 'set', '--limit', '0'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--limit must be greater than 0')

    result = await runCli(['goal', 'set', '--limit', '10', '--period', 'quarter'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--period must be one of: day, week, month, year')

    result = await runCli(['goal', 'set', '--limit', '10', '--agent', 'unknown'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--agent must be one of: claude, takumi, codex, gemini, opencode, cursor, pi, hermes')
  })

  test('operational commands reject invalid numeric options before running', async () => {
    let result = await runCli(['serve', '--port', 'not-a-port'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--port must be a number')

    result = await runCli(['dashboard', '--port', '70000'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--port must be between 1 and 65535')

    result = await runCli(['billing', 'sync', '--days', '367'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--days must be between 1 and 366')

    result = await runCli(['top', '-n', '0'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('-n must be greater than 0')

    result = await runCli(['sessions', '--limit', '1.5'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--limit must be an integer')

    result = await runCli(['top', '--agent', 'unknown'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--agent must be one of: claude, takumi, codex, gemini, opencode, cursor, pi, hermes')
  })
})
