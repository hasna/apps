import { copyFileSync, existsSync, lstatSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
// --- Local data-home resolver ------------------------------------------
// @hasna/paths was deleted (hasna/apps#1535, 2026-09-03); this in-package
// implementation preserves the DATA-kind resolver contract only (XDG / macOS
// home layout honouring HASNA_DATA_HOME, with the same env-override and
// home-override semantics the deleted package had). The config/state/cache
// kinds were dead code here and are gone: nothing in this package composes a
// `~/.config/hasna` (or any other retired) location any more — the credential
// file lives under `~/.hasna/secrets/config/` and is read by @hasna/contracts.
//
// HASNA_HOME (which replaces `~/.hasna` for the @hasna/contracts credential
// tier) is deliberately NOT consulted for the opt-in local vault: its home is
// the legacy `~/.hasna/secrets` (or the XDG data home once adopted), the same
// directory the HC-00304 test-isolation guard protects. The two variables that
// move the vault are `HASNA_DATA_HOME` (the whole data root) and the file-level
// `HASNA_SECRETS_DB_PATH` / `HASNA_SECRETS_KEY_DIR` overrides.
import { homedir as pathsResolverHomedir } from "node:os";
import { join as pathsResolverJoin } from "node:path";

const PATHS_RESOLVER_DATA_ENV = "HASNA_DATA_HOME";

export interface PathsResolverOptions {
  app: string;
  internal?: boolean;
  platform?: string;
  home?: string;
  env?: Record<string, string | undefined>;
}

const PATHS_RESOLVER_APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function pathsResolverAssertApp(app: string): void {
  if (typeof app !== "string" || app.length === 0) {
    throw new TypeError("paths: app must be a non-empty string");
  }
  if (!PATHS_RESOLVER_APP_SLUG_RE.test(app)) {
    throw new TypeError(
      `paths: invalid app slug "${app}" — expected lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`,
    );
  }
}

/**
 * The hasna-level DATA root: `HASNA_DATA_HOME` when set, else
 * `~/Library/Application Support/Hasna` on darwin and `~/.local/share/hasna`
 * elsewhere.
 */
function pathsResolverDataBaseDir(options: PathsResolverOptions): string {
  const env: Record<string, string | undefined> = options.env ?? process.env;
  const override = env[PATHS_RESOLVER_DATA_ENV];
  if (typeof override === "string" && override.length > 0) return override;
  const home = options.home ?? pathsResolverHomedir();
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    return pathsResolverJoin(home, "Library", "Application Support", "Hasna");
  }
  return pathsResolverJoin(home, ".local", "share", "hasna");
}

export function dataDir(options: PathsResolverOptions): string {
  pathsResolverAssertApp(options.app);
  const appSegment = options.internal === true ? pathsResolverJoin("internal", options.app) : options.app;
  return pathsResolverJoin(pathsResolverDataBaseDir(options), appSegment);
}

const SQLITE_DB_FILE = "vault.db";
const SQLITE_SIDECAR_FILES = ["vault.db-wal", "vault.db-shm", "vault.db-journal"] as const;

// ~/.secrets is also the global env-file credential store. Only these non-DB
// files are independently owned by this service; directory trees and every
// other file must stay there. The SQLite DB and its sidecars migrate as a group.
const LEGACY_SERVICE_FILES = [
  "vault.key",
  "vault.key.enc",
  "kms.json",
  "aws.json",
  ".serve-token",
] as const;

function copyOwnedFileIfMissing(legacyDir: string, targetDir: string, name: string): boolean {
  const source = join(legacyDir, name);
  const target = join(targetDir, name);
  if (!existsSync(source) || existsSync(target)) return false;

  // Do not follow a link out of the shared credential store, even when its
  // name happens to match a service-owned file.
  if (!lstatSync(source).isFile()) return false;
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  copyFileSync(source, target);
  return true;
}

/**
 * Resolve the user's home directory: `$HOME`, then the OS user database.
 * `$HOME` is read first so tests can redirect the effective home to a temp
 * dir — under Bun, `os.homedir()` snapshots `$HOME` at process start and
 * ignores later reassignment. The `@hasna/paths` resolver is given the same
 * home override so the resolved XDG home follows the same home the legacy
 * path does.
 */
export function operatorHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME || homedir();
}

/**
 * The legacy (pre-XDG) operator data dir: `~/.hasna/secrets`. This stays the
 * effective default until the store has actually been migrated to the
 * resolver (XDG) data home (see {@link adoptResolverOperatorDataDir}).
 */
export function legacyOperatorDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(operatorHome(env), ".hasna", "secrets");
}

/**
 * The `@hasna/paths`-resolved (XDG / macOS home layout) data home for the
 * secrets vault: `~/.local/share/hasna/secrets` on Linux,
 * `~/Library/Application Support/Hasna/secrets` on macOS. This is the home
 * the XDG migration (hotfixes plan 0f49f56a, task P3.3) moves the vault
 * toward; nothing moves in this phase — the package just can now resolve the
 * new path.
 */
export function resolverOperatorDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: "secrets", home: operatorHome(env), env });
}

/**
 * Whether the resolver (XDG) data home should be adopted as the effective
 * operator data dir. The resolver home is adopted only when the operator has
 * set `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the
 * XDG layout) or the vault has already been physically migrated there
 * (`vault.db` exists). A machine that only redirects another kind (e.g. cache
 * to tmpfs) must NOT have its data home moved, and a live vault at the legacy
 * home must never become invisible on upgrade.
 */
export function adoptResolverOperatorDataDir(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, SQLITE_DB_FILE));
}

/**
 * The effective operator data dir: the resolver (XDG) data home once adopted
 * (see {@link adoptResolverOperatorDataDir}), otherwise the legacy
 * `~/.hasna/secrets` default. Pure — never creates directories.
 */
export function effectiveOperatorDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const resolved = resolverOperatorDataDir(env);
  return adoptResolverOperatorDataDir(resolved, env) ? resolved : legacyOperatorDataDir(env);
}

/** Resolve the operator's data directory, migrating only service-owned files. */
export function ensureOperatorDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const legacyDir = join(operatorHome(env), ".secrets");
  const targetDir = effectiveOperatorDataDir(env);

  if (existsSync(legacyDir)) {
    const copiedVaultDb = copyOwnedFileIfMissing(legacyDir, targetDir, SQLITE_DB_FILE);
    if (copiedVaultDb) {
      for (const name of SQLITE_SIDECAR_FILES) copyOwnedFileIfMissing(legacyDir, targetDir, name);
    }

    for (const name of LEGACY_SERVICE_FILES) {
      copyOwnedFileIfMissing(legacyDir, targetDir, name);
    }
  }

  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  return targetDir;
}

/** Client configuration may preserve its own files, but never imports vaults or keys. */
export function ensureClientDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const targetDir = effectiveOperatorDataDir(env);
  const legacyDir = join(operatorHome(env), ".secrets");
  for (const name of ["aws.json", ".serve-token"]) copyOwnedFileIfMissing(legacyDir, targetDir, name);
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  return targetDir;
}
