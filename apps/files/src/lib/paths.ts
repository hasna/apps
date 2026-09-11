import { cpSync, existsSync, mkdirSync } from "node:fs";
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
 * operator intent AND keyed live behaviour on a local SQLite file that the
 * no-local-SQLite rule forbids from existing at all.
 */

/**
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. A home that cannot be resolved is a hard error — never
 * a literal "~" path (relative to cwd) and never an "undefined"-prefixed path.
 */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (!home) {
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
 * `HASNA_FILES_HOME`, then `FILES_HOME`. First-nonblank selection: a
 * set-but-whitespace override must not suppress a valid fallback. The
 * postinstall script (scripts/ensure-data-dir.mjs) selects with the same
 * `?.trim() ||` semantics, so the two surfaces stay in parity.
 */
export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dataDirOverride = env["HASNA_FILES_DATA_DIR"]?.trim() || env["FILES_DATA_DIR"]?.trim();
  if (dataDirOverride) return resolve(dataDirOverride);
  const dir = env["HASNA_FILES_HOME"]?.trim() || env["FILES_HOME"]?.trim();
  if (dir) return resolve(dir);
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
 * The effective data dir, provisioned. The one-time auto-migration copies a
 * legacy `~/.files` data directory into the effective data root when that root
 * does not yet exist — so on a default station the copy lands in
 * `~/.hasna/files`.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = getFilesDataDir(env);
  const oldDir = join(getHomeDir(env), ".files");
  if (!existsSync(dir) && existsSync(oldDir)) {
    mkdirSync(dirname(dir), { recursive: true });
    cpSync(oldDir, dir, { recursive: true });
  }
  return dir;
}

/** The effective data dir, created if missing. */
export function getDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = resolveDataDir(env);
  mkdirSync(dir, { recursive: true });
  return dir;
}
