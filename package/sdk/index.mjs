// @hasna/notes SDK — programmatic client surface (package export ./sdk).
//
// One transport resolver, two connections: the local SQLite+markdown store or
// the server HTTP API selected by HASNA_NOTES_API_URL (+ HASNA_NOTES_API_KEY,
// fail-closed). This module never reads HASNA_NOTES_DATABASE_URL and never
// opens PostgreSQL — a client reaches the server only through the HTTP store.
//
// The HTTP store speaks the personalnotes/v1 wire dialect (/api/v1/* paths,
// Bearer api-key auth) — the same dialect the future hosted wrapper speaks;
// documented, not renamed.
//
// The local markdown store remains the on-box backend (the app's data
// contract) and is re-exported from the package root (`.`) via tools/notes-lib.

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
 * Resolve the client transport from the environment. `local` means the
 * on-box SQLite+markdown store, whose functions are the package-root exports
 * (`.` -> tools/notes-lib.mjs) — the app's data contract. `http` returns the
 * HTTP store bound to the canonical URL+key.
 */
export function resolveNotesClientStore(env = process.env) {
  const report = resolveNotesClientTransport(env);
  if (report.transport === 'http') {
    return { transport: 'http', report, httpStore: createNotesHttpStore(env) };
  }
  return { transport: 'local', report, httpStore: null };
}
