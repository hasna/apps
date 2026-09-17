import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MEMORY_REGISTRY_PATH,
  resolveRegistryDbPath,
  resetDefaultStoreForTests,
} from './agent-registry.js'
import { resetEconomyCloudStorageCache } from '../lib/cloud-storage.js'

const managedKeys = [
  'HOME',
  'HASNA_HOME',
  'HASNA_CONFIG_HOME',
  'HASNA_ECONOMY_API_URL',
  'HASNA_ECONOMY_API_KEY',
  'ECONOMY_API_URL',
  'ECONOMY_API_KEY',
  'HASNA_ECONOMY_LOCAL',
  'ECONOMY_LOCAL',
  'HASNA_AGENT_REGISTRY_DB_PATH',
] as const

let saved: Record<string, string | undefined>
let home: string

beforeEach(() => {
  saved = Object.fromEntries(managedKeys.map((key) => [key, process.env[key]]))
  for (const key of managedKeys) delete process.env[key]
  home = mkdtempSync(join(tmpdir(), 'economy-registry-path-'))
  process.env.HOME = home
  process.env.HASNA_HOME = join(home, '.hasna')
  resetDefaultStoreForTests()
  resetEconomyCloudStorageCache()
})

afterEach(() => {
  resetDefaultStoreForTests()
  resetEconomyCloudStorageCache()
  for (const key of managedKeys) {
    const value = saved[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(home, { recursive: true, force: true })
})

describe('agent registry path follows the resolved economy authority lane', () => {
  test('hosted transport ignores a persistent path override', () => {
    process.env.HASNA_ECONOMY_API_URL = 'https://api.hasna.com/economy'
    process.env.HASNA_ECONOMY_API_KEY = 'fixture-hosted-key'
    process.env.HASNA_AGENT_REGISTRY_DB_PATH = join(home, 'must-not-open.db')

    expect(resolveRegistryDbPath()).toBe(MEMORY_REGISTRY_PATH)
  })

  test('the explicit local lane may honor a persistent path override', () => {
    const selected = join(home, 'local-registry.db')
    process.env.HASNA_ECONOMY_LOCAL = '1'
    process.env.HASNA_AGENT_REGISTRY_DB_PATH = selected

    expect(resolveRegistryDbPath()).toBe(selected)
  })
})
