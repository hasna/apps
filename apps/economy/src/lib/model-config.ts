// Model config for @hasna/economy
// Reads/writes the active fine-tuned model ID from ~/.hasna/economy/config.json

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getDataDir } from '../db/database.js'

export const DEFAULT_MODEL = 'gpt-4o-mini'

const CONFIG_PATH = join(getDataDir(), 'config.json')

interface EconomyModelConfig {
  activeModel?: string
  [key: string]: unknown
}

function loadConfig(): EconomyModelConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as EconomyModelConfig
    }
  } catch {
    // ignore parse errors
  }
  return {}
}

function saveConfig(config: EconomyModelConfig): void {
  const dir = getDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
}

/** Returns the active fine-tuned model ID, or DEFAULT_MODEL if none set. */
export function getActiveModel(): string {
  return loadConfig().activeModel ?? DEFAULT_MODEL
}

/** Persists the active fine-tuned model ID to ~/.hasna/economy/config.json. */
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
