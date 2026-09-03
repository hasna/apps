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
 * @hasna/prompts data-home resolution through the @hasna/paths resolver.
 *
 * prompts stores its local SQLite database (`prompts.db`) and its dispatch
 * run records (under `runs/`) beneath a single data root. Historically that
 * root was `~/.hasna/prompts`. This module resolves the root through
 * `@hasna/paths` (XDG / macOS home layout) with a gated legacy adoption: the
 * legacy `~/.hasna/prompts` stays the effective data root until the store is
 * physically migrated to the XDG data home (`prompts.db` present there) or
 * the operator sets the data-kind override `HASNA_DATA_HOME`. An existing
 * live store never becomes invisible on upgrade. The exact-app overrides
 * `HASNA_PROMPTS_HOME` (then `PROMPTS_HOME`) win unconditionally, and the
 * per-file db-path overrides (`HASNA_PROMPTS_DB_PATH` / `PROMPTS_DB_PATH`)
 * stay layered on top by `getDbPath` in `db/database.ts`.
 *
 * Nothing moves on disk in this phase — the package just resolves the new
 * paths.
 */

/** The effective user home, mirroring the pre-existing prompts resolution (`HOME` || `USERPROFILE`). */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir() || "/tmp";
}

/** The legacy (pre-XDG) data root: `~/.hasna/prompts`. */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "prompts");
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for prompts:
 * `~/.local/share/hasna/prompts` on Linux, `~/Library/Application
 * Support/Hasna/prompts` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution so the resolver follows the same home the legacy
 * path does.
 */
export function resolverDataRoot(): string {
  return dataDir({
    app: "prompts",
    home: process.env["HOME"] || process.env["USERPROFILE"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`prompts.db` exists — prompts' store file). A machine that only redirects
 * another kind (e.g. cache to tmpfs) must NOT have its data home moved, and
 * a live store at the legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "prompts.db"));
}

/** The exact-app override root, when set: `HASNA_PROMPTS_HOME`, then `PROMPTS_HOME`. */
export function exactDataRoot(): string | undefined {
  // First non-blank override wins. A blank or whitespace-only primary must not
  // shadow a valid secondary (nullish `??` does not fall through on "").
  for (const key of ["HASNA_PROMPTS_HOME", "PROMPTS_HOME"] as const) {
    const dir = process.env[key]?.trim();
    if (dir) return resolve(dir);
  }
  return undefined;
}

/**
 * The effective data root: an exact-app override (`HASNA_PROMPTS_HOME`, then
 * `PROMPTS_HOME`) wins unconditionally; otherwise the resolver (XDG) data
 * root once adopted; otherwise the legacy `~/.hasna/prompts` default.
 */
export function getDataRoot(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  const resolved = resolverDataRoot();
  return adoptResolverDataRoot(resolved) ? resolve(resolved) : resolve(legacyDataRoot());
}

/** The dispatch run-records directory: the effective data root's `runs` subdir. */
export function runsDir(): string {
  return join(getDataRoot(), "runs");
}

/**
 * The default prompt directory for `prompts runbook lint`. Runbook prompt
 * files are prompts-owned data, so once the data root adopts the resolver
 * (XDG) home they live at the adopted root's `runbook` subdir; until then the
 * legacy loops-prompt convention (`~/.hasna/loops/prompts`) stays the
 * default, so an existing runbook set stays reachable without `--dir`. An
 * exact-app override also points at the overridden root's `runbook` subdir.
 */
export function runbookPromptDir(): string {
  const exact = exactDataRoot();
  if (exact) return join(exact, "runbook");
  const resolved = resolverDataRoot();
  return adoptResolverDataRoot(resolved)
    ? join(resolve(resolved), "runbook")
    : join(effectiveHome(), ".hasna", "loops", "prompts");
}
