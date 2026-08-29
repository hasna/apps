import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

export interface OpenCodeCacheRateOptions {
  /** Path to the OpenCode sessions DB (default `~/.local/share/opencode/opencode.db`). */
  dbPath?: string;
  /** A specific session id; omitted = the newest session with usage. */
  sessionId?: string;
}

interface TokenRow {
  tokens_input: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
}

/**
 * Cache-hit fraction from the OpenCode sessions DB: the newest session row's
 * `tokens_cache_read` over the input side (input + cache read + cache write).
 * Read-only `Bun.sqlite` (runtime-available in the bun-target CLI build; no
 * new dependency). Never throws — any open/query failure, a missing file, or
 * a zero divisor degrades to null. When the `session` table has no row with
 * token data (older layouts, or an in-flight session whose usage is not
 * written yet), `session_v2` is tried — both schemas carry the columns.
 */
export function opencodeCacheRate(opts: OpenCodeCacheRateOptions = {}): number | null {
  const dbPath = opts.dbPath ?? join(homedir(), ".local", "share", "opencode", "opencode.db");
  if (!existsSync(dbPath)) return null;
  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    return null;
  }
  try {
    let row = tokenRow(db, "session", opts.sessionId);
    if (!row) row = tokenRow(db, "session_v2", opts.sessionId);
    if (!row) return null;
    const input = row.tokens_input ?? 0;
    const read = row.tokens_cache_read ?? 0;
    const write = row.tokens_cache_write ?? 0;
    const divisor = input + read + write;
    if (divisor <= 0) return null;
    return Math.min(1, Math.max(0, read / divisor));
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Newest populated row in one table; null when the table is absent, empty,
 * or has no row with token data — a missing table must not throw, or the
 * `session_v2` fallback could never run.
 */
function tokenRow(db: Database, table: string, sessionId?: string): TokenRow | null {
  try {
    if (sessionId) {
      return (db
        .query(
          `SELECT tokens_input, tokens_cache_read, tokens_cache_write
           FROM ${table} WHERE id = ? LIMIT 1`,
        )
        .get(sessionId) as TokenRow | null);
    }
    return (db
      .query(
        `SELECT tokens_input, tokens_cache_read, tokens_cache_write
         FROM ${table}
         WHERE tokens_input > 0 OR tokens_cache_read > 0 OR tokens_cache_write > 0
         ORDER BY time_updated DESC LIMIT 1`,
      )
      .get() as TokenRow | null);
  } catch {
    return null;
  }
}
