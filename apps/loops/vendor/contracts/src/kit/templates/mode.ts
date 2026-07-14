// Storage-mode resolution for the vendored Hasna storage kit.
//
// Self-contained copy of the @hasna/contracts `mode.ts` contract so the
// generated kit has zero runtime dependency on the contracts package. Keep
// this in lockstep with the contract; regenerate the kit to pick up changes.
//
// Amendment A1 (PURE REMOTE): there are exactly two runtime modes.
//   - `local` : SQLite at ~/.hasna/<name>/<name>.db is authoritative.
//   - `cloud` : reads AND writes go directly to the app's cloud Postgres.
// There is no compatibility mode vocabulary.

export const STORAGE_MODES = ["local", "cloud"] as const;
export type StorageMode = (typeof STORAGE_MODES)[number];

export type Env = Record<string, string | undefined>;

export interface StorageModeNormalization {
  mode: StorageMode;
}

/**
 * Normalize a raw storage-mode string to the `local | cloud` runtime enum.
 * Accept only the canonical local/cloud values.
 */
export function normalizeStorageMode(value: string): StorageModeNormalization {
  const normalized = value.trim();
  if (normalized === "local") return { mode: "local" };
  if (normalized === "cloud") return { mode: "cloud" };
  throw new Error(`Unknown storage mode: ${value}. Use local or cloud.`);
}

/** Upper-snake env token for an app name, e.g. `todos` -> `TODOS`. */
export function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}

export interface StorageEnvKeys {
  /** Canonical storage mode key. */
  modeKeys: string[];
  /** Canonical database URL key. */
  databaseUrlKeys: string[];
}

/** Resolve the canonical env-key spec for an app's storage config. */
export function storageEnvKeys(name: string): StorageEnvKeys {
  const token = envToken(name);
  return {
    modeKeys: [`HASNA_${token}_STORAGE_MODE`],
    databaseUrlKeys: [`HASNA_${token}_DATABASE_URL`],
  };
}

function firstEnv(env: Env, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

export interface StorageModeResolution {
  mode: StorageMode;
  /** Env key the mode came from, or `"default"`. */
  source: string;
  databaseUrlPresent: boolean;
  /** Env key the database URL came from, or `null`. */
  databaseUrlSource: string | null;
  warning: string | null;
}

/**
 * Resolve an app's storage mode from the environment per the contract env spec.
 * Unset mode means `local`. Never reads secret values.
 */
export function resolveStorageMode(name: string, env: Env = process.env): StorageModeResolution {
  const { modeKeys, databaseUrlKeys } = storageEnvKeys(name);
  const dbHit = firstEnv(env, databaseUrlKeys);
  const databaseUrlPresent = Boolean(dbHit);
  const databaseUrlSource = dbHit ? dbHit.key : null;

  const modeHit = firstEnv(env, modeKeys);
  if (!modeHit) {
    return {
      mode: "local",
      source: "default",
      databaseUrlPresent,
      databaseUrlSource,
      warning: null,
    };
  }

  const { mode } = normalizeStorageMode(modeHit.value);
  const warnings: string[] = [];
  if (mode === "cloud" && !databaseUrlPresent) {
    warnings.push(`cloud mode needs ${databaseUrlKeys[0]} (PURE REMOTE: reads and writes go to cloud Postgres).`);
  }

  return {
    mode,
    source: modeHit.key,
    databaseUrlPresent,
    databaseUrlSource,
    warning: warnings.length > 0 ? warnings.join(" ") : null,
  };
}

/**
 * Resolve the canonical database URL value for an app. Returns `null` when
 * unset. The caller is responsible for never
 * logging the returned value.
 */
export function resolveDatabaseUrl(name: string, env: Env = process.env): string | null {
  const { databaseUrlKeys } = storageEnvKeys(name);
  const hit = firstEnv(env, databaseUrlKeys);
  return hit ? hit.value : null;
}
