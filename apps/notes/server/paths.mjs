// Hasna Notes maintenance/import path resolution; never a server backend.
//
// Path resolution routes through the resolver (XDG / macOS home layout). The
// resolver data home (~/.local/share/hasna/notes on Linux,
// ~/Library/Application Support/Hasna/notes on macOS) is the default for every
// new read/write. Legacy roots are never selected or copied implicitly; an
// operator must run the explicit migration command after reviewing its plan.
//
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
// --- Local path resolver -------------------------------------------------
// @hasna/paths was deleted (hasna/apps#1535, 2026-09-03); this in-package
// implementation preserves the resolver contract (XDG / macOS home layout
// honoring HASNA_{CONFIG,DATA,STATE,CACHE}_HOME, with the same env-override
// and home-override semantics the deleted package had).
import { homedir as pathsResolverHomedir } from "node:os";
import { join as pathsResolverJoin } from "node:path";

const PATHS_RESOLVER_KIND_ENV = {
  config: "HASNA_CONFIG_HOME",
  data: "HASNA_DATA_HOME",
  state: "HASNA_STATE_HOME",
  cache: "HASNA_CACHE_HOME",
};

function pathsResolverBaseDir(kind, options) {
  const env = options.env ?? process.env;
  const override = env[PATHS_RESOLVER_KIND_ENV[kind]];
  if (typeof override === "string" && override.length > 0) return override;
  const home = options.home ?? pathsResolverHomedir();
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    switch (kind) {
      case "config":
      case "data":
        return pathsResolverJoin(home, "Library", "Application Support", "Hasna");
      case "cache":
        return pathsResolverJoin(home, "Library", "Caches", "Hasna");
      case "state":
        return pathsResolverJoin(home, "Library", "Logs", "Hasna");
    }
  }
  switch (kind) {
    case "config":
      return pathsResolverJoin(home, ".config", "hasna");
    case "data":
      return pathsResolverJoin(home, ".local", "share", "hasna");
    case "state":
      return pathsResolverJoin(home, ".local", "state", "hasna");
    case "cache":
      return pathsResolverJoin(home, ".cache", "hasna");
  }
}

function pathsResolverResolve(kind, options) {
  const appSegment = options.internal === true ? pathsResolverJoin("internal", options.app) : options.app;
  return pathsResolverJoin(pathsResolverBaseDir(kind, options), appSegment);
}
function dataDir(options) {
  return pathsResolverResolve("data", options);
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
 * The resolver (XDG / macOS home layout) data root for notes.
 * This is the forward-looking home: ~/.local/share/hasna/notes on
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