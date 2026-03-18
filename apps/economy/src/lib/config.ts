import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CONFIG_PATH = join(homedir(), '.economy', 'config.json')

export interface EconomyConfig {
  port: number
  'default-period': string
  'auto-sync': boolean
  'sync-interval': number
  'alert-thresholds': number[]
  'webhook-url': string | null
}

const DEFAULTS: EconomyConfig = {
  port: 3456,
  'default-period': 'today',
  'auto-sync': true,
  'sync-interval': 30,
  'alert-thresholds': [5, 10, 25, 50, 100],
  'webhook-url': null,
}

export function loadConfig(): EconomyConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, 'utf-8')
      return { ...DEFAULTS, ...JSON.parse(raw) }
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

export function saveConfig(config: EconomyConfig): void {
  const dir = CONFIG_PATH.substring(0, CONFIG_PATH.lastIndexOf('/'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
}

export function getConfigValue(key: string): unknown {
  const config = loadConfig()
  return (config as unknown as Record<string, unknown>)[key] ?? null
}

export function setConfigValue(key: string, value: string): void {
  const config = loadConfig()
  // Parse value type
  let parsed: unknown = value
  if (value === 'true') parsed = true
  else if (value === 'false') parsed = false
  else if (value === 'null') parsed = null
  else if (!isNaN(Number(value))) parsed = Number(value)
  else if (value.startsWith('[')) { try { parsed = JSON.parse(value) } catch { /* keep string */ } }
  ;(config as unknown as Record<string, unknown>)[key] = parsed
  saveConfig(config)
}
