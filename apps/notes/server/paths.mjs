// Hasna Notes self-hosted server — SQLite default path resolution.
// Fleet law: app data lives at ~/.hasna/<app>/. The server default DB used
// to resolve to the pre-rename nested segment ~/.hasna/apps/notes-server/
// server.db; the canonical default is ~/.hasna/notes/server.db, with a
// one-time copy-forward migration from the legacy file (SQLite file + WAL;
// the -shm file is shared memory and is rebuilt on open, never copied).

import { existsSync, mkdirSync } from 'node:fs';
import { copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// HOME is read directly; homedir() is only the HOME-unset fallback.
const home = process.env.HOME || homedir();
export const DEFAULT_DB_PATH = join(home, '.hasna', 'notes', 'server.db');
export const LEGACY_DB_PATH = join(home, '.hasna', 'apps', 'notes-server', 'server.db');

/**
 * One-time copy-forward of a legacy server SQLite database into the canonical
 * path. Copy-only: the source is preserved, never deleted. Copies the main
 * file and its -wal file (committed-but-not-checkpointed data is replayed on
 * open); the -shm file is never copied. Returns true when a migration
 * happened, false when there was nothing to do (canonical already exists or
 * legacy is absent). Idempotent by construction.
 */
export function migrateLegacyServerDb(canonical, legacy = LEGACY_DB_PATH) {
  if (!canonical || existsSync(canonical) || !existsSync(legacy)) return false;
  mkdirSync(dirname(canonical), { recursive: true, mode: 0o700 });
  copyFileSync(legacy, canonical);
  if (existsSync(`${legacy}-wal`)) copyFileSync(`${legacy}-wal`, `${canonical}-wal`);
  return existsSync(canonical);
}
