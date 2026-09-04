import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const tempRoots: string[] = []

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true })
  }
})

// The spawned CLI must be hermetic: no inherited fleet API env (other apps'
// URLs must not leak), a HOME the test owns (nothing may touch the developer's
// real ~/.hasna or ~/Library/Application Support/Hasna), and BOTH local
// opt-in variables explicitly blanked so an ambient HASNA_ECONOMY_LOCAL in the
// developer's shell cannot turn the fail-closed run green.
function hermeticEnv(tempRoot: string): Record<string, string> {
  const env: Record<string, string> = {
    HOME: tempRoot,
    PATH: process.env['PATH'] ?? '',
    HASNA_ECONOMY_API_URL: '',
    HASNA_ECONOMY_API_KEY: '',
    ECONOMY_API_URL: '',
    ECONOMY_API_KEY: '',
    HASNA_ECONOMY_LOCAL: '',
    ECONOMY_LOCAL: '',
  }
  // Strip the ambient fleet env of every other HASNA_*/<APP>_API_* pair.
  for (const key of Object.keys(process.env)) {
    if (/^(?:HASNA_[A-Z0-9_]+_API_(?:URL|KEY)|[A-Z0-9]+_API_(?:URL|KEY))$/.test(key)) {
      env[key] = ''
    }
  }
  return env
}

async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', 'run', 'src/cli/index.ts', ...args], {
    cwd: root,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

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

describe('fail-closed storage resolution', () => {
  // Owner ruling (2026-09-04): running WITHOUT the fleet API env prefix
  // (HASNA_ECONOMY_API_URL + HASNA_ECONOMY_API_KEY) must fail closed — non-zero
  // exit, an actionable error naming the required env, and NO local database
  // created anywhere under the owning HOME.
  test('doctor exits non-zero with an actionable error and creates no local database when the API env is absent', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'economy-fail-closed-'))
    tempRoots.push(tempRoot)
    const env = hermeticEnv(tempRoot)
    env['HASNA_ECONOMY_DB_PATH'] = join(tempRoot, 'economy.db')

    const result = await runCli(['doctor'], env)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('HASNA_ECONOMY_API_URL')
    expect(result.stderr).toContain('HASNA_ECONOMY_API_KEY')
    expect(result.stderr).toMatch(/fail\w*\s*closed/i)
    // The seam throws before any LocalStore/openDatabase can run: no SQLite
    // file may exist anywhere under the owning HOME (the default data root
    // resolves inside it), and none at the explicitly pointed path either.
    expect(sqliteFilesUnder(tempRoot)).toEqual([])
    expect(existsSync(join(tempRoot, 'economy.db'))).toBe(false)
  })

  // Same run WITH the explicit local opt-in is legal again: the CLI serves the
  // local store (doctor reports local storage) and the store file is created.
  test('the explicit local opt-in restores the local store for the same env', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'economy-local-opt-in-'))
    tempRoots.push(tempRoot)
    const env = hermeticEnv(tempRoot)
    env['HASNA_ECONOMY_DB_PATH'] = join(tempRoot, 'economy.db')
    env['HASNA_ECONOMY_LOCAL'] = '1'

    const result = await runCli(['doctor'], env)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('storage: local')
    expect(existsSync(join(tempRoot, 'economy.db'))).toBe(true)
    expect(sqliteFilesUnder(tempRoot).length).toBeGreaterThan(0)
  })

  // The opt-in is strict about VALUES: a blank or false-y HASNA_ECONOMY_LOCAL
  // is not an opt-in, so the run still fails closed.
  test('a blank HASNA_ECONOMY_LOCAL still fails closed', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'economy-local-blank-'))
    tempRoots.push(tempRoot)
    const env = hermeticEnv(tempRoot)
    env['HASNA_ECONOMY_DB_PATH'] = join(tempRoot, 'economy.db')

    const result = await runCli(['doctor'], env)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('HASNA_ECONOMY_API_URL')
    expect(existsSync(join(tempRoot, 'economy.db'))).toBe(false)
    expect(sqliteFilesUnder(tempRoot)).toEqual([])
  })
})
