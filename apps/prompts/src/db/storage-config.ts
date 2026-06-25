import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

export type StorageMode = "local" | "remote" | "hybrid"

export interface StorageConfig {
  mode: StorageMode
  rds: {
    host: string
    port: number
    username: string
    password_env: string
    ssl: boolean
  }
}

export interface StorageEnv {
  name: string
}

const STORAGE_CONFIG_PATH = join(homedir(), ".hasna", "prompts", "storage", "config.json")

export const PROMPTS_STORAGE_ENV = "HASNA_PROMPTS_DATABASE_URL"
export const PROMPTS_STORAGE_FALLBACK_ENV = "PROMPTS_DATABASE_URL"
export const PROMPTS_STORAGE_MODE_ENV = "HASNA_PROMPTS_STORAGE_MODE"
export const PROMPTS_STORAGE_MODE_FALLBACK_ENV = "PROMPTS_STORAGE_MODE"
export const STORAGE_DATABASE_ENV = [PROMPTS_STORAGE_ENV, PROMPTS_STORAGE_FALLBACK_ENV] as const
export const STORAGE_MODE_ENV = [PROMPTS_STORAGE_MODE_ENV, PROMPTS_STORAGE_MODE_FALLBACK_ENV] as const

function firstEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

function normalizeMode(value: string | undefined): StorageMode | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === "local" || normalized === "remote" || normalized === "hybrid") return normalized
  return null
}

export function getStorageDatabaseUrl(): string | undefined {
  return firstEnv(STORAGE_DATABASE_ENV)
}

export function getStorageDatabaseEnvName(): (typeof STORAGE_DATABASE_ENV)[number] | null {
  for (const name of STORAGE_DATABASE_ENV) {
    if (firstEnv([name])) return name
  }
  return null
}

export function getStorageDatabaseEnv(): StorageEnv | null {
  const name = getStorageDatabaseEnvName()
  return name ? { name } : null
}

export function getStorageConfig(): StorageConfig {
  const base: StorageConfig = {
    mode: "local",
    rds: {
      host: "",
      port: 5432,
      username: "",
      password_env: "PROMPTS_DATABASE_PASSWORD",
      ssl: true,
    },
  }

  if (existsSync(STORAGE_CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(STORAGE_CONFIG_PATH, "utf-8")) as Partial<StorageConfig>
      base.mode = normalizeMode(raw.mode) ?? base.mode
      base.rds = { ...base.rds, ...(raw.rds ?? {}) }
    } catch {
      // Ignore malformed global storage config and fall back to local mode.
    }
  }

  const modeOverride = normalizeMode(firstEnv(STORAGE_MODE_ENV))
  if (modeOverride) {
    base.mode = modeOverride
  } else if (getStorageDatabaseUrl() && base.mode === "local") {
    base.mode = "hybrid"
  }

  return base
}

export function getStorageConnectionString(dbName = "prompts"): string {
  const direct = getStorageDatabaseUrl()
  if (direct) return direct

  const config = getStorageConfig()
  const { host, port, username, password_env, ssl } = config.rds
  if (!host || !username) {
    throw new Error("Remote storage database is not configured. Set HASNA_PROMPTS_DATABASE_URL or configure ~/.hasna/prompts/storage/config.json.")
  }

  const password = process.env[password_env]
  if (!password) {
    throw new Error(`Remote storage database password is not set. Export ${password_env}.`)
  }

  const sslParam = ssl ? "?sslmode=require" : ""
  return `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/${dbName}${sslParam}`
}

export function getConnectionString(dbName = "prompts"): string {
  return getStorageConnectionString(dbName)
}
