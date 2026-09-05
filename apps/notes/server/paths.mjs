// Hasna Notes maintenance/import path resolution; never a server backend.
//
// Path resolution follows the single paths resolver (ruling #1668):
// ~/.hasna/notes on macOS, the XDG data root on Linux. Legacy roots are
// never selected or copied implicitly; an operator must run the explicit
// migration command after reviewing its plan.
//
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";


/**
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. HOME is read directly; homedir() is only the
 * HOME-unset fallback.
 */
export function getHomeDir(env = process.env) {
  return resolveEffectiveHome(env);
}

/**
 * The resolver-resolved data root for notes (ruling #1668):
 * `~/.hasna/notes` on macOS, the XDG data root on Linux.
 */
export function getResolverDataRoot(env = process.env) {
  return resolverDataDir({ app: 'notes', home: getHomeDir(env), env });
}

/** The legacy (pre-XDG) data root: ~/.hasna/notes */
export function getLegacyDataRoot(env = process.env) {
  return join(getHomeDir(env), '.hasna', 'notes');
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
 * resolver's XDG-native data root. Legacy roots are migration sources only.
 */
export function getDataRoot(env = process.env) {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  return resolve(getResolverDataRoot(env));
}

export const DEFAULT_DB_PATH = join(getDataRoot(), 'server.db');