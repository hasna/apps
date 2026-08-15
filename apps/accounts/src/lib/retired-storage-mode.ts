// Advisory rejection of the retired storage-mode variables.
//
// Deployment modes no longer exist (owner directive 2026-07-29; knowledge
// k_ms5wv466_u0jidq). The client connects to the local JSON registry OR the
// HTTP API selected by HASNA_ACCOUNTS_API_URL + HASNA_ACCOUNTS_API_KEY; the
// server storage switch is `sqlite | postgresql` via
// HASNA_ACCOUNTS_DATABASE_URL.
//
// A STORAGE_MODE variable still set is SCRUBBED and reported as an advisory
// warning — never a crash, and never a transport hint. The package's own
// legacy fleet drop-in (`~/.config/environment.d/accounts-cloud.conf` on
// station images) exported HASNA_ACCOUNTS_STORAGE_MODE=cloud long after the
// vocabulary was retired, so a hard throw made every CLI invocation crash on
// machines carrying the drop-in. The value must not route anything (no mode
// branching), and it must not survive in the environment where a resolver
// could misread it (split-brain). Scrubbing matches the wrapped-engine
// precedent (`hasna-internal/platform/packages/engine-host`): scrub the stale
// name, then resolve by the canonical switches only.

const LEGACY_STORAGE_MODE_KEYS = [
  "HASNA_ACCOUNTS_STORAGE_MODE",
  "HASNA_ACCOUNTS_MODE",
  "ACCOUNTS_STORAGE_MODE",
  "ACCOUNTS_MODE",
] as const;

export const LEGACY_STORAGE_MODE_WARNING_CODE = "HASNA_ACCOUNTS_LEGACY_STORAGE_MODE_IGNORED";

const warnedKeys = new Set<string>();

/** Test hook: forget which retired keys already produced their warning. */
export function resetLegacyModeWarnings(): void {
  warnedKeys.clear();
}

/**
 * Scrub any retired storage-mode variable from the environment and emit one
 * advisory warning per key naming it. Safe to call from any entry (client
 * store resolution, server backend resolution) — a no-op when no legacy key is
 * set. Returns the names of the scrubbed keys.
 */
export function scrubLegacyStorageMode(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];
  for (const key of LEGACY_STORAGE_MODE_KEYS) {
    if (!Object.hasOwn(env, key)) continue;
    delete env[key];
    removed.push(key);
    if (warnedKeys.has(key)) continue;
    warnedKeys.add(key);
    process.emitWarning(
      `${key} is retired and was ignored: deployment modes no longer exist. ` +
        `The client uses the local registry, or the HTTP API selected by ` +
        `HASNA_ACCOUNTS_API_URL + HASNA_ACCOUNTS_API_KEY. ` +
        `On the server, set HASNA_ACCOUNTS_DATABASE_URL to select the postgresql backend, ` +
        `or leave it unset for sqlite.`,
      { code: LEGACY_STORAGE_MODE_WARNING_CODE },
    );
  }
  return removed;
}
