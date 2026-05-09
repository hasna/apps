import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getDataDir } from '../db/database.js'

function getConfigPath(): string {
  return process.env['HASNA_ECONOMY_CONFIG_PATH'] ?? join(getDataDir(), 'config.json')
}

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
    const configPath = getConfigPath()
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8')
      return { ...DEFAULTS, ...JSON.parse(raw) }
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

export function saveConfig(config: EconomyConfig): void {
  const configPath = getConfigPath()
  const dir = configPath.substring(0, configPath.lastIndexOf('/'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
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
