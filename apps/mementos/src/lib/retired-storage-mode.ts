// Fail-loud rejection of the retired storage-mode variables.
//
// Deployment modes no longer exist (owner directive 2026-07-29; knowledge
// k_ms5wv466_u0jidq). The client connects to the local SQLite store OR the
// HTTP API selected by HASNA_MEMENTOS_API_URL + HASNA_MEMENTOS_API_KEY; the
// server storage switch is `sqlite | postgresql` via
// HASNA_MEMENTOS_DATABASE_URL. Any STORAGE_MODE variable still set is an
// error, never a hint: silently ignoring it would keep the split-brain drift
// the mode vocabulary caused.

const LEGACY_STORAGE_MODE_KEYS = [
  "HASNA_MEMENTOS_STORAGE_MODE",
  "HASNA_MEMENTOS_MODE",
  "MEMENTOS_STORAGE_MODE",
  "MEMENTOS_MODE",
] as const;

/** The retired storage-mode variable names, exported for tests and isolation harnesses. */
export { LEGACY_STORAGE_MODE_KEYS };

function firstDefinedEnvKey(env: NodeJS.ProcessEnv, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (Object.hasOwn(env, key) && env[key] !== undefined) return key;
  }
  return null;
}

/**
 * Throw when a retired storage-mode variable is set. Naming the retired var
 * and the supported switches makes the error actionable without accepting the
 * value. Safe to call from any entry (client store resolution, db guard,
 * server backend resolution) — it is a no-op when no legacy key is set.
 */
export function assertNoLegacyStorageMode(env: NodeJS.ProcessEnv = process.env): void {
  const legacyKey = firstDefinedEnvKey(env, LEGACY_STORAGE_MODE_KEYS);
  if (!legacyKey) return;
  throw new Error(
    `${legacyKey} was removed. Deployment modes no longer exist: delete the storage-mode variable. ` +
      `The client uses the local SQLite store, or the HTTP API selected by ` +
      `HASNA_MEMENTOS_API_URL + HASNA_MEMENTOS_API_KEY. ` +
      `On the server, set HASNA_MEMENTOS_DATABASE_URL to select the postgresql backend, ` +
      `or leave it unset for sqlite.`,
  );
}
