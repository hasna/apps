// @hasna/notes SDK — programmatic client surface (package export ./sdk).
//
// One transport resolver, one connection: the authenticated HTTPS API selected
// by HASNA_NOTES_API_URL + HASNA_NOTES_API_KEY. This module rejects client DSNs
// and never opens PostgreSQL or a local SQLite/markdown store.
//
// The HTTP store speaks the personalnotes/v1 wire dialect (/api/v1/* paths,
// Bearer api-key auth) — the same dialect the future hosted wrapper speaks;
// documented, not renamed.
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
 * Resolve the authenticated HTTPS client from the environment.
 */
export function resolveNotesClientStore(env = process.env) {
  const report = resolveNotesClientTransport(env);
  return { transport: 'http', report, httpStore: createNotesHttpStore(env) };
}

/** Stable SDK facade over the canonical authenticated HTTPS store. */
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
