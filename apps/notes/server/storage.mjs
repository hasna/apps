// Hasna Notes server — data-backend selection.
//
// The server has exactly one technical switch: HASNA_NOTES_DATABASE_URL
// present selects the PostgreSQL backend, absent selects SQLite (unchanged
// default). Legacy storage-mode selectors are rejected by the vendored kit.
// The resolved DSN is never logged, printed, or echoed in errors.

import { resolveServerDataBackend, resolveDatabaseUrl } from '../src/generated/storage-kit/backend.js';
import { openDb } from './db.mjs';
import { openPgAdapter } from './pg-adapter.mjs';

export const SERVER_APP_NAME = 'notes';

/** Select and open the server store from the environment. */
export function openStorage(env = process.env, options = {}) {
  const resolution = resolveServerDataBackend(SERVER_APP_NAME, env);
  if (resolution.backend === 'postgresql') {
    const connectionString = resolveDatabaseUrl(SERVER_APP_NAME, env);
    const db = openPgAdapter({
      connectionString,
      applicationName: '@hasna/notes',
    });
    return {
      backend: 'postgresql',
      databaseUrlPresent: true,
      sqlitePath: null,
      db,
      resolution,
      close: () => db.close(),
    };
  }
  const db = openDb(options.sqlitePath);
  return {
    backend: 'sqlite',
    databaseUrlPresent: false,
    sqlitePath: options.sqlitePath,
    db,
    resolution,
    close: async () => {},
  };
}
