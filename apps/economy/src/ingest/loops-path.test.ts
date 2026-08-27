import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { defaultLoopsDbPath, loopsDbPath } from './loops.js'

const ENV_KEYS = ['HOME', 'USERPROFILE', 'HASNA_ECONOMY_LOOPS_DB_PATH'] as const
let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}
let tempHome: string | null = null
const cleanups: string[] = []

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (key in saved) {
      const value = saved[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true })
    tempHome = null
  }
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function isolateHome(): string {
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  const home = mkdtempSync(join(tmpdir(), 'economy-loops-path-'))
  tempHome = home
  process.env.HOME = home
  delete process.env.USERPROFILE
  delete process.env.HASNA_ECONOMY_LOOPS_DB_PATH
  return home
}

describe('loops store path — resolver with a legacy-read fallback', () => {
  test('falls back to the legacy ~/.hasna/loops/loops.db when the resolver root has no store', () => {
    const home = isolateHome()
    expect(defaultLoopsDbPath()).toBe(join(home, '.hasna', 'loops', 'loops.db'))
  })

  test('reads the resolver (XDG) root once loops.db has migrated there', () => {
    const home = isolateHome()
    const xdg = join(home, '.local', 'share', 'hasna', 'loops')
    mkdirSync(xdg, { recursive: true })
    writeFileSync(join(xdg, 'loops.db'), 'migrated-loops-store')
    expect(defaultLoopsDbPath()).toBe(join(xdg, 'loops.db'))
  })

  test('the exact-app override wins over both roots', () => {
    isolateHome()
    const override = mkdtempSync(join(tmpdir(), 'economy-loops-db-override-'))
    cleanups.push(override)
    process.env.HASNA_ECONOMY_LOOPS_DB_PATH = join(override, 'loops.db')
    expect(loopsDbPath()).toBe(join(override, 'loops.db'))
  })

  test('a migrated resolver store is not required to exist for the legacy fallback to hold', () => {
    const home = isolateHome()
    const xdg = join(home, '.local', 'share', 'hasna', 'loops')
    mkdirSync(xdg, { recursive: true }) // dir exists but no loops.db
    expect(existsSync(join(xdg, 'loops.db'))).toBe(false)
    expect(defaultLoopsDbPath()).toBe(join(home, '.hasna', 'loops', 'loops.db'))
  })
})
