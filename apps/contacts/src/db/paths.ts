/**
 * Pure filesystem path helpers for the on-box data directory, state directory
 * and SQLite file.
 *
 * These resolve *paths* only — they never open a database handle or import
 * `bun:sqlite`. They are split out of `database.ts` so client code (CLI
 * `backup`/`init`) can reference the on-box paths without importing the SQLite
 * transport, keeping direct SQLite access confined to the LocalStore.
 *
 * XDG conformance (hotfixes 5f624540): the on-box store, documents and config
 * resolve through @hasna/paths `dataDir()`, and the vault session state through
 * `stateDir()` — never a hardcoded `~/.hasna/contacts`. The legacy home is
 * only ever an adoption SOURCE, migrated once into the XDG roots on first use
 * under a gate: an existing (non-empty) XDG store is never clobbered.
 */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
 * The home dir handed to the @hasna/paths resolver. Honoring process.env HOME
 * keeps the resolver deterministic under an injected HOME (tests, chroot, CI);
 * when neither HOME nor USERPROFILE is set, @hasna/paths falls back to
 * os.homedir() on its own.
 */
function resolverHome(): string | undefined {
  const value = process.env["HOME"] || process.env["USERPROFILE"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Legacy (pre-XDG) data home: ~/.hasna/contacts. Read-only adoption source. */
function legacyHomeDir(): string {
  return join(home(), ".hasna", "contacts");
}

/** Ancient (pre-.hasna) home: ~/.contacts. Also an adoption source. */
function ancientHomeDir(): string {
  return join(home(), ".contacts");
}

function hasContent(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Gated legacy adoption: copy the regular files of a legacy source into the
 * XDG target once, and only when the target holds no store yet. Never
 * clobbers an existing XDG store. `.vault-session` is transient session state
 * and is adopted separately into the XDG state root by `getStateDir()`.
 */
function adoptLegacy(source: string, target: string): void {
  if (!hasContent(source) || hasContent(target)) return;
  ensurePrivateDir(target);
  for (const entry of readdirSync(source)) {
    if (entry === ".vault-session") continue;
    // Skip the literal "{backups,images,documents}" directory: an empty shell
    // brace-expansion artifact created by the pre-0.6.36 postinstall.
    if (entry === "{backups,images,documents}") continue;
    const oldPath = join(source, entry);
    const newPath = join(target, entry);
    const st = statSync(oldPath);
    if (st.isDirectory()) {
      // Preserves nested documents/, images/ and friends with their perms.
      cpSync(oldPath, newPath, { recursive: true });
      chmodSync(newPath, 0o700);
    } else if (st.isFile()) {
      copyFileSync(oldPath, newPath);
      chmodSync(newPath, 0o600);
    }
  }
}

// Once a target has been adoption-checked, skip re-scanning it: the legacy
// home is a large directory and readdirSync of it on every path resolution is
// wasteful I/O under load. Each distinct target path (per test temp root or
// per env override) is checked at most once per process.
const checkedDataTargets = new Set<string>();
const checkedStateTargets = new Set<string>();

/**
 * The XDG data root for contacts (~/.local/share/hasna/contacts, or
 * $HASNA_DATA_HOME/contacts). Creates it on first use; adopts the legacy
 * `~/.hasna/contacts` (and the older `~/.contacts`) store into it once.
 */
export function getDataDir(): string {
  // Read HOME once so the XDG target and the legacy adoption source can never
  // disagree mid-call (a concurrent process.env flip must not adopt a
  // temp-home fixture into the real XDG root).
  const base = home();
  const target = dataDir({ app: "contacts", home: base });
  if (!checkedDataTargets.has(target)) {
    adoptLegacy(join(base, ".hasna", "contacts"), target);
    adoptLegacy(join(base, ".contacts"), target);
    checkedDataTargets.add(target);
  }
  ensurePrivateDir(target);
  return target;
}

/**
 * The XDG state root for contacts (~/.local/state/hasna/contacts, or
 * $HASNA_STATE_HOME/contacts) — the home of the vault session state file.
 * Adopts a legacy `~/.hasna/contacts/.vault-session` once, gated on the state
 * target holding no session yet.
 */
export function getStateDir(): string {
  const base = home();
  const target = stateDir({ app: "contacts", home: base });
  if (!checkedStateTargets.has(target)) {
    if (!hasContent(target)) {
      const legacySession = join(base, ".hasna", "contacts", ".vault-session");
      if (existsSync(legacySession)) {
        ensurePrivateDir(target);
        const targetSession = join(target, ".vault-session");
        copyFileSync(legacySession, targetSession);
        chmodSync(targetSession, 0o600);
      }
    }
    checkedStateTargets.add(target);
  }
  ensurePrivateDir(target);
  return target;
}

export function getDbPath(): string {
  if (process.env["HASNA_CONTACTS_DB_PATH"]) return process.env["HASNA_CONTACTS_DB_PATH"];
  if (process.env["CONTACTS_DB_PATH"]) return process.env["CONTACTS_DB_PATH"];
  return join(getDataDir(), "contacts.db");
}
