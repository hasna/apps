import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { clearActiveModel, DEFAULT_MODEL, getActiveModel, setActiveModel } from './model-config.js'

let root: string
let configPath: string
let originalConfigPath: string | undefined

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

beforeEach(() => {
  root = join(tmpdir(), `economy-model-config-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  configPath = join(root, 'nested', 'config.json')
  originalConfigPath = process.env['HASNA_ECONOMY_CONFIG_PATH']
  process.env['HASNA_ECONOMY_CONFIG_PATH'] = configPath
})

afterEach(() => {
  restoreEnv('HASNA_ECONOMY_CONFIG_PATH', originalConfigPath)
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
}

describe('model config', () => {
  it('uses the default model when no active model is configured', () => {
    expect(getActiveModel()).toBe(DEFAULT_MODEL)
  })

  it('stores and clears the active model in the configured economy config path', () => {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, JSON.stringify({ port: 4567, 'auto-sync': false }) + '\n')

    setActiveModel('ft:gpt-4o-mini:economy')

    expect(getActiveModel()).toBe('ft:gpt-4o-mini:economy')
    expect(readConfig()).toMatchObject({
      port: 4567,
      'auto-sync': false,
      activeModel: 'ft:gpt-4o-mini:economy',
    })

    clearActiveModel()

    expect(getActiveModel()).toBe(DEFAULT_MODEL)
    expect(readConfig()).toMatchObject({ port: 4567, 'auto-sync': false })
    expect(readConfig()).not.toHaveProperty('activeModel')
  })

  it('falls back to the default model when the config file is invalid', () => {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, '{bad json')

    expect(getActiveModel()).toBe(DEFAULT_MODEL)
  })
})
