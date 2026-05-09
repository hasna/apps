import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const tempRoots: string[] = []

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tempRoot = mkdtempSync(join(tmpdir(), 'economy-cli-test-'))
  tempRoots.push(tempRoot)
  const proc = Bun.spawn(['bun', 'run', 'src/cli/index.ts', ...args], {
    cwd: root,
    env: { ...process.env, HASNA_ECONOMY_DB_PATH: join(tempRoot, 'economy.db') },
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
  test('documents Gemini as a billing sync provider', async () => {
    const { stdout, stderr, exitCode } = await runCli(['billing', 'sync', '--help'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Sync actual billing from Anthropic, OpenAI, and Gemini billing sources')
    expect(stdout).toContain('--anthropic')
    expect(stdout).toContain('--openai')
    expect(stdout).toContain('--gemini')
    expect(stderr).toBe('')
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
  })

  test('pricing set rejects invalid numeric values', async () => {
    let result = await runCli(['pricing', 'set', 'bad-model', '--input', '1', '--output', 'nan'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--output must be a number')

    result = await runCli(['pricing', 'set', 'bad-model', '--input', '1', '--output', '2', '--cache-read', '-0.1'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--cache-read must be non-negative')
  })

  test('goal set rejects invalid limit and period values', async () => {
    let result = await runCli(['goal', 'set', '--limit', '0'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--limit must be greater than 0')

    result = await runCli(['goal', 'set', '--limit', '10', '--period', 'quarter'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--period must be one of: day, week, month, year')
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
  })
})
