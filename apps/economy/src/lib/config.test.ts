import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getConfigValue, loadConfig, saveConfig, setConfigValue } from './config.js'

let root: string
let configPath: string
const originalCwd = process.cwd()

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'economy-config-test-'))
  configPath = join(root, 'nested', 'config.json')
  process.env['HASNA_ECONOMY_CONFIG_PATH'] = configPath
})

afterEach(() => {
  process.chdir(originalCwd)
  delete process.env['HASNA_ECONOMY_CONFIG_PATH']
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('config', () => {
  it('loads defaults when no config file exists or JSON is invalid', () => {
    expect(loadConfig()).toMatchObject({
      port: 3456,
      'default-period': 'today',
      'auto-sync': true,
      'sync-interval': 30,
      'webhook-url': null,
    })

    mkdirSync(join(root, 'nested'), { recursive: true })
    writeFileSync(configPath, '{bad json')
    expect(loadConfig()['default-period']).toBe('today')
  })

  it('saves config to an override path and merges saved values with defaults', () => {
    saveConfig({
      port: 4567,
      'default-period': 'week',
      'auto-sync': false,
      'sync-interval': 15,
      'alert-thresholds': [50, 90],
      'webhook-url': 'https://hooks.example/economy',
    })

    expect(existsSync(configPath)).toBe(true)
    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toMatchObject({ port: 4567 })
    expect(loadConfig()).toMatchObject({
      port: 4567,
      'default-period': 'week',
      'auto-sync': false,
      'sync-interval': 15,
      'alert-thresholds': [50, 90],
    })
  })

  it('supports relative config override paths without an explicit directory', () => {
    process.chdir(root)
    process.env['HASNA_ECONOMY_CONFIG_PATH'] = 'config.json'

    setConfigValue('port', '7890')

    expect(existsSync(join(root, 'config.json'))).toBe(true)
    expect(getConfigValue('port')).toBe(7890)
  })

  it('sets and parses config values from CLI strings', () => {
    setConfigValue('auto-sync', 'false')
    setConfigValue('port', '4567')
    setConfigValue('webhook-url', 'null')
    setConfigValue('alert-thresholds', '[25,50,75]')
    setConfigValue('custom-string', '[not-json')

    expect(getConfigValue('auto-sync')).toBe(false)
    expect(getConfigValue('port')).toBe(4567)
    expect(getConfigValue('webhook-url')).toBeNull()
    expect(getConfigValue('alert-thresholds')).toEqual([25, 50, 75])
    expect(getConfigValue('custom-string')).toBe('[not-json')
    expect(getConfigValue('missing-key')).toBeNull()
  })
})
