import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveAccountForAgent, withAccount } from './accounts.js'

const roots: string[] = []
const envKeys = [
  'ACCOUNTS_STORE_PATH',
  'CODEX_HOME',
  'ECONOMY_CODEX_ACCOUNT',
  'ECONOMY_ACCOUNT',
] as const
const originalEnv = new Map<string, string | undefined>()

for (const key of envKeys) originalEnv.set(key, process.env[key])

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'economy-accounts-test-'))
  roots.push(root)
  return root
}

afterEach(() => {
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
