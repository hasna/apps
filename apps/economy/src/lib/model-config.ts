// Model config for @hasna/economy
// Reads/writes the active fine-tuned model ID from the economy data root (config.json;
// legacy ~/.hasna/economy until the @hasna/paths XDG data root is adopted)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { getDataDir } from '../db/database.js'

export const DEFAULT_MODEL = 'gpt-4o-mini'

interface EconomyModelConfig {
  activeModel?: string
  [key: string]: unknown
}

function getModelConfigPath(): string {
  return process.env['HASNA_ECONOMY_CONFIG_PATH'] ?? join(getDataDir(), 'config.json')
}

function loadConfig(): EconomyModelConfig {
  try {
    const configPath = getModelConfigPath()
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, 'utf-8')) as EconomyModelConfig
    }
  } catch {
    // ignore parse errors
  }
  return {}
}

function saveConfig(config: EconomyModelConfig): void {
  const configPath = getModelConfigPath()
  const dir = dirname(configPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
}

/** Returns the active fine-tuned model ID, or DEFAULT_MODEL if none set. */
export function getActiveModel(): string {
  return loadConfig().activeModel ?? DEFAULT_MODEL
}

/** Persists the active fine-tuned model ID to the economy data root (config.json). */
export function setActiveModel(id: string): void {
  const config = loadConfig()
  config.activeModel = id
  saveConfig(config)
}

/** Clears the active model, falling back to DEFAULT_MODEL. */
export function clearActiveModel(): void {
  const config = loadConfig()
  delete config.activeModel
  saveConfig(config)
}
