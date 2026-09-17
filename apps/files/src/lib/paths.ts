import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Where `files` keeps its on-box state.
 *
 * Home-layout ruling, 2026-09-04: the ONLY canonical per-app home for a public
 * `@hasna/*` app is `~/.hasna/<app>` — here, `~/.hasna/files`. `HASNA_HOME`
 * relocates the `~/.hasna` root and `HASNA_DATA_HOME` relocates the data root;
 * the exact-app overrides (`HASNA_FILES_DATA_DIR`, `FILES_DATA_DIR`,
 * `HASNA_FILES_HOME`, `FILES_HOME`) name the whole data root directly and win
 * over both. Nothing else moves this app's home.
 *
 * This file used to carry a private fork of the deleted `@hasna/paths`
 * (hasna/apps#1535) that resolved an XDG / macOS layout —
 * `~/.local/share/hasna/files`, `~/Library/Application Support/Hasna/files` —
 * labelled `~/.hasna/files` "legacy (pre-XDG)", and preferred the XDG root over
 * it. That inverted the ruling, so the fork is gone. Its silent-adoption rule
 * is gone too: the data root used to switch to the XDG path merely because a
 * `files.db` already existed there, which relocated a station's home with no
 * operator intent AND let a local SQLite artefact select behavior. Local
 * SQLite remains supported only after the explicit `HASNA_FILES_LOCAL=1`
 * opt-in; its mere presence must never select either the transport or home.
 */

/**
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. A home that cannot be resolved is a hard error — never
 * a literal "~" path (relative to cwd) and never an "undefined"-prefixed path.
 */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  for (const key of ["HOME", "USERPROFILE"] as const) {
    const value = env[key]?.trim();
    if (value && isAbsolute(value)) return value;
  }
  const home = homedir().trim();
  if (!home || !isAbsolute(home)) {
    throw new Error("Unable to resolve the user's home directory");
  }
  return home;
}

/**
 * An absolute, non-blank override, or undefined. A relative or whitespace
 * value is treated as unset rather than silently resolved against cwd — the
 * same rule `@hasna/contracts` applies to these keys.
 */
function absoluteOverride(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && isAbsolute(value) ? value : undefined;
}

/** The `~/.hasna` root: `HASNA_HOME` when absolute, else `$HOME/.hasna`. */
export function getHasnaHome(env: NodeJS.ProcessEnv = process.env): string {
  return absoluteOverride(env, "HASNA_HOME") ?? join(getHomeDir(env), ".hasna");
}

/**
 * The canonical data root for this app: `<hasna home>/files`. This is the
 * ruling's layout and the default on every station.
 */
export function getCanonicalDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHasnaHome(env), "files");
}

/**
 * The exact-app override root, when set. The data-dir overrides
 * (`HASNA_FILES_DATA_DIR`, then `FILES_DATA_DIR`) keep their precedence — they
 * name the whole data root directly — followed by the exact-app home overrides
 * `HASNA_FILES_HOME`, then `FILES_HOME`. First-absolute-nonblank selection: a
 * relative or whitespace override must not suppress a valid fallback. The
 * postinstall script (scripts/ensure-data-dir.mjs) selects with the same
 * semantics, so the two surfaces stay in parity without cwd-dependent roots.
 */
export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of [
    "HASNA_FILES_DATA_DIR",
    "FILES_DATA_DIR",
    "HASNA_FILES_HOME",
    "FILES_HOME",
  ] as const) {
    const selected = absoluteOverride(env, key);
    if (selected) return selected;
  }
  return undefined;
}

/**
 * The data-kind override root: `<HASNA_DATA_HOME>/files`. A non-data kind
 * override (`HASNA_CACHE_HOME`, `HASNA_STATE_HOME`, `HASNA_CONFIG_HOME`) must
 * never move the data home, so none of them are read here.
 */
function getDataHomeRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const root = absoluteOverride(env, "HASNA_DATA_HOME");
  return root ? join(root, "files") : undefined;
}

function hasExplicitDataRootSelection(env: NodeJS.ProcessEnv): boolean {
  return getExactDataRoot(env) !== undefined
    || getDataHomeRoot(env) !== undefined
    || absoluteOverride(env, "HASNA_HOME") !== undefined;
}

