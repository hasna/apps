import { existsSync, readFileSync } from "node:fs";
import { getBrainsStorageConfigPath } from "../lib/app-home.js";

export interface StorageConfig {
  postgres: {
    host: string;
    port: number;
    username: string;
    password_env: string;
    ssl: boolean;
  };
}

export const STORAGE_DATABASE_ENV = ["HASNA_BRAINS_DATABASE_URL", "BRAINS_DATABASE_URL"] as const;

/**
 * Retired storage-mode variables. Any of them being SET — even to a blank
 * value — is an error, never a hint: silently ignoring it would keep the
 * split-brain drift the mode vocabulary caused (owner directive 2026-07-29;
 * knowledge k_ms5wv466_u0jidq).
 */
export const LEGACY_STORAGE_MODE_ENV = [
  "HASNA_BRAINS_STORAGE_MODE",
  "HASNA_BRAINS_MODE",
  "BRAINS_STORAGE_MODE",
  "BRAINS_MODE",
] as const;

type RawStorageConfig = Partial<StorageConfig> & { rds?: StorageConfig["postgres"] };

function firstEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

function firstDefinedEnvKey(env: NodeJS.ProcessEnv, names: readonly string[]): string | null {
  for (const name of names) {
    if (Object.hasOwn(env, name) && env[name] !== undefined) return name;
  }
  return null;
}

/**
 * Throw when a retired storage-mode variable is set. Naming the retired var
 * and the supported switches makes the error actionable without accepting the
 * value. Safe to call from any entry — it is a no-op when no legacy key is set.
 */
export function assertNoLegacyStorageMode(env: NodeJS.ProcessEnv = process.env): void {
  const legacyKey = firstDefinedEnvKey(env, LEGACY_STORAGE_MODE_ENV);
  if (!legacyKey) return;
  throw new Error(
    `${legacyKey} was removed. Deployment modes no longer exist: delete the storage-mode variable. ` +
      `The client uses the local SQLite store, or the HTTP API selected by ` +
      `HASNA_BRAINS_API_URL + HASNA_BRAINS_API_KEY. ` +
      `On the server, set HASNA_BRAINS_DATABASE_URL to select the postgresql backend, ` +
      `or leave it unset for sqlite.`,
  );
}

export function getStorageDatabaseUrl(): string | undefined {
  return firstEnv(STORAGE_DATABASE_ENV);
}

/**
 * The server data backend: `postgresql` when a DATABASE_URL is set, `sqlite`
 * otherwise. Runs the fail-loud ratchet first. Deployment modes no longer
 * exist; this presence switch is the only storage selection.
 */
export function getStorageBackend(): "sqlite" | "postgresql" {
  assertNoLegacyStorageMode();
  return getStorageDatabaseUrl() ? "postgresql" : "sqlite";
}

export function getStorageConfig(): StorageConfig {
  assertNoLegacyStorageMode();
  const config: StorageConfig = {
    postgres: {
      host: "",
      port: 5432,
      username: "",
      password_env: "BRAINS_DATABASE_PASSWORD",
      ssl: true,
    },
  };

  const storageConfigPath = getBrainsStorageConfigPath();
  if (existsSync(storageConfigPath)) {
    try {
      const raw = JSON.parse(readFileSync(storageConfigPath, "utf-8")) as RawStorageConfig;
      config.postgres = { ...config.postgres, ...(raw.postgres ?? raw.rds ?? {}) };
    } catch {
      // Ignore malformed storage config.
    }
  }

  return config;
}

export function getStorageConnectionString(dbName = "brains"): string {
  assertNoLegacyStorageMode();
  const direct = getStorageDatabaseUrl();
  if (direct) return direct;

  const config = getStorageConfig();
  const { host, port, username, password_env, ssl } = config.postgres;
  if (!host || !username) {
    throw new Error(`Remote storage database is not configured. Set HASNA_BRAINS_DATABASE_URL or configure ${getBrainsStorageConfigPath()}.`);
  }

  const password = process.env[password_env];
  if (!password) {
    throw new Error(`Remote storage database password is not set. Export ${password_env}.`);
  }

  const sslParam = ssl ? "?sslmode=require" : "";
  return `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/${dbName}${sslParam}`;
}
