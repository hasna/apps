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

export const STORAGE_DATABASE_ENV = ["HASNA_BRAINS_DATABASE_URL", "BRAINS_DATABASE_URL"] as const;

export const STORAGE_MODE_ENV = ["HASNA_BRAINS_STORAGE_MODE", "BRAINS_STORAGE_MODE"] as const;

const STORAGE_CONFIG_PATH = join(homedir(), ".hasna", "brains", "storage", "config.json");

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

export function getStorageDatabaseUrl(): string | undefined {
  return firstEnv(STORAGE_DATABASE_ENV);
}

export function getStorageConfig(): StorageConfig {
  const config: StorageConfig = {
    mode: "local",
    rds: {
      host: "",
      port: 5432,
      username: "",
      password_env: "BRAINS_DATABASE_PASSWORD",
      ssl: true,
    },
  };

  if (existsSync(STORAGE_CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(STORAGE_CONFIG_PATH, "utf-8")) as Partial<StorageConfig> & { mode?: StorageMode };
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

export function getStorageConnectionString(dbName = "brains"): string {
  const direct = getStorageDatabaseUrl();
  if (direct) return direct;

  const config = getStorageConfig();
  const { host, port, username, password_env, ssl } = config.rds;
  if (!host || !username) {
    throw new Error("Remote storage database is not configured. Set HASNA_BRAINS_DATABASE_URL or configure ~/.hasna/brains/storage/config.json.");
  }

  const password = process.env[password_env];
  if (!password) {
    throw new Error(`Remote storage database password is not set. Export ${password_env}.`);
  }

  const sslParam = ssl ? "?sslmode=require" : "";
  return `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/${dbName}${sslParam}`;
}
