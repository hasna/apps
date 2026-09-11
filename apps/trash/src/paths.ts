/**
 * Path resolution for @hasna/trash.
 *
 * The `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` override + darwin/linux split is
 * duplicated per package ON PURPOSE. `@hasna/paths` was deleted
 * (hasna/apps#1535, 2026-09-03) and the resolver contract is what every member
 * now carries its own copy of: copying the shape from
 * `apps/snapshots/src/paths.ts:14-84` (and `apps/files/src/lib/paths.ts:12-77`)
 * IS the contract, not an oversight. Do not "dry this up" into a shared
 * package — the deletion is the decision.
 *
 * Store layout (§4 of the trash plan; the byte/index/config split is law):
 *
 *   | artifact      | kind   | path                                    |
 *   |---------------|--------|-----------------------------------------|
 *   | staged bytes  | data   | `<HASNA_DATA_HOME>/trash/files/<id>`    |
 *   | index         | state  | `<HASNA_STATE_HOME>/trash/info/<id>.json`|
 *   | config        | config | `<HASNA_CONFIG_HOME>/trash/config.json` |
 *   | lock + daemon | state  | `<HASNA_STATE_HOME>/trash/{.lock,daemon.log}` |
 *
 * **Never put bytes or the index in `cache`** — cache is droppable by
 * definition and a droppable trash is not a trash.
 *
 * Adoption rule (mirrors snapshots): the XDG root is adopted only when the
 * operator set that kind's `HASNA_*_HOME` override, or the store already
 * physically exists at the resolved root. An existing live store never becomes
 * invisible on upgrade, and a legacy `~/.hasna/trash` keeps working until the
 * operator moves it.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type PathKind = "config" | "data" | "state" | "cache";

const PATH_KIND_ENV: Record<PathKind, string> = {
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

const APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertApp(app: string): void {
  if (typeof app !== "string" || app.length === 0) {
    throw new TypeError("paths: app must be a non-empty string");
  }
  if (!APP_SLUG_RE.test(app)) {
    throw new TypeError(
      `paths: invalid app slug "${app}" — expected lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`,
    );
  }
}

function assertKind(kind: PathKind): void {
  if (!(Object.keys(PATH_KIND_ENV) as string[]).includes(kind)) {
    throw new TypeError(
      `paths: invalid path kind "${kind}" — expected one of ${Object.keys(PATH_KIND_ENV).join(", ")}`,
    );
  }
}

function baseDir(kind: PathKind, options: PathsResolverOptions): string {
  assertKind(kind);
  const env: Record<string, string | undefined> = options.env ?? process.env;
  const override = env[PATH_KIND_ENV[kind]];
  // An override is adopted only when it carries a real path, and only as an
  // ABSOLUTE one: a whitespace-only value (an unset-in-a-script `VAR=` shape)
  // used to slip through as a relative base and resolve the store under
  // whatever cwd the caller happened to have — which, for a guard that rewrites
  // `rm`, is wherever the shell was standing.
  if (typeof override === "string" && override.trim().length > 0) return resolve(override.trim());
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    switch (kind) {
      case "config":
      case "data":
        return join(home, "Library", "Application Support", "Hasna");
      case "cache":
        return join(home, "Library", "Caches", "Hasna");
      case "state":
        return join(home, "Library", "Logs", "Hasna");
    }
  }
  switch (kind) {
    case "config":
      return join(home, ".config", "hasna");
    case "data":
      return join(home, ".local", "share", "hasna");
    case "state":
      return join(home, ".local", "state", "hasna");
    case "cache":
      return join(home, ".cache", "hasna");
  }
}

function resolveKind(kind: PathKind, options: PathsResolverOptions): string {
  assertApp(options.app);
  const appSegment = options.internal === true ? join("internal", options.app) : options.app;
  return join(baseDir(kind, options), appSegment);
}

export function configDir(options: PathsResolverOptions): string {
  return resolveKind("config", options);
}

export function dataDir(options: PathsResolverOptions): string {
  return resolveKind("data", options);
}

export function stateDir(options: PathsResolverOptions): string {
  return resolveKind("state", options);
}

export function cacheDir(options: PathsResolverOptions): string {
  return resolveKind("cache", options);
}

/**
 * Resolve the user's home: $HOME, then $USERPROFILE (Windows), then the OS user
 * database. The result is ABSOLUTE — a relative `$HOME` would otherwise become
 * a relative store root, and (worse) a relative `~/.ssh` in the protected-path
 * list, which is the check that keeps the operator's keys out of the trash.
 */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (!home) throw new Error("Unable to resolve the user's home directory");
  return resolve(home);
}

