// Hasna Notes self-hosted server — SQLite default path resolution.
//
// Path resolution routes through the @hasna/paths resolver (XDG / macOS home
// layout). The resolver data home (~/.local/share/hasna/notes on Linux,
// ~/Library/Application Support/Hasna/notes on macOS) is adopted only when the
// operator has set HASNA_DATA_HOME (the data-kind override — a deliberate
// opt-in to the XDG layout) or the store has already been physically migrated
// there (server.db exists at the resolver root). Until then the legacy
// ~/.hasna/notes default stays the effective data home, so an existing store
// and its layout never become invisible on upgrade.
//
// The server default DB used to resolve to the pre-rename nested segment
// ~/.hasna/apps/notes-server/server.db; the canonical legacy default is
// ~/.hasna/notes/server.db, with a one-time copy-forward migration from the
// legacy file (SQLite file + WAL; the -shm file is shared memory and is
// rebuilt on open, never copied).

import { existsSync, mkdirSync } from 'node:fs';
import { copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { dataDir } from '@hasna/paths';

/**
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. HOME is read directly; homedir() is only the
 * HOME-unset fallback.
 */
export function getHomeDir(env = process.env) {
  return env.HOME || env.USERPROFILE || homedir();
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for notes.
 * This is the forward-looking home the XDG migration (hotfixes plan
 * 0f49f56a, task P3.3) moves the store toward: ~/.local/share/hasna/notes on
 * Linux, ~/Library/Application Support/Hasna/notes on macOS.
 */
export function getResolverDataRoot(env = process.env) {
  return dataDir({ app: 'notes', home: getHomeDir(env), env });
}

/** The legacy (pre-XDG) data root: ~/.hasna/notes */
export function getLegacyDataRoot(env = process.env) {
  return join(getHomeDir(env), '.hasna', 'notes');
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`server.db` exists). A machine that only redirects another kind (e.g.
 * cache to tmpfs) must NOT have its data home moved, and a live store at the
 * legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataRoot(resolved, env = process.env) {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === 'string' && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, 'server.db'));
}

/**
 * The exact-app override root, when set: `HASNA_NOTES_HOME` wins, then the
 * pre-existing `HASNA_NOTES_ROOT`, then the `NOTES_HOME` fallback.
 */
export function getExactDataRoot(env = process.env) {
  const dir = env.HASNA_NOTES_HOME ?? env.HASNA_NOTES_ROOT ?? env.NOTES_HOME;
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * The effective data root: an exact-app override (`HASNA_NOTES_HOME`, then
 * `HASNA_NOTES_ROOT`, then `NOTES_HOME`) wins unconditionally; otherwise the
 * resolver (XDG) data root once adopted; otherwise the legacy `~/.hasna/notes`
 * default.
 */
export function getDataRoot(env = process.env) {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  const resolved = getResolverDataRoot(env);
  return adoptResolverDataRoot(resolved, env) ? resolve(resolved) : getLegacyDataRoot(env);
}

export const DEFAULT_DB_PATH = join(getDataRoot(), 'server.db');
export const LEGACY_DB_PATH = join(getHomeDir(), '.hasna', 'apps', 'notes-server', 'server.db');

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
