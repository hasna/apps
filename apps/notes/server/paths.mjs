// Hasna Notes maintenance/import path resolution; never a server backend.
//
// Path resolution follows the XDG / macOS home layout. The resolver data home
// (~/.local/share/hasna/notes on Linux, ~/Library/Application Support/Hasna/
// notes on macOS) is the default for every new read/write. Legacy roots are
// never selected or copied implicitly; an operator must run the explicit
// migration command after reviewing its plan.
//
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
// --- Local path resolver -------------------------------------------------
// @hasna/paths was deleted (hasna/apps#1535, 2026-09-03); this in-package
// implementation keeps the one branch notes still uses: the DATA home
// (HASNA_DATA_HOME, else the platform data location), with the same
// env-override and home-override semantics the deleted package had. The
// config/state/cache kinds were dropped with the retired `~/.config/hasna`
// path shape (hasna/apps#1720 validation): nothing in this package reads
// them, and credentials and the service authority never resolve here — the
// @hasna/contracts chain owns ~/.hasna/notes/config/credentials and
// HASNA_HOME.
const PATHS_RESOLVER_DATA_HOME_ENV = 'HASNA_DATA_HOME';

function pathsResolverDataBaseDir(options) {
  const env = options.env ?? process.env;
  const override = env[PATHS_RESOLVER_DATA_HOME_ENV];
  if (typeof override === 'string' && override.length > 0) return override;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Hasna');
  return join(home, '.local', 'share', 'hasna');
}

function dataDir(options) {
  return join(pathsResolverDataBaseDir(options), options.app);
}

/**
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. HOME is read directly; homedir() is only the
 * HOME-unset fallback.
 */
export function getHomeDir(env = process.env) {
  return env.HOME || env.USERPROFILE || homedir();
}

/**
 * The resolver-resolved (XDG / macOS home layout) data root for notes.
 * This is the default data home for every new read/write:
 * ~/.local/share/hasna/notes on Linux, ~/Library/Application Support/Hasna/
 * notes on macOS.
 */
export function getResolverDataRoot(env = process.env) {
  return dataDir({ app: 'notes', home: getHomeDir(env), env });
}

/** The legacy (pre-XDG) data root: ~/.hasna/notes */
export function getLegacyDataRoot(env = process.env) {
  return join(getHomeDir(env), '.hasna', 'notes');
}

/**
 * The exact-app override root, when set: `HASNA_NOTES_HOME` wins, then the
 * pre-existing `HASNA_NOTES_ROOT`. Only prefixed names are read — the
 * unprefixed `NOTES_HOME` fallback was dropped (hasna/apps#1720 validation).
 */
export function getExactDataRoot(env = process.env) {
  const dir = env.HASNA_NOTES_HOME ?? env.HASNA_NOTES_ROOT;
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * The effective data root: an exact-app override (`HASNA_NOTES_HOME`, then
 * `HASNA_NOTES_ROOT`) wins unconditionally; otherwise the resolver's
 * XDG-native data root. Legacy roots are migration sources only. Nothing is
 * evaluated at import time: this module names paths, it never opens them.
 */
export function getDataRoot(env = process.env) {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  return resolve(getResolverDataRoot(env));
}