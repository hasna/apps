import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDatabase, upsertCostCenter, upsertRequest, upsertSession } from '../db/database.js'

const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const tempRoots: string[] = []

async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'economy-cli-test-'))
  tempRoots.push(tempRoot)
  const proc = Bun.spawn(['bun', 'run', 'src/cli/index.ts', ...args], {
    cwd: root,
    env: { ...process.env, HASNA_ECONOMY_DB_PATH: join(tempRoot, 'economy.db'), ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true })
  }
})

describe('economy CLI help', () => {
  test('todos --help documents usage vs savings roadmap', async () => {
    const { stdout, stderr, exitCode } = await runCli(['todos', '--help'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('fleet sync, usage tracking, subscription savings')
    expect(stdout).toContain('Multi-machine (current vs target)')
    expect(stdout).toContain('included_consumed_usd')
    expect(stdout).toContain('opencode')
    expect(stdout).toContain('cursor')
    expect(stdout).toContain('hermes')
    expect(stdout).toContain('saved_usd')
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

describe('economy brains CLI', () => {
  test('gather reports no examples and does not write output for an empty database', async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'economy-cli-brains-output-'))
    tempRoots.push(outputRoot)
    const outputPath = join(outputRoot, 'training.jsonl')

    const result = await runCli(['brains', 'gather', '--limit', '10', '--output', outputPath])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No training examples found')
    expect(result.stdout).toContain('Run: economy sync')
    expect(result.stderr).toBe('')
    expect(existsSync(outputPath)).toBe(false)
  })

  test('model set and clear honor HASNA_ECONOMY_CONFIG_PATH', async () => {
    const configRoot = mkdtempSync(join(tmpdir(), 'economy-cli-model-config-'))
    tempRoots.push(configRoot)
    const configPath = join(configRoot, 'nested', 'config.json')
    const env = { HASNA_ECONOMY_CONFIG_PATH: configPath }

    let result = await runCli(['brains', 'model', 'set', 'ft:gpt-4o-mini:economy'], env)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Active model set to: ft:gpt-4o-mini:economy')
    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toMatchObject({
      activeModel: 'ft:gpt-4o-mini:economy',
    })

    result = await runCli(['brains', 'model'], env)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Active model:')
    expect(result.stdout).toContain('ft:gpt-4o-mini:economy')

    result = await runCli(['brains', 'model', 'clear'], env)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Active model cleared')
    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).not.toHaveProperty('activeModel')
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
