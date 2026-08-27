import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  adoptResolverDataRoot,
  getDataDir,
  getDbPath,
  getExactDataRoot,
  getHomeDir,
  getLegacyDataRoot,
  getResolverDataRoot,
} from './database.js'

const ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'HASNA_ECONOMY_DB_PATH',
  'ECONOMY_DB',
  'HASNA_DATA_HOME',
  'HASNA_CACHE_HOME',
  'HASNA_ECONOMY_HOME',
  'ECONOMY_HOME',
] as const

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

/** Point $HOME at a fresh temp dir and clear every path-affecting override. */
function isolateHome(): string {
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  const home = mkdtempSync(join(tmpdir(), 'economy-data-root-'))
  tempHome = home
  process.env.HOME = home
  delete process.env.USERPROFILE
  delete process.env.HASNA_ECONOMY_DB_PATH
  delete process.env.ECONOMY_DB
  delete process.env.HASNA_DATA_HOME
  delete process.env.HASNA_CACHE_HOME
  delete process.env.HASNA_ECONOMY_HOME
  delete process.env.ECONOMY_HOME
  return home
}

describe('resolver (XDG) adoption — the legacy home must never become invisible', () => {
  test('resolver data root follows @hasna/paths under a fake HOME', () => {
    const home = isolateHome()
    expect(getResolverDataRoot()).toBe(join(home, '.local', 'share', 'hasna', 'economy'))
    expect(getLegacyDataRoot()).toBe(join(home, '.hasna', 'economy'))
    expect(getHomeDir()).toBe(home)
  })

  test('legacy ~/.hasna/economy stays the effective root until adopted', () => {
    const home = isolateHome()
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false)
    expect(getDataDir()).toBe(getLegacyDataRoot())
    expect(getDbPath()).toBe(join(home, '.hasna', 'economy', 'economy.db'))
  })

  test('HASNA_DATA_HOME adopts the resolver (XDG) data root', () => {
    isolateHome()
    const base = mkdtempSync(join(tmpdir(), 'economy-data-home-'))
    cleanups.push(base)
    process.env.HASNA_DATA_HOME = base
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true)
    expect(getDataDir()).toBe(join(base, 'economy'))
    expect(getDbPath()).toBe(join(base, 'economy', 'economy.db'))
  })

  test('an existing store at the resolver data root adopts it even without HASNA_DATA_HOME', () => {
    const home = isolateHome()
    const xdg = join(home, '.local', 'share', 'hasna', 'economy')
    mkdirSync(xdg, { recursive: true })
    writeFileSync(join(xdg, 'economy.db'), 'existing-migrated-store')
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true)
    expect(getDataDir()).toBe(xdg)
  })

  test('a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home', () => {
    const home = isolateHome()
    const cache = mkdtempSync(join(tmpdir(), 'economy-cache-home-'))
    cleanups.push(cache)
    process.env.HASNA_CACHE_HOME = cache
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false)
    expect(getDataDir()).toBe(join(home, '.hasna', 'economy'))
  })

  test('HASNA_ECONOMY_HOME exact override wins over both roots', () => {
    isolateHome()
    const override = mkdtempSync(join(tmpdir(), 'economy-hasna-home-'))
    cleanups.push(override)
    const base = mkdtempSync(join(tmpdir(), 'economy-data-home2-'))
    cleanups.push(base)
    process.env.HASNA_DATA_HOME = base // would adopt the XDG root, but the override must win
    process.env.HASNA_ECONOMY_HOME = override
    expect(getExactDataRoot()).toBe(override)
    expect(getDataDir()).toBe(override)
    expect(getDbPath()).toBe(join(override, 'economy.db'))
  })

  test('ECONOMY_HOME exact override wins over both roots', () => {
    isolateHome()
    const override = mkdtempSync(join(tmpdir(), 'economy-home-'))
    cleanups.push(override)
    process.env.ECONOMY_HOME = override
    expect(getExactDataRoot()).toBe(override)
    expect(getDataDir()).toBe(override)
  })

  test('an empty exact-app override is treated as unset', () => {
    const home = isolateHome()
    process.env.ECONOMY_HOME = ''
    expect(getExactDataRoot()).toBeUndefined()
    expect(getDataDir()).toBe(join(home, '.hasna', 'economy'))
  })

  test('HASNA_ECONOMY_DB_PATH still wins over every data root', () => {
    isolateHome()
    const override = mkdtempSync(join(tmpdir(), 'economy-db-override-'))
    cleanups.push(override)
    const base = mkdtempSync(join(tmpdir(), 'economy-data-home3-'))
    cleanups.push(base)
    process.env.HASNA_DATA_HOME = base
    const explicit = join(override, 'explicit.db')
    process.env.HASNA_ECONOMY_DB_PATH = explicit
    expect(getDbPath()).toBe(explicit)
  })

  test('default run never creates the resolver (XDG) data root', () => {
    const home = isolateHome()
    getDataDir()
    expect(existsSync(join(home, '.hasna', 'economy'))).toBe(true) // legacy created as the effective root
    expect(existsSync(join(home, '.local', 'share', 'hasna', 'economy'))).toBe(false) // XDG never created
  })

  test('getDataDir creates the adopted resolver data root once HASNA_DATA_HOME is set', () => {
    const home = isolateHome()
    const base = mkdtempSync(join(tmpdir(), 'economy-data-home4-'))
    cleanups.push(base)
    process.env.HASNA_DATA_HOME = base
    const dir = getDataDir()
    expect(dir).toBe(join(base, 'economy'))
    expect(existsSync(dir)).toBe(true)
    expect(existsSync(join(home, '.hasna', 'economy'))).toBe(false) // legacy never created
  })
})