/**
 * The effective data root: an exact-app override wins unconditionally; then
 * `HASNA_DATA_HOME`; otherwise the canonical `~/.hasna/files`. The store path
 * (`HASNA_FILES_DB_PATH` / `FILES_DB_PATH` / `--db`) is layered on top of this
 * by the database layer, so an explicit store path always wins regardless.
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return getExactDataRoot(env) ?? getDataHomeRoot(env) ?? getCanonicalDataRoot(env);
}

/** Alias kept for readability at call sites that want "the files data dir". */
export function getFilesDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return getDataRoot(env);
}

/**
 * The two default roots emitted by the retired cross-platform resolver.
 *
 * Both are checked on every platform. A home directory can be shared or moved
 * between Linux and macOS, so checking only `process.platform` could strand the
 * other platform's store and permit a new empty canonical database beside it.
 */
export function getRetiredXdgDataRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = getHomeDir(env);
  return [
    join(home, ".local", "share", "hasna", "files"),
    join(home, "Library", "Application Support", "Hasna", "files"),
  ];
}

function inspectPath<T>(path: string, inspect: () => T, missing: T): T {
  try {
    return inspect();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return missing;
    throw new Error(
      `FILES_DATA_PROBE_FAILED: refusing to create a local store because a data path could not be inspected: ${path}`,
      { cause: error },
    );
  }
}

function effectiveDatabaseHasContent(path: string): boolean {
  return inspectPath(path, () => statSync(path).size > 0, false);
}

function retiredRootContainsData(root: string): boolean {
  return inspectPath(root, () => {
    const entry = lstatSync(root);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return true;
    return readdirSync(root).length > 0;
  }, false);
}

/**
 * Retired roots containing any data while the selected destination has no
 * non-empty database. `lstat` is deliberate: a symlink or suspicious non-dir
 * at a retired root is still evidence that automatic creation is unsafe.
 */
export function findStrandedXdgDataRoots(
  effectiveRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const effectiveDb = join(effectiveRoot, "files.db");
  if (effectiveDatabaseHasContent(effectiveDb)) return [];
  const effective = resolve(effectiveRoot);
  return getRetiredXdgDataRoots(env).filter((root) => {
    if (resolve(root) === effective) return false;
    return retiredRootContainsData(root);
  });
}

/**
 * Fail closed before creating the canonical local database when a previous
 * Files release left data at a retired XDG/macOS root.
 *
 * Nothing is moved automatically: copying a live SQLite directory safely also
 * requires its WAL/SHM state and operator coordination. The diagnostic gives
 * the two explicit recovery paths instead—move the complete directory, or pin
 * this local run to the old root with an exact-app data override.
 */
export function assertNoStrandedXdgData(
  effectiveRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { force?: boolean } = {},
): void {
  // A valid path override is deliberate, not silent adoption. Only the
  // implicit canonical default needs the one-time stranded-data interlock.
  if (!options.force && hasExplicitDataRootSelection(env)) return;
  const stranded = findStrandedXdgDataRoots(effectiveRoot, env);
  if (stranded.length === 0) return;
  throw new Error(
    `FILES_STRANDED_XDG_DATA: refusing to create ${join(effectiveRoot, "files.db")} while a retired Files store exists at ${stranded.join(
      ", ",
    )}. Stop Files processes and back up both roots. Then either set HASNA_FILES_DATA_DIR to the retained root, or perform an offline migration into ${effectiveRoot} that preserves files.db, its WAL/SHM state, configuration, and other root contents. No files were changed.`,
  );
}

function isMissingOrEmptyDirectory(path: string): boolean {
  return inspectPath(path, () => {
    const entry = lstatSync(path);
    return entry.isDirectory() && !entry.isSymbolicLink() && readdirSync(path).length === 0;
  }, true);
}

/**
 * The effective data dir, provisioned. The one-time auto-migration copies a
 * legacy `~/.files` data directory into the effective data root when that root
 * does not yet exist — so on a default station the copy lands in
 * `~/.hasna/files`.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = getFilesDataDir(env);
  const oldDir = join(getHomeDir(env), ".files");
  if (isMissingOrEmptyDirectory(dir) && existsSync(oldDir)) {
    mkdirSync(dirname(dir), { recursive: true });
    cpSync(oldDir, dir, { recursive: true });
  }
  return dir;
}

/** The effective data dir, created if missing. */
export function getDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const selected = getFilesDataDir(env);
  assertNoStrandedXdgData(selected, env);
  const dir = resolveDataDir(env);
  mkdirSync(dir, { recursive: true });
  return dir;
}
