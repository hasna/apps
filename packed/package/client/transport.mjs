// Hasna Notes — client transport selection.
//
// A Notes client has exactly one connection: the authenticated HTTPS API.
// Both canonical client variables are required. Missing or partial
// configuration FAILS CLOSED before any local SQLite/markdown store is opened.
//
// Server database configuration (HASNA_NOTES_DATABASE_URL) is a server-side
// concern and never participates in this decision — client code must not read
// it, and the report never carries it.
//
// This is the ONE transport resolver for the CLI, MCP server, and SDK.

export const NOTES_APP_SLUG = 'notes';
export const NOTES_API_URL_ENV = 'HASNA_NOTES_API_URL';
export const NOTES_API_KEY_ENV = 'HASNA_NOTES_API_KEY';
export const NOTES_DATABASE_URL_ENV = 'HASNA_NOTES_DATABASE_URL';

/** Canonical client variables. Compatibility aliases are intentionally absent. */
export const NOTES_API_URL_ENV_KEYS = [NOTES_API_URL_ENV];
export const NOTES_API_KEY_ENV_KEYS = [NOTES_API_KEY_ENV];

/**
 * Removed selector names. They remain here only as a fail-loud ratchet so a
 * stale station fragment cannot be silently ignored. PERSONALNOTES_MODE is the
 * retired mode-enum selector (deployment modes were removed); the storage-mode
 * family is the retired mode-enum class every app retired in the two-backend
 * transition.
 */
export const RETIRED_SELECTOR_ENV_KEYS = [
  'PERSONALNOTES_MODE',
  'HASNA_NOTES_STORAGE_MODE',
  'HASNA_NOTES_MODE',
  'NOTES_STORAGE_MODE',
  'NOTES_MODE',
];

export const NOTES_CLIENT_TRANSPORTS = ['http'];

/** Read data properties only: credential getters must not mutate their authority. */
export function readPlainClientValue(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return undefined;
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || (descriptor.value !== undefined && typeof descriptor.value !== 'string')) {
    throw new Error(`notes: ${key} must be a plain string configuration value.`);
  }
  return descriptor.value;
}

/** Take one data-only snapshot, without invoking supplied configuration getters. */
export function snapshotNotesClientEnvironment(env = process.env) {
  const snapshot = Object.create(null);
  for (const key of [NOTES_API_URL_ENV, NOTES_API_KEY_ENV, NOTES_DATABASE_URL_ENV, ...RETIRED_SELECTOR_ENV_KEYS]) {
    if (Object.prototype.hasOwnProperty.call(env, key)) snapshot[key] = readPlainClientValue(env, key);
  }
  return snapshot;
}

export function isPresent(env, key) {
  if (!Object.prototype.hasOwnProperty.call(env, key)) return false;
  return (env[key] ?? '').trim().length > 0;
}

function firstDefined(env, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined) return key;
  }
  return null;
}

export class RetiredNotesStorageSelectorError extends Error {
  constructor(envKey) {
    super(
      `notes: ${envKey} was retired and must be unset. `
        + `Clients require ${NOTES_API_URL_ENV} and ${NOTES_API_KEY_ENV}; `
        + `local SQLite/markdown client fallback is no longer supported.`,
    );
    this.name = 'RetiredNotesStorageSelectorError';
    this.code = 'retired_notes_storage_selector';
  }
}

/** Reject stale selector variables even when their value is blank. */
export function assertNoRetiredNotesStorageSelector(env = process.env) {
  const retired = firstDefined(env, RETIRED_SELECTOR_ENV_KEYS);
  if (retired) throw new RetiredNotesStorageSelectorError(retired);
}

/**
 * Resolve the only client connection from canonical environment variables.
 * Values are never included in the report or in errors.
 */
export function resolveNotesClientTransport(env = process.env) {
  env = snapshotNotesClientEnvironment(env);
  assertNoRetiredNotesStorageSelector(env);
  if (Object.prototype.hasOwnProperty.call(env, NOTES_DATABASE_URL_ENV)) {
    throw new Error(
      `notes: ${NOTES_DATABASE_URL_ENV} is server-only and must not be present in a client environment.`,
    );
  }
  const apiUrlPresent = isPresent(env, NOTES_API_URL_ENV);
  const apiKeyPresent = isPresent(env, NOTES_API_KEY_ENV);

  if (!apiUrlPresent || !apiKeyPresent) {
    const missing = [
      !apiUrlPresent ? NOTES_API_URL_ENV : null,
      !apiKeyPresent ? NOTES_API_KEY_ENV : null,
    ].filter(Boolean).join(' and ');
    throw new Error(
      `notes: authenticated HTTPS client configuration is incomplete; ${missing} is required. `
        + `Local SQLite/markdown fallback is disabled.`,
    );
  }

  let parsed;
  try {
    parsed = new URL(String(env[NOTES_API_URL_ENV]).trim());
  } catch {
    throw new Error(`notes: ${NOTES_API_URL_ENV} must be an absolute HTTPS URL.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      `notes: ${NOTES_API_URL_ENV} must be an HTTPS URL without embedded credentials, query, or fragment.`,
    );
  }

  return {
    transport: 'http',
    source: `${NOTES_API_URL_ENV}+${NOTES_API_KEY_ENV}`,
    api_url_present: true,
    api_key_present: true,
    scheme: 'https',
  };
}