/** Explicit root overrides — `trash --spool <dir>` and per-root flags land here. */
export interface TrashRootOverrides {
  /**
   * Collapse every root under ONE directory. This is the value the shell guard
   * embeds in the rewritten command (`trash guard --spool <abs>`), because a
   * variable set in the hook child never reaches the process that later runs
   * the rewritten command (§4 "Two-context resolution"), while command text
   * does cross that boundary.
   */
  root?: string;
  files?: string;
  info?: string;
  state?: string;
  config?: string;
}

export interface TrashRoots {
  /** Staged payload bytes: `<data>/trash/files`. */
  files: string;
  /** Per-entry `<id>.json` metadata: `<state>/trash/info`. */
  info: string;
  /** Store state root: `<state>/trash` — lock, daemon log, intents, refusals. */
  state: string;
  /** The config FILE (`<config>/trash/config.json`), not a directory. */
  config: string;
  /** Mutating-sweep lock (§4 "Lock (mutating sweeps only)"). */
  lock: string;
  /** `<state>/trash/daemon.log`. */
  daemonLog: string;
  /** Capture intents awaiting recovery (§14.6 ordering). */
  intents: string;
  /** Refusal journal — one JSON file per refused capture (§11.7). */
  refusals: string;
  /** True when the legacy `~/.hasna/trash` home is the effective one. */
  legacy: boolean;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  return resolve(raw.trim());
}

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return resolve(value.trim());
}

/**
 * Resolve the effective trash roots.
 *
 * Explicit overrides win unconditionally (a `--spool <dir>` collapses every
 * root under it — the guard's single-argument contract); otherwise the
 * `HASNA_{DATA,STATE,CONFIG}_HOME` overrides apply with the darwin/linux
 * split, and the legacy `~/.hasna/trash` home is kept while its store exists.
 */
export function resolveTrashRoots(
  env: NodeJS.ProcessEnv = process.env,
  overrides: TrashRootOverrides = {},
): TrashRoots {
  const root = nonEmpty(overrides.root);
  if (root) {
    return {
      files: join(root, "files"),
      info: join(root, "info"),
      state: root,
      config: join(root, "config.json"),
      lock: join(root, ".lock"),
      daemonLog: join(root, "daemon.log"),
      intents: join(root, "intents"),
      refusals: join(root, "refusals"),
      legacy: false,
    };
  }

  const home = getHomeDir(env);
  const platform = process.platform;
  const legacyHome = join(home, ".hasna", "trash");
  const base = { app: "trash", home, platform, env } satisfies PathsResolverOptions;

  const dataOverride = envValue(env, "HASNA_DATA_HOME");
  const stateOverride = envValue(env, "HASNA_STATE_HOME");
  const configOverride = envValue(env, "HASNA_CONFIG_HOME");

  let dataRoot: string;
  let legacy = false;
  if (dataOverride) {
    dataRoot = join(dataOverride, "trash");
  } else if (existsSync(join(legacyHome, "files"))) {
    dataRoot = legacyHome;
    legacy = true;
  } else {
    dataRoot = join(baseDir("data", base), "trash");
  }

  let stateRoot: string;
  if (stateOverride) {
    stateRoot = join(stateOverride, "trash");
  } else if (existsSync(join(legacyHome, "info"))) {
    stateRoot = legacyHome;
  } else {
    stateRoot = join(baseDir("state", base), "trash");
  }

  let configFile: string;
  if (configOverride) {
    configFile = join(configOverride, "trash", "config.json");
  } else if (existsSync(join(legacyHome, "config.json"))) {
    configFile = join(legacyHome, "config.json");
  } else {
    configFile = join(baseDir("config", base), "trash", "config.json");
  }

  return {
    files: nonEmpty(overrides.files) ?? join(dataRoot, "files"),
    info: nonEmpty(overrides.info) ?? join(stateRoot, "info"),
    state: nonEmpty(overrides.state) ?? stateRoot,
    config: nonEmpty(overrides.config) ?? configFile,
    lock: join(nonEmpty(overrides.state) ?? stateRoot, ".lock"),
    daemonLog: join(nonEmpty(overrides.state) ?? stateRoot, "daemon.log"),
    intents: join(nonEmpty(overrides.state) ?? stateRoot, "intents"),
    refusals: join(nonEmpty(overrides.state) ?? stateRoot, "refusals"),
    legacy,
  };
}
