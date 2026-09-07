// Hasna Notes server — PostgreSQL-only storage boundary.
//
// HASNA_NOTES_DATABASE_URL (or its NOTES_DATABASE_URL alias, per the vendored
// storage kit) is mandatory. Missing, non-canonical, or malformed
// configuration fails closed before the server binds. The resolved DSN is
// never logged, printed, or echoed in errors. SQLite remains available only as
// an explicitly injected test/import adapter; notes-serve never selects it.
// Retired storage-mode variables (*_MODE / *_STORAGE_MODE) are INERT — the
// storage-mode axis was retired and nothing selects a mode anymore.

import { openPgAdapter } from './pg-adapter.mjs';

export const SERVER_APP_NAME = 'notes';

/** Canonical DSN key first, then the vendored kit's alias. */
const DSN_ENV_KEYS = ['HASNA_NOTES_DATABASE_URL', 'NOTES_DATABASE_URL'];

function databaseUrlEntries(env) {
  return DSN_ENV_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(env, key))
    .map((key) => ({ key, value: typeof env[key] === 'string' ? env[key] : '' }));
}

export function requirePostgresDsn(env) {
  const entries = databaseUrlEntries(env);
  if (entries.length === 0) {
    throw new Error('notes-server: HASNA_NOTES_DATABASE_URL is required; notes-serve is PostgreSQL-only.');
  }
  const blank = entries.filter((entry) => entry.value.trim().length === 0);
  if (blank.length > 0) {
    throw new Error('notes-server: a PostgreSQL database URL is required and must not be blank.');
  }
  const normalized = entries.map((entry) => ({ key: entry.key, value: entry.value.trim() }));
  if (normalized.length > 1 && new Set(normalized.map((entry) => entry.value)).size > 1) {
    throw new Error('notes-server: HASNA_NOTES_DATABASE_URL and NOTES_DATABASE_URL disagree; only one may be set or they must match.');
  }
  const selected = normalized[0];
  const connectionString = selected.value;
  let parsed;
  try { parsed = new URL(connectionString); }
  catch { throw new Error('notes-server: HASNA_NOTES_DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length <= 1
    || parsed.hash || /[\u0000-\u0020]/.test(connectionString)) {
    throw new Error('notes-server: HASNA_NOTES_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  return { connectionString, resolution: { backend: 'postgresql', source: selected.key,
    databaseUrlPresent: true, databaseUrlSource: selected.key } };
}

/** Open the mandatory server-side PostgreSQL store. */
export function openStorage(env = process.env) {
  const { connectionString, resolution } = requirePostgresDsn(env);
  const db = openPgAdapter({ connectionString, applicationName: '@hasna/notes' });
  return {
    backend: 'postgresql',
    databaseUrlPresent: true,
    db,
    resolution,
    close: () => db.close(),
  };
}
