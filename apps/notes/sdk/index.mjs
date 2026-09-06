// @hasna/notes SDK — programmatic client surface (package export ./sdk).
//
// One transport resolver, one connection: the authenticated HTTPS API resolved
// per request, per call, through @hasna/contracts/client (hasna/apps#1720).
// Every NotesClient request re-resolves the credential through the chain —
// Keychain, ~/.hasna/notes/config/credentials, then HASNA_NOTES_API_KEY —
// and the authority follows HASNA_NOTES_API_URL / the Keychain api-url item /
// the credentials file / the fleet gateway https://api.hasna.com/notes. There
// is no local mode and no fallback: hosted with no credential throws on every
// surface, and an explicit baseUrl without an explicit apiKey is refused
// rather than borrowing the ambient fleet credential (#1794).
//
// The HTTP store speaks the personalnotes/v1 wire dialect at the /v1 authority
// root (/v1/notes, /v1/export; Bearer api-key auth) — the same dialect the
// notes-serve server exposes; documented, not renamed.
//
// The package root exports this same remote-only client. Pure, non-authoritative
// format helpers live only at the explicit ./compat/markdown-format subpath.

import {
  NOTES_APP_SLUG,
  NOTES_API_URL_ENV,
  NOTES_API_KEY_ENV,
  NOTES_DATABASE_URL_ENV,
  NOTES_API_URL_ENV_KEYS,
  NOTES_API_KEY_ENV_KEYS,
  RETIRED_SELECTOR_ENV_KEYS,
  NOTES_CLIENT_TRANSPORTS,
  resolveNotesClientTransport,
  assertNoRetiredNotesStorageSelector,
  RetiredNotesStorageSelectorError,
} from '../client/transport.mjs';

export {
  NOTES_APP_SLUG,
  NOTES_API_URL_ENV,
  NOTES_API_KEY_ENV,
  NOTES_DATABASE_URL_ENV,
  NOTES_API_URL_ENV_KEYS,
  NOTES_API_KEY_ENV_KEYS,
  RETIRED_SELECTOR_ENV_KEYS,
  NOTES_CLIENT_TRANSPORTS,
  resolveNotesClientTransport,
  assertNoRetiredNotesStorageSelector,
  RetiredNotesStorageSelectorError,
};

import {
  NotesHttpStore,
  NotesHttpStoreError,
  createNotesHttpStore,
} from '../client/http-store.mjs';

export {
  NotesHttpStore,
  NotesHttpStoreError,
  createNotesHttpStore,
};

/**
 * Resolve the authenticated HTTPS client from the environment through the
 * @hasna/contracts chain. The report names the sources (never values).
 */
export function resolveNotesClientStore(env = process.env) {
  const report = resolveNotesClientTransport(env);
  return { transport: 'http', report, httpStore: createNotesHttpStore(env) };
}

/**
 * Stable SDK facade over the canonical authenticated HTTPS store.
 *
 * `env` defaults to the live `process.env` — hand it to the resolver AS-IS
 * (#1788) so the ambient Keychain/disk tiers stay on. Callers that pass a
 * custom env object should also pass `keychain: { enabled: true }` through a
 * store built with explicit credentials if they intend the machine Keychain.
 * An explicit `baseUrl` with no `apiKey` throws; it never borrows the ambient
 * fleet credential (#1794).
 */
export class NotesClient {
  constructor(env = process.env, fetchImpl = fetch) {
    this.store = createNotesHttpStore(env, fetchImpl);
  }

  health() { return this.store.health(); }
  list(params) { return this.store.listNotes(params); }
  get(id) { return this.store.getNote(id); }
  create(input) { return this.store.createNote(input); }
  update(id, input) { return this.store.updateNote(id, input); }
  delete(id) { return this.store.deleteNote(id); }
  export() { return this.store.exportNotes(); }
}