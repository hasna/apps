// Hasna Notes — client transport selection.
//
// A Notes client has exactly two connections: the on-box SQLite + markdown
// store, or the server HTTP API. The canonical API URL selects HTTP; without
// that URL the client stays on-box (the old default of a localhost server has
// been removed — an unset URL means local). An API URL without its key FAILS
// CLOSED instead of drifting to the on-box store.
//
// Server database configuration (HASNA_NOTES_DATABASE_URL) is a server-side
// concern and never participates in this decision — client code must not read
// it, and the report never carries it.
//
// This is the ONE transport resolver for the CLI, MCP server, and app.
// Mirrors the @hasna/knowledge client-transport pattern.

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

export const NOTES_CLIENT_TRANSPORTS = ['http', 'local'];

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
        + `Clients select the HTTP API when ${NOTES_API_URL_ENV} and ${NOTES_API_KEY_ENV} are set; `
        + `without ${NOTES_API_URL_ENV} they use the local SQLite+markdown store. `
        + `Servers select PostgreSQL with ${NOTES_DATABASE_URL_ENV}.`,
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
 * Resolve the client connection from canonical environment variables only.
 * An API URL without its credential fails closed. Values are never included
 * in the report or in errors.
 */
export function resolveNotesClientTransport(env = process.env) {
  assertNoRetiredNotesStorageSelector(env);
  const apiUrlPresent = isPresent(env, NOTES_API_URL_ENV);
  const apiKeyPresent = isPresent(env, NOTES_API_KEY_ENV);

  if (apiUrlPresent && !apiKeyPresent) {
    throw new Error(
      `notes: ${NOTES_API_URL_ENV} selects the HTTP API, but ${NOTES_API_KEY_ENV} is missing. `
        + `Set ${NOTES_API_KEY_ENV}, or unset ${NOTES_API_URL_ENV} to use the local store.`,
    );
  }

  return {
    transport: apiUrlPresent ? 'http' : 'local',
    source: apiUrlPresent ? NOTES_API_URL_ENV : 'default',
    api_url_present: apiUrlPresent,
    api_key_present: apiKeyPresent,
  };
}
