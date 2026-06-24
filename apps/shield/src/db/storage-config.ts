import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type StorageMode = "local" | "remote" | "hybrid";

export interface StorageConfig {
  mode: StorageMode;
  rds: {
    host: string;
    port: number;
    username: string;
    password_env: string;
    ssl: boolean;
  };
}

export const SECURITY_STORAGE_ENV = {
  databaseUrl: "HASNA_SECURITY_DATABASE_URL",
  mode: "HASNA_SECURITY_STORAGE_MODE",
} as const;

export const SECURITY_STORAGE_FALLBACK_ENV = {
  databaseUrl: "SECURITY_DATABASE_URL",
  mode: "SECURITY_STORAGE_MODE",
} as const;

export const STORAGE_DATABASE_ENV = [
  SECURITY_STORAGE_ENV.databaseUrl,
  SECURITY_STORAGE_FALLBACK_ENV.databaseUrl,
] as const;

export const STORAGE_MODE_ENV = [
  SECURITY_STORAGE_ENV.mode,
  SECURITY_STORAGE_FALLBACK_ENV.mode,
] as const;

type SecurityStorageEnvKey = keyof typeof SECURITY_STORAGE_ENV;

export interface StorageEnv {
  name: string;
  deprecated: boolean;
}

const STORAGE_CONFIG_PATH = join(homedir(), ".hasna", "security", "storage", "config.json");

function normalizeMode(value: string | undefined): StorageMode | undefined {
  if (value === "local" || value === "hybrid" || value === "remote") return value;
  return undefined;
}

function firstEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

export function getStorageDatabaseEnv(): StorageEnv | null {
  for (const name of STORAGE_DATABASE_ENV) {
    if (process.env[name]?.trim()) return { name, deprecated: false };
  }
  return null;
}

function getStorageEnvName(key: SecurityStorageEnvKey): string {
  const canonical = SECURITY_STORAGE_ENV[key];
  const fallback = SECURITY_STORAGE_FALLBACK_ENV[key];
  return process.env[canonical]?.trim() || !process.env[fallback]?.trim() ? canonical : fallback;
}

export function getStorageDatabaseEnvName(): string {
  return getStorageEnvName("databaseUrl");
}

export function getStorageDatabaseUrl(): string | undefined {
  const env = getStorageDatabaseEnv();
  return env ? process.env[env.name]?.trim() || undefined : undefined;
}

export function getStorageConfig(): StorageConfig {
  const config: StorageConfig = {
    mode: "local",
    rds: {
      host: "",
      port: 5432,
      username: "",
      password_env: "SECURITY_DATABASE_PASSWORD",
      ssl: true,
    },
  };

  if (existsSync(STORAGE_CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(STORAGE_CONFIG_PATH, "utf-8")) as Partial<StorageConfig>;
      config.mode = normalizeMode(raw.mode) ?? config.mode;
      config.rds = { ...config.rds, ...(raw.rds ?? {}) };
    } catch {
      // Ignore malformed storage config and keep local mode.
    }
  }

  const modeOverride = firstEnv(STORAGE_MODE_ENV);
  const normalizedMode = normalizeMode(modeOverride);
  if (normalizedMode) {
    config.mode = normalizedMode;
  } else if (getStorageDatabaseUrl() && config.mode === "local") {
    config.mode = "hybrid";
  }

  return config;
}

export function getStorageConnectionString(dbName = "security"): string {
  const direct = getStorageDatabaseUrl();
  if (direct) return direct;

  const config = getStorageConfig();
  const { host, port, username, password_env, ssl } = config.rds;
  if (!host || !username) {
    throw new Error("Remote storage database is not configured. Set HASNA_SECURITY_DATABASE_URL or configure ~/.hasna/security/storage/config.json.");
  }

  const password = process.env[password_env];
  if (!password) {
    throw new Error(`Remote storage database password is not set. Export ${password_env}.`);
  }

  const sslParam = ssl ? "?sslmode=require" : "";
  return `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/${dbName}${sslParam}`;
}

export const getConnectionString = getStorageConnectionString;
