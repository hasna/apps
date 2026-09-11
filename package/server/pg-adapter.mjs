// Hasna Notes server — PostgreSQL storage surface.
//
// Wraps the vendored storage kit's query client (or any compatible executor,
// e.g. pglite in tests) in the storage-neutral surface the server code uses:
// `db.query(sql)` returning `{ get(...), run(...), all(...) }`, `db.exec`,
// `db.transaction`, `db.backend`, `db.close`. SQLite (`bun:sqlite`) already
// provides this shape; this adapter provides it for PostgreSQL, translating
// the `?` placeholder style to `$n`.
//
// The connection string is never logged, printed, or included in errors.

import { createPgPool } from '../src/generated/storage-kit/pool.js';
import { createQueryClient } from '../src/generated/storage-kit/query.js';

/**
 * Translate `?` placeholders to `$1..$n`, skipping single-quoted string
 * literals (with '' escapes), double-quoted identifiers, and line comments —
 * so a `?` inside a literal or comment is never mistaken for a parameter.
 */
export function translatePlaceholders(sql) {
  let out = '';
  let n = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      // Consume the literal, honoring the '' (doubled-quote) escape.
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '"') {
      const j = sql.indexOf('"', i + 1);
      const end = j === -1 ? sql.length : j + 1;
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i + 2);
      const end = j === -1 ? sql.length : j;
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '?') {
      n += 1;
      out += `$${n}`;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { sql: out, paramCount: n };
}

/** Wrap any `{ query(sql, params) }` executor in the storage-neutral surface. */
export function wrapPgExecutor(executor) {
  return {
    backend: 'postgresql',
    // The underlying kit-compatible executor (get/many/execute), exposed for
    // kit consumers such as the contracts ApiKeyStore.
    client: executor,

    query(sql) {
      const { sql: translated } = translatePlaceholders(sql);
      return {
        get: async (...params) => {
          const result = await executor.query(translated, params);
          return result.rows[0] ?? null;
        },
        run: async (...params) => {
          await executor.query(translated, params);
          return { changes: 0, lastInsertRowid: null };
        },
        all: async (...params) => {
          const result = await executor.query(translated, params);
          return result.rows;
        },
      };
    },

    exec: async (sql) => {
      await executor.query(sql);
    },

    // The only in-server transaction user is the sync endpoint, which is
    // rejected before it reaches the database on this backend (sync_batches
    // is dropped from the PostgreSQL schema).
    transaction() {
      throw new Error('notes: synchronous transactions are not supported on the postgresql backend');
    },

    close: async () => {
      if (typeof executor.close === 'function') await executor.close();
    },
  };
}

/**
 * Open the PostgreSQL backend from a connection string. SERVER-SIDE ONLY —
 * never distributed to fleet machines; clients reach the server only through
 * the HTTP API (HASNA_NOTES_API_URL + HASNA_NOTES_API_KEY).
 */
export function openPgAdapter({ connectionString, applicationName = '@hasna/notes' }) {
  const pool = createPgPool({ connectionString, applicationName });
  const client = createQueryClient(pool);
  const surface = wrapPgExecutor(client);
  surface.close = () => client.close();
  return surface;
}
