import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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

/**
 * The contract's `storage.envPrefix` for this package. Configuration is read
 * from `HASNA_FEEDBACK_*` first, falling back to the historical unprefixed
 * `FEEDBACK_*` names so existing setups keep working.
 */
export const ENV_PREFIX = "HASNA_FEEDBACK_";

/** The legacy append-only JSONL store file name. */
export const DEFAULT_FEEDBACK_FILE = "feedback.jsonl";

/**
 * The legacy (pre-XDG) default data dir: `~/.hasna/feedback`. Retained as the
 * effective data dir until the @hasna/paths-resolved XDG data home is adopted
 * (`HASNA_DATA_HOME` set or a store file already present at the resolver
 * root).
 */
export const DEFAULT_DATA_DIR = join(homedir(), ".hasna", "feedback");

/** Read a setting by its prefixed name, then its legacy unprefixed aliases. */
export function readStorageEnv(
  env: Record<string, string | undefined>,
  suffix: string,
  legacyAliases: string[] = [],
): string | undefined {
  const names = [`${ENV_PREFIX}${suffix}`, `FEEDBACK_${suffix}`, ...legacyAliases];
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value.trim()) return value;
  }
  return undefined;
}

/** The effective user home, mirroring the pre-existing feedback resolution. */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir() || "/tmp";
}

/** The legacy (pre-XDG) data root: `~/.hasna/feedback`. */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "feedback");
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for feedback:
 * `~/.local/share/hasna/feedback` on Linux, `~/Library/Application
 * Support/Hasna/feedback` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution so the resolver follows the same home the legacy
 * path does.
 */
export function resolverDataRoot(): string {
  return dataDir({
    app: "feedback",
    home: process.env["HOME"] || process.env["USERPROFILE"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective data
 * root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`feedback.db` or `feedback.jsonl` — feedback's store files). A machine that
 * only redirects another kind (e.g. cache to tmpfs) must NOT have its data
 * home moved, and a live store at the legacy home must never become invisible
 * on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return (
    existsSync(join(resolved, "feedback.db")) || existsSync(join(resolved, "feedback.jsonl"))
  );
}

/** The exact-app override root, when set: `HASNA_FEEDBACK_HOME`, then `FEEDBACK_HOME`. */
export function exactDataRoot(): string | undefined {
  // First non-blank override wins. A blank or whitespace-only primary must not
  // shadow a valid secondary (nullish `??` does not fall through on "").
  for (const key of ["HASNA_FEEDBACK_HOME", "FEEDBACK_HOME"] as const) {
    const dir = process.env[key]?.trim();
    if (dir) return resolve(dir);
  }
  return undefined;
}

/**
 * The effective data dir: an exact-app override (`HASNA_FEEDBACK_HOME`, then
 * `FEEDBACK_HOME`) wins unconditionally; otherwise the resolver (XDG) data
 * root once adopted; otherwise the legacy `~/.hasna/feedback` default.
 */
export function getDataDir(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  const resolved = resolverDataRoot();
  return adoptResolverDataRoot(resolved) ? resolve(resolved) : resolve(legacyDataRoot());
}

export function resolveFeedbackDataDir(
  dataDir: string | undefined = readStorageEnv(process.env, "DATA_DIR"),
): string {
  // An explicit HASNA_FEEDBACK_DATA_DIR / FEEDBACK_DATA_DIR override names the
  // data dir directly and wins over the resolved home.
  return dataDir && dataDir.trim() ? dataDir : getDataDir();
}

export function resolveFeedbackFilePath(options: { dataDir?: string; filePath?: string } = {}): string {
  return options.filePath ?? join(resolveFeedbackDataDir(options.dataDir), DEFAULT_FEEDBACK_FILE);
}
