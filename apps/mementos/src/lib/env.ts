/**
 * Env-var naming standard (2026-08-24): harness apps use the HASNA_<APP>_
 * prefix. Mementos historically read a trailing legacy set from MEMENTOS_*
 * names with no HASNA_ variant; HASNA_MEMENTOS_* is now canonical and the
 * legacy names remain as a compatibility alias for one deprecation window.
 * Never a silent rename. (DB_PATH and API_URL/API_KEY were already aliased
 * at their read sites — see DB_PATH_ENV_KEYS / API_KEY_ENV_KEYS in
 * src/db/api-mode.ts — and are not duplicated here.)
 *
 * Reads are lazy (function calls) so callers that set process.env at runtime
 * observe the values they set. Canonical wins when both are set; never set
 * both with different values.
 */
const alias = (canonical: string, legacy: string): string | undefined =>
  process.env[canonical] ?? process.env[legacy];

export const env = {
  apiKey: (): string | undefined => alias("HASNA_MEMENTOS_API_KEY", "MEMENTOS_API_KEY"),
  defaultScope: (): string | undefined =>
    alias("HASNA_MEMENTOS_DEFAULT_SCOPE", "MEMENTOS_DEFAULT_SCOPE"),
  defaultCategory: (): string | undefined =>
    alias("HASNA_MEMENTOS_DEFAULT_CATEGORY", "MEMENTOS_DEFAULT_CATEGORY"),
  defaultImportance: (): string | undefined =>
    alias("HASNA_MEMENTOS_DEFAULT_IMPORTANCE", "MEMENTOS_DEFAULT_IMPORTANCE"),
  pgsyncQueryTimeoutMs: (): string | undefined =>
    alias("HASNA_MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS", "MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS"),
  reflectProvider: (): string | undefined =>
    alias("HASNA_MEMENTOS_REFLECT_PROVIDER", "MEMENTOS_REFLECT_PROVIDER"),
  reflectModel: (): string | undefined =>
    alias("HASNA_MEMENTOS_REFLECT_MODEL", "MEMENTOS_REFLECT_MODEL"),
} as const;
