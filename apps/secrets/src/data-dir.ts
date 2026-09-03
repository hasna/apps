import { copyFileSync, existsSync, lstatSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
// --- Local path resolver -------------------------------------------------
// @hasna/paths was deleted (hasna/apps#1535, 2026-09-03); this in-package
// implementation preserves the resolver contract (XDG / macOS home layout
// honoring HASNA_{CONFIG,DATA,STATE,CACHE}_HOME, with the same env-override
// and home-override semantics the deleted package had).
import { homedir as pathsResolverHomedir } from "node:os";
import { join as pathsResolverJoin } from "node:path";

export type PathKind = "config" | "data" | "state" | "cache";

const PATHS_RESOLVER_KIND_ENV: Record<PathKind, string> = {
  config: "HASNA_CONFIG_HOME",
  data: "HASNA_DATA_HOME",
  state: "HASNA_STATE_HOME",
  cache: "HASNA_CACHE_HOME",
};

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

function pathsResolverAssertKind(kind: PathKind): void {
  if (!(Object.keys(PATHS_RESOLVER_KIND_ENV) as string[]).includes(kind)) {
    throw new TypeError(
      `paths: invalid path kind "${kind}" — expected one of ${Object.keys(PATHS_RESOLVER_KIND_ENV).join(", ")}`,
    );
  }
}

function pathsResolverBaseDir(kind: PathKind, options: PathsResolverOptions): string {
  pathsResolverAssertKind(kind);
  const env: Record<string, string | undefined> = options.env ?? process.env;
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

function pathsResolverResolve(kind: PathKind, options: PathsResolverOptions): string {
  pathsResolverAssertApp(options.app);
  const appSegment = options.internal === true ? pathsResolverJoin("internal", options.app) : options.app;
  return pathsResolverJoin(pathsResolverBaseDir(kind, options), appSegment);
}
export function dataDir(options: PathsResolverOptions): string {
  return pathsResolverResolve("data", options);
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
