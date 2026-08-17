/**
 * @hasna/prompts — client transport selection.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * A prompts client has exactly two connections: its on-box SQLite store plus a
 * local markdown body folder, or the server HTTP API. The canonical API URL
 * selects HTTP; without that URL the client stays on-box. Server database
 * configuration (HASNA_PROMPTS_DATABASE_URL) is handled by prompts-serve and
 * never participates in this decision — a client never opens PostgreSQL.
 *
 * The retired `local|auto|remote` storage-mode selector is rejected
 * fail-loudly so a stale station fragment cannot be silently ignored.
 */

export const PROMPTS_APP_SLUG = 'prompts';
export const PROMPTS_API_URL_ENV = 'HASNA_PROMPTS_API_URL';
export const PROMPTS_API_KEY_ENV = 'HASNA_PROMPTS_API_KEY';
export const PROMPTS_DATABASE_URL_ENV = 'HASNA_PROMPTS_DATABASE_URL';

/** Canonical client variables. Compatibility aliases are intentionally absent. */
export const PROMPTS_API_URL_ENV_KEYS = [PROMPTS_API_URL_ENV] as const;
export const PROMPTS_API_KEY_ENV_KEYS = [PROMPTS_API_KEY_ENV] as const;

/**
 * Removed selector names. They remain here only as a fail-loud ratchet so a
 * stale station fragment cannot be silently ignored.
 */
export const RETIRED_PROMPTS_SELECTOR_ENV_KEYS = [
  'HASNA_PROMPTS_STORAGE_MODE',
  'PROMPTS_STORAGE_MODE',
] as const;

/**
 * Diagnostics-only registry variables from the retired remote-registry model.
 * The server-only body-store variables (HASNA_PROMPTS_BODY_PATH,
 * HASNA_PROMPTS_S3_BUCKET, HASNA_PROMPTS_S3_PREFIX, HASNA_PROMPTS_AWS_REGION)
 * replace them; a leftover value is rejected the same way a mode selector is.
 */
export const RETIRED_PROMPTS_REGISTRY_ENV_KEYS = [
  'PROMPTS_REGISTRY_POSTGRES_URL',
  'PROMPTS_REGISTRY_S3_BUCKET',
  'PROMPTS_REGISTRY_AWS_REGION',
] as const;

export type PromptsClientTransport = 'sqlite' | 'http';

export interface PromptsClientTransportReport {
  transport: PromptsClientTransport;
  source: typeof PROMPTS_API_URL_ENV | 'default';
  api_url_present: boolean;
  api_key_present: boolean;
}

function isPresent(env: NodeJS.ProcessEnv, key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(env, key)) return false;
  return (env[key] ?? '').trim().length > 0;
}

function firstDefined(env: NodeJS.ProcessEnv, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined) return key;
  }
  return null;
}

export class RetiredPromptsStorageSelectorError extends Error {
  readonly code = 'retired_prompts_storage_selector';

  constructor(readonly envKey: string) {
    super(
      `prompts: ${envKey} was retired and must be unset. `
        + `Clients select the HTTP API when ${PROMPTS_API_URL_ENV} and ${PROMPTS_API_KEY_ENV} are set; `
        + `without ${PROMPTS_API_URL_ENV} they use local SQLite plus a local markdown body folder. `
        + `Servers select PostgreSQL with ${PROMPTS_DATABASE_URL_ENV}.`,
    );
    this.name = 'RetiredPromptsStorageSelectorError';
  }
}

/** Reject stale selector and diagnostics variables even when their value is blank. */
export function assertNoRetiredPromptsStorageSelector(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const retired = firstDefined(env, [
    ...RETIRED_PROMPTS_SELECTOR_ENV_KEYS,
    ...RETIRED_PROMPTS_REGISTRY_ENV_KEYS,
  ]);
  if (retired) throw new RetiredPromptsStorageSelectorError(retired);
}

/**
 * Resolve the client connection from canonical environment variables only.
 * An API URL without its credential fails closed instead of drifting to the
 * on-box store. Values are never included in the report or in errors.
 */
export function resolvePromptsClientTransport(
  env: NodeJS.ProcessEnv = process.env,
): PromptsClientTransportReport {
  assertNoRetiredPromptsStorageSelector(env);
  const apiUrlPresent = isPresent(env, PROMPTS_API_URL_ENV);
  const apiKeyPresent = isPresent(env, PROMPTS_API_KEY_ENV);

  if (apiUrlPresent && !apiKeyPresent) {
    throw new Error(
      `prompts: ${PROMPTS_API_URL_ENV} selects the HTTP API, but ${PROMPTS_API_KEY_ENV} is missing. `
        + `Set ${PROMPTS_API_KEY_ENV}, or unset ${PROMPTS_API_URL_ENV} to use local SQLite.`,
    );
  }

  return {
    transport: apiUrlPresent ? 'http' : 'sqlite',
    source: apiUrlPresent ? PROMPTS_API_URL_ENV : 'default',
    api_url_present: apiUrlPresent,
    api_key_present: apiKeyPresent,
  };
}
