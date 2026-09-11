// Hasna Notes server — PostgreSQL-only storage boundary.
//
// HASNA_NOTES_DATABASE_URL is mandatory. Missing, non-canonical, or malformed
// configuration fails closed before the server binds. The resolved DSN is
// never logged, printed, or echoed in errors. SQLite remains available only as
// an explicitly injected test/import adapter; notes-serve never selects it.

import { openPgAdapter } from './pg-adapter.mjs';

export const SERVER_APP_NAME = 'notes';

export function requirePostgresDsn(env) {
  const retired = ['HASNA_NOTES_STORAGE_MODE', 'HASNA_NOTES_MODE', 'NOTES_STORAGE_MODE', 'NOTES_MODE',
    'NOTES_DATABASE_URL', 'HASNA_NOTES_SERVER_DB', 'HASNA_NOTES_DB_PATH'];
  if (retired.some((key) => Object.hasOwn(env, key))) {
    throw new Error('notes-server: retired database selectors are not supported; configure only HASNA_NOTES_DATABASE_URL.');
  }
  const connectionString = Object.hasOwn(env, 'HASNA_NOTES_DATABASE_URL') && typeof env.HASNA_NOTES_DATABASE_URL === 'string'
    ? env.HASNA_NOTES_DATABASE_URL.trim() : '';
  if (!connectionString) {
    throw new Error('notes-server: HASNA_NOTES_DATABASE_URL is required; notes-serve is PostgreSQL-only.');
  }
  let parsed;
  try { parsed = new URL(connectionString); }
  catch { throw new Error('notes-server: HASNA_NOTES_DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length <= 1
    || parsed.hash || /[\u0000-\u0020]/.test(connectionString)) {
    throw new Error('notes-server: HASNA_NOTES_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  return { connectionString, resolution: { backend: 'postgresql', source: 'HASNA_NOTES_DATABASE_URL',
    databaseUrlPresent: true, databaseUrlSource: 'HASNA_NOTES_DATABASE_URL' } };
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
