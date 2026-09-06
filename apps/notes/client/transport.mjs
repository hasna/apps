// Hasna Notes — client transport resolution.
//
// A Notes client has exactly one connection: the authenticated HTTPS API.
// The single fleet resolver in `@hasna/contracts/client` decides BOTH the
// authority and the credential, per call, fresh (hasna/apps#1720). This
// module is the app's one adapter onto that seam; the CLI, the MCP server
// and ./sdk all go through it, and a request in any of them re-resolves:
//
//   credential: an explicit argument, then HASNA_NOTES_API_KEY_OVERRIDE /
//               HASNA_PROFILE / HASNA_NOTES_API_KEY_REF, then the macOS
//               Keychain item hasna.credentials.notes.api-key, then
//               ~/.hasna/notes/config/credentials (owner-only 0600), then
//               HASNA_NOTES_API_KEY.
//   authority:  HASNA_NOTES_API_URL, the Keychain api-url item, the
//               credentials file, and finally the fleet gateway
//               https://api.hasna.com/notes (the client appends /v1).
//
// Missing or partial configuration FAILS CLOSED before any local
// SQLite/markdown store is opened: hosted with no credential is a non-zero
// exit, never a fallback, and there is no local mode to opt into and no
// `*-local-fallback` event anywhere in the client path.
//
// Server database configuration (HASNA_NOTES_DATABASE_URL) is a server-side
// concern and never participates in this decision — client code must not read
// it, and the report never carries it.
//
// SAFETY (#1788): the resolver is handed the LIVING env object as-is — never
// a copy, never a normalised snapshot — so its ambient tiers (Keychain via a
// real process.env, disk via the env's own HOME/HASNA_HOME) stay on. Blank
// variables are left where they are and the resolver refuses them itself.
// SAFETY (#1794): an explicit authority pins the credential to itself; the
// ambient fleet credential is never attached to an explicit baseUrl.
//
// This is the ONE transport resolver for the CLI, MCP server, and SDK.

import {
  createClientTransport,
  createHasnaHttpTransport,
  resolveClientTransport,
  resolveCredential,
} from '@hasna/contracts/client';

export const NOTES_APP_SLUG = 'notes';
export const NOTES_API_URL_ENV = 'HASNA_NOTES_API_URL';
export const NOTES_API_KEY_ENV = 'HASNA_NOTES_API_KEY';
export const NOTES_DATABASE_URL_ENV = 'HASNA_NOTES_DATABASE_URL';

/** Canonical client variables. The resolver's own legacy alias handling applies. */
export const NOTES_API_URL_ENV_KEYS = [NOTES_API_URL_ENV];
export const NOTES_API_KEY_ENV_KEYS = [NOTES_API_KEY_ENV];

/**
 * Removed selector names. They remain here only as a fail-loud ratchet so a
 * stale station fragment cannot be silently ignored. PERSONALNOTES_MODE is the
 * retired mode-enum selector (deployment modes were removed); the storage-mode
 * family is the retired mode-enum class every app retired in the two-backend
 * transition. None of them selects anything — their presence is a refusal.
 */
export const RETIRED_SELECTOR_ENV_KEYS = [
  'PERSONALNOTES_MODE',
  'HASNA_NOTES_STORAGE_MODE',
  'HASNA_NOTES_MODE',
  'NOTES_STORAGE_MODE',
  'NOTES_MODE',
];

export const NOTES_CLIENT_TRANSPORTS = ['http'];

/** Read data properties only: credential getters must not be invoked on config. */
export function readPlainClientValue(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return undefined;
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')
      || (descriptor.value !== undefined && typeof descriptor.value !== 'string')) {
    throw new Error(`notes: ${key} must be a plain string configuration value.`);
  }
  return descriptor.value;
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
        + `Clients resolve their configuration through @hasna/contracts (${NOTES_API_URL_ENV} / `
        + `${NOTES_API_KEY_ENV}, the Keychain, or the credentials file); `
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
 * A client process must not carry the server DSN: presence alone (even blank)
 * is a refusal, so a wrapper that sources both sides cannot quietly run a
 * client that believes it is configured. Presence is checked without copying
 * or normalising the env.
 */
