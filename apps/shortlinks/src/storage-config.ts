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

export interface StorageEnv {
  name: string;
}

export const SHORTLINKS_STORAGE_ENV = "HASNA_SHORTLINKS_DATABASE_URL";
export const SHORTLINKS_STORAGE_FALLBACK_ENV = "SHORTLINKS_DATABASE_URL";
export const SHORTLINKS_STORAGE_MODE_ENV = "HASNA_SHORTLINKS_STORAGE_MODE";
export const SHORTLINKS_STORAGE_MODE_FALLBACK_ENV = "SHORTLINKS_STORAGE_MODE";
export const STORAGE_DATABASE_ENV = [SHORTLINKS_STORAGE_ENV, SHORTLINKS_STORAGE_FALLBACK_ENV] as const;
export const STORAGE_MODE_ENV = [SHORTLINKS_STORAGE_MODE_ENV, SHORTLINKS_STORAGE_MODE_FALLBACK_ENV] as const;

export const CANONICAL_SHORTLINKS_RDS_CLUSTER = "postgres-compatible-database";
export const CANONICAL_SHORTLINKS_RDS_DATABASE = "shortlinks";
export const CANONICAL_SHORTLINKS_RDS_SECRET_PATH = "configured-by-environment";

export interface CanonicalShortlinksRdsConfig {
  cluster: typeof CANONICAL_SHORTLINKS_RDS_CLUSTER;
  database: typeof CANONICAL_SHORTLINKS_RDS_DATABASE;
  runtimeSecretPath: typeof CANONICAL_SHORTLINKS_RDS_SECRET_PATH;
  primaryEnv: typeof SHORTLINKS_STORAGE_ENV;
  fallbackEnv: typeof SHORTLINKS_STORAGE_FALLBACK_ENV;
}

export function getCanonicalShortlinksRdsConfig(): CanonicalShortlinksRdsConfig {
  return {
    cluster: CANONICAL_SHORTLINKS_RDS_CLUSTER,
    database: CANONICAL_SHORTLINKS_RDS_DATABASE,
    runtimeSecretPath: CANONICAL_SHORTLINKS_RDS_SECRET_PATH,
    primaryEnv: SHORTLINKS_STORAGE_ENV,
    fallbackEnv: SHORTLINKS_STORAGE_FALLBACK_ENV,
  };
}

const STORAGE_CONFIG_PATH = join(homedir(), ".hasna", "shortlinks", "storage", "config.json");

function normalizeMode(value: string | undefined): StorageMode | undefined {
  if (value === "local" || value === "hybrid" || value === "remote") return value;
  return undefined;
}

function firstEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function getStorageDatabaseUrl(): string | undefined {
  return firstEnv(STORAGE_DATABASE_ENV);
}

export function getStorageDatabaseEnvName(): (typeof STORAGE_DATABASE_ENV)[number] | null {
  for (const name of STORAGE_DATABASE_ENV) {
    if (firstEnv([name])) return name;
  }
  return null;
}

export function getStorageDatabaseEnv(): StorageEnv | null {
  const name = getStorageDatabaseEnvName();
  return name ? { name } : null;
}

export function getStorageConfig(): StorageConfig {
  const config: StorageConfig = {
    mode: "local",
    rds: {
      host: "",
      port: 5432,
      username: "",
      password_env: "SHORTLINKS_DATABASE_PASSWORD",
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

export function getStorageConnectionString(dbName = "shortlinks"): string {
  const direct = getStorageDatabaseUrl();
  if (direct) return direct;

  const config = getStorageConfig();
  const { host, port, username, password_env, ssl } = config.rds;
  if (!host || !username) {
    throw new Error("Remote storage database is not configured. Set HASNA_SHORTLINKS_DATABASE_URL or configure ~/.hasna/shortlinks/storage/config.json.");
  }

  const password = process.env[password_env];
  if (!password) {
    throw new Error(`Remote storage database password is not set. Export ${password_env}.`);
  }

  const sslParam = ssl ? "?sslmode=require" : "";
  return `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/${dbName}${sslParam}`;
}

export const getConnectionString = getStorageConnectionString;
