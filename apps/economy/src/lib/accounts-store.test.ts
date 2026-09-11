import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { __resetAccountsLocalNotice, resolveStore, type ResolveAccountsStoreOptions } from './accounts-store.js'

// Fail-closed regression suite for the vendored accounts registry store
// (accounts-store.ts): the local JSON registry is selected ONLY by "no
// credential AND no authority configure the accounts API"; any
// configured-but-unusable API configuration must THROW, never silently
// degrade to local attribution (hasna/apps#1720; the old catch-all fell back
// to local on every error — the false green the fail-closed ruling ends).

const roots: string[] = []
const envKeys = [
  'ACCOUNTS_API_KEY',
  'ACCOUNTS_API_URL',
  'ACCOUNTS_STORE_PATH',
  'HASNA_ACCOUNTS_API_KEY',
  'HASNA_ACCOUNTS_API_URL',
  'HASNA_ACCOUNTS_API_KEY_OVERRIDE',
  'HASNA_ACCOUNTS_API_KEY_REF',
  'HASNA_ACCOUNTS_STORAGE_MODE',
  'ACCOUNTS_STORAGE_MODE',
  'HASNA_ACCOUNTS_MODE',
  'ACCOUNTS_MODE',
  'HASNA_PROFILE',
  'HASNA_ECONOMY_LOCAL',
  'ECONOMY_LOCAL',
  'HOME',
  'HASNA_HOME',
  'HASNA_CONFIG_HOME',
  'HASNA_STATION',
  'USER',
] as const
const originalEnv = new Map<string, string | undefined>()
for (const key of envKeys) originalEnv.set(key, process.env[key])

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'economy-accounts-store-test-'))
  roots.push(root)
  return root
}

function withScrubbedEnv<T>(fn: () => T): T {
  for (const key of envKeys) delete process.env[key]
  process.env['HOME'] = makeRoot()
  process.env['HASNA_HOME'] = makeRoot()
  return fn()
}

beforeEach(() => {
  __resetAccountsLocalNotice()
})

afterEach(() => {
  for (const key of envKeys) {
    const original = originalEnv.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
  for (const root of roots) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
  roots.length = 0
})

const noOptions: ResolveAccountsStoreOptions = { credentials: {} }

describe('resolveStore fails closed on accounts API misconfiguration', () => {
  // Fleet-alignment ruling d (2026-09-11): with no accounts credential and no
  // economy local opt-in, the on-box JSON registry is NOT read. Attribution is
  // absent (transport 'none') and the refusal is announced once on stderr —
  // this was the last silent-local branch in the package.
  test('nothing configured anywhere REFUSES the on-box registry — and says so once on stderr', () => {
    __resetAccountsLocalNotice()
    const lines: string[] = []
    const originalWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string) => {
      lines.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      const store = withScrubbedEnv(() => resolveStore(process.env, noOptions))
      expect(store.transport).toBe('none')
    } finally {
      process.stderr.write = originalWrite
    }
    expect(lines.join('')).toContain('is NOT read without HASNA_ECONOMY_LOCAL=1')
    expect(lines.join('')).toContain('hasna.credentials.accounts.api-key')
  })

  test('the refusing store reads no on-box file: no profiles, only the built-in tools', async () => {
    const store = withScrubbedEnv(() => resolveStore(process.env, noOptions))
    expect(store.transport).toBe('none')
    expect(await store.listProfiles()).toEqual([])
    expect(await store.findProfile('anything')).toBeUndefined()
    expect(await store.currentProfile('claude')).toBeUndefined()
    expect((await store.listTools()).length).toBeGreaterThan(0)
  })

  test('the explicit economy local opt-in restores the on-box registry — and announces it once', () => {
    __resetAccountsLocalNotice()
    const lines: string[] = []
    const originalWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string) => {
      lines.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      const store = withScrubbedEnv(() => {
        process.env['HASNA_ECONOMY_LOCAL'] = '1'
        return resolveStore(process.env, noOptions)
      })
      expect(store.transport).toBe('local')
    } finally {
      process.stderr.write = originalWrite
    }
    expect(lines.join('')).toContain('accounts: LOCAL mode')
  })

  test('nothing configured anywhere performs no fetch', async () => {
    const seen: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(typeof input === 'string' ? input : String(input))
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    try {
      const store = withScrubbedEnv(() => resolveStore(process.env, noOptions))
      await store.listTools()
    } finally {
      globalThis.fetch = originalFetch
    }
    expect(seen).toEqual([])
  })

  test('a URL without a key is a MISCONFIGURATION — it throws instead of silently serving the local registry', () => {
    expect(() =>
      withScrubbedEnv(() => {
        process.env['HASNA_ACCOUNTS_API_URL'] = 'https://accounts.example.test'
        resolveStore(process.env, noOptions)
      }),
    ).toThrow(/no API key could be resolved/)
  })

  test('a blank deliberate override is never resolved around to the local registry', () => {
    expect(() =>
      withScrubbedEnv(() => {
        process.env['HASNA_ACCOUNTS_API_KEY_OVERRIDE'] = ''
        resolveStore(process.env, noOptions)
      }),
    ).toThrow(/HASNA_ACCOUNTS_API_KEY_OVERRIDE is set but empty/)
  })

  test('a secrets-vault pointer is refused loudly — the sync store cannot complete it', () => {
    expect(() =>
      withScrubbedEnv(() => {
        process.env['HASNA_ACCOUNTS_API_KEY_REF'] = 'hasna/apps/accounts/live/api_key'
        resolveStore(process.env, noOptions)
      }),
    ).toThrow(/secrets-vault item/)
  })

  test('a valid credential resolves the API store — never local', () => {
    const store = withScrubbedEnv(() => {
      process.env['HASNA_ACCOUNTS_API_URL'] = 'https://accounts.example.test'
      process.env['HASNA_ACCOUNTS_API_KEY'] = 'hasna_accounts_testkey_0000'
      return resolveStore(process.env, noOptions)
    })
    expect(store.transport).toBe('api')
  })
})