export function assertNoClientDatabaseDsn(env = process.env) {
  if (Object.prototype.hasOwnProperty.call(env, NOTES_DATABASE_URL_ENV)) {
    throw new Error(
      `notes: ${NOTES_DATABASE_URL_ENV} is server-only and must not be present in a client environment.`,
    );
  }
}

/**
 * Resolve the only client connection through the @hasna/contracts chain.
 * Values are never included in the report or in errors.
 *
 * `credentials` are @hasna/contracts CredentialChainOptions (an explicit
 * `apiKey`/`profile` and the `keychain` tier controls tests inject). They are
 * passed through untouched — the env itself is never copied.
 */
export function resolveNotesClientTransport(env = process.env, credentials = {}) {
  assertNoClientDatabaseDsn(env);
  assertNoRetiredNotesStorageSelector(env);
  const resolution = resolveClientTransport(NOTES_APP_SLUG, env, { credentials });
  const protocol = new URL(resolution.baseUrl).protocol;
  return {
    transport: resolution.transport,
    // `<origin>/v1` — the authority root the wire dialect lives under.
    baseUrl: resolution.baseUrl,
    // The reader-facing source names, never values.
    source: resolution.transportSource,
    apiUrlSource: resolution.apiUrlSource,
    apiKeySource: resolution.apiKeySource,
    apiKeyTier: resolution.apiKeyTier,
    api_url_present: resolution.apiKeyPresent,
    api_key_present: resolution.apiKeyPresent,
    scheme: protocol === 'https:' ? 'https' : protocol.slice(0, -1),
    localFallback: false,
    clientDatabaseDsn: false,
    warning: resolution.warning,
  };
}

/**
 * Build the authenticated HTTP transport for a resolved chain. Every request
 * re-resolves the credential through the chain (and re-validates that neither
 * the authority nor the credential changed since construction — see
 * `createClientTransport`), so a long-lived MCP server or SDK client picks up
 * a rotation without a restart. Retry is off: the notes store never retried
 * and its failure semantics are deterministic.
 */
export function createNotesClientTransport(env = process.env, fetchImpl, credentials = {}) {
  assertNoClientDatabaseDsn(env);
  assertNoRetiredNotesStorageSelector(env);
  const overrides = { retry: false };
  if (fetchImpl !== undefined) overrides.fetchImpl = fetchImpl;
  overrides.credentials = credentials;
  return createClientTransport(NOTES_APP_SLUG, env, overrides);
}

/**
 * Build the transport for an EXPLICIT authority + credential pair (the direct
 * `NotesHttpStore` config form). Explicit arguments are tier 1: a pin the
 * caller owns. An explicit authority without an explicit credential THROWS —
 * the ambient fleet credential is never attached to an arbitrary baseUrl
 * (#1794).
 */
export function createNotesExplicitTransport(config = {}, fetchImpl = fetch) {
  const apiUrl = readPlainClientValue(config, 'apiUrl');
  const apiKey = readPlainClientValue(config, 'apiKey');
  const trimmedUrl = String(apiUrl ?? '').trim();
  const trimmedKey = String(apiKey ?? '').trim();
  if (!trimmedUrl) {
    throw new Error('notes: an explicit baseUrl is required.');
  }
  if (!trimmedKey) {
    throw new Error(
      'notes: an explicit baseUrl requires an explicit apiKey; the ambient fleet credential '
        + 'is never attached to an explicit authority.',
    );
  }
  return createHasnaHttpTransport({
    name: NOTES_APP_SLUG,
    baseUrl: trimmedUrl,
    apiKey: trimmedKey,
    fetchImpl,
    retry: false,
  });
}

/**
 * The credential VALUE as resolved by the same chain, used ONLY to redact
 * credential material a server or transport error echoes back. Never logged,
 * never returned in reports, never sent — the transport owns the header.
 * Empty when nothing resolved (the store refuses to exist in that case, so a
 * caller of this function only ever sees empty during a deliberate pivot).
 */
export function resolveNotesClientCredential(env = process.env, credentials = {}) {
  const resolved = resolveCredential(NOTES_APP_SLUG, env, credentials);
  return resolved ? resolved.apiKey : '';
}