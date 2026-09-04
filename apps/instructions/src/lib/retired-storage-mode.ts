// Fail-loud rejection of the retired storage-mode variables.
//
// Deployment modes no longer exist (owner directive 2026-07-29; knowledge
// k_ms5wv466_u0jidq). The client uses the HTTP API selected by
// HASNA_INSTRUCTIONS_API_URL + HASNA_INSTRUCTIONS_API_KEY, and fails closed
// without it (owner directive 2026-09-04); the on-box SQLite store is opened
// only behind the explicit opt-in HASNA_INSTRUCTIONS_LOCAL=1. The server
// storage switch is `sqlite | postgresql` via HASNA_INSTRUCTIONS_DATABASE_URL.
// Any STORAGE_MODE variable still set is an error, never a hint: silently
// ignoring it would keep the split-brain drift the mode vocabulary caused.

const LEGACY_STORAGE_MODE_KEYS = [
  "HASNA_INSTRUCTIONS_STORAGE_MODE",
  "HASNA_INSTRUCTIONS_MODE",
  "INSTRUCTIONS_STORAGE_MODE",
  "INSTRUCTIONS_MODE",
] as const;

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
      `The client uses the HTTP API selected by ` +
      `HASNA_INSTRUCTIONS_API_URL + HASNA_INSTRUCTIONS_API_KEY, or — only with the explicit ` +
      `opt-in HASNA_INSTRUCTIONS_LOCAL=1 — the local SQLite store. ` +
      `On the server, set HASNA_INSTRUCTIONS_DATABASE_URL to select the postgresql backend, ` +
      `or leave it unset for sqlite.`,
  );
}
