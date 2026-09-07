/**
 * Pure filesystem path helpers for the on-box data directory, state directory
 * and SQLite file.
 *
 * These resolve *paths* only — they never open a database handle or import
 * `bun:sqlite`. They are split out of `database.ts` so client code (CLI
 * `backup`/`init`) can reference the on-box paths without importing the SQLite
 * transport, keeping direct SQLite access confined to the LocalStore.
 *
 * Retained server/legacy helpers resolve through the in-package `dataDir()`
 * and `stateDir()` resolvers — never a hardcoded `~/.hasna/contacts`. They do
 * not migrate or copy legacy data implicitly. Preservation is an explicit CLI
 * operation.
 */
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// --- Local path resolver -------------------------------------------------
// @hasna/paths was deleted (hasna/apps#1535, 2026-09-03); this in-package
// implementation preserves the resolver contract for the two kinds this
// package still uses (XDG / macOS home layout honoring HASNA_{DATA,STATE}_HOME,
// with the same env-override and home-override semantics the deleted package
// had). The retired `config` and `cache` kinds are deliberately NOT carried:
// nothing here resolves them, and the retired `~/.config/hasna` shape must
// not ship in the client bundle (hasna/apps#1720 — client credentials and
// configuration come only from the @hasna/contracts chain).
import { homedir as pathsResolverHomedir } from "node:os";
import { join as pathsResolverJoin } from "node:path";

export type PathKind = "data" | "state";

const PATHS_RESOLVER_KIND_ENV: Record<PathKind, string> = {
  data: "HASNA_DATA_HOME",
  state: "HASNA_STATE_HOME",
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
      case "data":
        return pathsResolverJoin(home, "Library", "Application Support", "Hasna");
      case "state":
        return pathsResolverJoin(home, "Library", "Logs", "Hasna");
    }
  }
  switch (kind) {
    case "data":
      return pathsResolverJoin(home, ".local", "share", "hasna");
    case "state":
      return pathsResolverJoin(home, ".local", "state", "hasna");
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
export function stateDir(options: PathsResolverOptions): string {
  return pathsResolverResolve("state", options);
}

function ensurePrivateDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

function home(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/**
 * The data root for retained server/legacy utilities. It creates only the
 * requested target directory and never scans or adopts older homes.
 */
export function getDataDir(): string {
  const base = home();
  const target = dataDir({ app: "contacts", home: base });
  ensurePrivateDir(target);
  return target;
}

/**
 * The state root for retained server/legacy utilities.
 */
export function getStateDir(): string {
  const base = home();
  const target = stateDir({ app: "contacts", home: base });
  ensurePrivateDir(target);
  return target;
}

export function getDbPath(): string {
  if (process.env["HASNA_CONTACTS_DB_PATH"]) return process.env["HASNA_CONTACTS_DB_PATH"];
  if (process.env["CONTACTS_DB_PATH"]) return process.env["CONTACTS_DB_PATH"];
  return join(getDataDir(), "contacts.db");
}
