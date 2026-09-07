import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveAccountForAgent, withAccount } from './accounts.js'

const roots: string[] = []
const envKeys = [
  'ACCOUNTS_API_KEY',
  'ACCOUNTS_API_URL',
  'ACCOUNTS_STORE_PATH',
  'CODEX_HOME',
  'ECONOMY_CODEX_ACCOUNT',
  'ECONOMY_ACCOUNT',
  'HASNA_ACCOUNTS_API_KEY',
  'HASNA_ACCOUNTS_API_URL',
  'HASNA_ACCOUNTS_STRICT_ROOT_COMPAT',
  'HASNA_ACCOUNTS_STORAGE_MODE',
  'ACCOUNTS_STORAGE_MODE',
  'HASNA_ACCOUNTS_MODE',
  'ACCOUNTS_MODE',
  'HOME',
  'HASNA_HOME',
] as const
const originalEnv = new Map<string, string | undefined>()
const originalFetch = globalThis.fetch

for (const key of envKeys) originalEnv.set(key, process.env[key])

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'economy-accounts-test-'))
  roots.push(root)
  return root
}

beforeEach(() => {
  globalThis.fetch = originalFetch
  for (const key of envKeys) delete process.env[key]
  // The @hasna/contracts accounts chain reads `~/.hasna/accounts/config/credentials`
  // under HOME / HASNA_HOME, and a station that already received a real
  // credentials file must not outrank the fixture env: anchor both roots at an
  // empty temp dir so the resolver's disk tier performs no read.
  process.env['HOME'] = makeRoot()
  process.env['HASNA_HOME'] = makeRoot()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of envKeys) {
    const original = originalEnv.get(key)
    if (original == null) delete process.env[key]
    else process.env[key] = original
  }
  for (const root of roots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveAccountForAgent', () => {
  test('uses explicit account override first', async () => {
    process.env['ECONOMY_CODEX_ACCOUNT'] = 'codex:work'

    const account = await resolveAccountForAgent('codex')

    expect(account).toEqual({
      account_key: 'codex:work',
      account_tool: 'codex',
      account_name: 'work',
      account_source: 'override',
    })
  })

  test('matches accounts profiles by tool env dir', async () => {
    const root = makeRoot()
    const profileDir = join(root, 'profiles', 'codex', 'client')
    process.env['ACCOUNTS_STORE_PATH'] = join(root, 'accounts.json')
    process.env['CODEX_HOME'] = profileDir
    writeFileSync(process.env['ACCOUNTS_STORE_PATH'], JSON.stringify({
      version: 1,
      current: {},
      applied: {},
      tools: [],
      profiles: [{
        name: 'client',
        tool: 'codex',
        email: 'client@example.com',
        dir: profileDir,
        createdAt: '2026-06-04T00:00:00.000Z',
      }],
    }))

    const account = await resolveAccountForAgent('codex')

    expect(account).toEqual({
      account_key: 'codex:client@example.com',
      account_tool: 'codex',
      account_name: 'client',
      account_email: 'client@example.com',
      account_source: 'env',
    })
  })

  test('matches hosted profiles through the async accounts store in strict root mode', async () => {
    const profileDir = '/hosted/profiles/codex/account003'
    process.env['CODEX_HOME'] = profileDir
    process.env['HASNA_ACCOUNTS_API_URL'] = 'https://accounts.example.test'
    process.env['HASNA_ACCOUNTS_API_KEY'] = 'hasna_accounts_testkey_0000'
    process.env['HASNA_ACCOUNTS_STRICT_ROOT_COMPAT'] = '1'
    globalThis.fetch = (async (input) => {
      const url = String(input)
      if (url.endsWith('/v1/tools')) {
        return Response.json({ tools: [] })
      }
      if (url.includes('/v1/accounts?') && url.includes('tool=codex')) {
        return Response.json({
          accounts: [{
            name: 'account003',
            tool: 'codex',
            email: 'account003@example.com',
            dir: profileDir,
            createdAt: '2026-06-04T00:00:00.000Z',
          }],
        })
      }
      return Response.json({ error: 'not found' }, { status: 404 })
    }) as typeof fetch

    const account = await resolveAccountForAgent('codex')

    expect(account).toEqual({
      account_key: 'codex:account003@example.com',
      account_tool: 'codex',
      account_name: 'account003',
      account_email: 'account003@example.com',
      account_source: 'env',
    })
  })

  test('rejects a retired storage-mode variable on the client accounts store', async () => {
    await expect(resolveAccountForAgent('codex', {
      HASNA_ACCOUNTS_STORAGE_MODE: 'cloud',
    })).rejects.toThrow(/HASNA_ACCOUNTS_STORAGE_MODE was removed/)
    await expect(resolveAccountForAgent('codex', {
      ACCOUNTS_MODE: 'local',
    })).rejects.toThrow(/ACCOUNTS_MODE was removed/)
  })

  test('routes to the API from URL + key alone, without any mode variable', async () => {
    const profileDir = '/hosted/profiles/codex/account004'
    process.env['CODEX_HOME'] = profileDir
    process.env['HASNA_ACCOUNTS_API_URL'] = 'https://accounts.example.test'
    process.env['HASNA_ACCOUNTS_API_KEY'] = 'hasna_accounts_testkey_0001'
    globalThis.fetch = (async (input) => {
      const url = String(input)
      if (url.endsWith('/v1/tools')) {
        return Response.json({ tools: [] })
      }
      if (url.includes('/v1/accounts?') && url.includes('tool=codex')) {
        return Response.json({
          accounts: [{
            name: 'account004',
            tool: 'codex',
            email: 'account004@example.com',
            dir: profileDir,
            createdAt: '2026-06-04T00:00:00.000Z',
          }],
        })
      }
      return Response.json({ error: 'not found' }, { status: 404 })
    }) as typeof fetch

    const account = await resolveAccountForAgent('codex')

    expect(account).toEqual({
      account_key: 'codex:account004@example.com',
      account_tool: 'codex',
      account_name: 'account004',
      account_email: 'account004@example.com',
      account_source: 'env',
    })
  })

  test('falls back to the current profile for a supported tool', async () => {
    const root = makeRoot()
    const profileDir = join(root, 'profiles', 'claude', 'work')
    process.env['ACCOUNTS_STORE_PATH'] = join(root, 'accounts.json')
    writeFileSync(process.env['ACCOUNTS_STORE_PATH'], JSON.stringify({
      version: 1,
      current: { claude: 'work' },
      applied: {},
      tools: [],
      profiles: [{
        name: 'work',
        tool: 'claude',
        dir: profileDir,
        createdAt: '2026-06-04T00:00:00.000Z',
      }],
    }))

    const account = await resolveAccountForAgent('claude')

    expect(account).toMatchObject({
      account_key: 'claude:work',
      account_tool: 'claude',
      account_name: 'work',
      account_source: 'current',
    })
  })

  test('uses accounts built-ins for non-Claude agent profiles', async () => {
    const root = makeRoot()
    const profileDir = join(root, 'profiles', 'gemini', 'studio')
    process.env['ACCOUNTS_STORE_PATH'] = join(root, 'accounts.json')
    writeFileSync(process.env['ACCOUNTS_STORE_PATH'], JSON.stringify({
      version: 1,
      current: { gemini: 'studio' },
      applied: {},
      tools: [],
      profiles: [{
        name: 'studio',
        tool: 'gemini',
        email: 'studio@example.com',
        dir: profileDir,
        createdAt: '2026-06-04T00:00:00.000Z',
      }],
    }))

    const account = await resolveAccountForAgent('gemini')

    expect(account).toEqual({
      account_key: 'gemini:studio@example.com',
      account_tool: 'gemini',
      account_name: 'studio',
      account_email: 'studio@example.com',
      account_source: 'current',
    })
  })
})

describe('withAccount', () => {
  test('adds account fields when attribution is present', () => {
    const record = withAccount({ id: 'row-1' }, {
      account_key: 'claude:work',
      account_tool: 'claude',
      account_name: 'work',
      account_source: 'current',
    })

    expect(record).toMatchObject({
      id: 'row-1',
      account_key: 'claude:work',
      account_tool: 'claude',
      account_name: 'work',
      account_source: 'current',
    })
  })
})
