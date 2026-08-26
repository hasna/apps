import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

function envOr(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/** The effective user home, mirroring the pre-existing catalog resolution (`HOME` || `USERPROFILE` || `os.homedir()`). Read at call time. */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/** Pre-XDG default home: `~/.hasna/catalog`. */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "catalog");
}

/**
 * The @hasna/paths-resolved data home for catalog (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({
    app: "catalog",
    home: process.env["HOME"] || process.env["USERPROFILE"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) data home should be adopted as the store home.
 * The resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the store
 * has already been physically migrated there (`catalog.db` exists). A machine
 * that only redirects another kind (e.g. cache to tmpfs) must NOT have its data
 * home moved, and a live store at the legacy home must never become invisible
 * on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "catalog.db"));
}

/** The exact-app override root, when set: `CATALOG_HOME`. */
export function exactCatalogHome(): string | undefined {
  const home = process.env["CATALOG_HOME"];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/**
 * Effective catalog data home: an exact-app override (`CATALOG_HOME`) wins
 * unconditionally; otherwise the resolver (XDG) data home once adopted;
 * otherwise the legacy `~/.hasna/catalog` default.
 */
export function catalogHome(): string {
  const exact = exactCatalogHome();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}

export function catalogDbPath(): string {
  return envOr("CATALOG_DB_PATH", join(catalogHome(), "catalog.db"));
}

export function defaultOpensourceRoot(): string {
  return envOr("CATALOG_OPENSOURCE_ROOT", join(effectiveHome(), "workspace", "hasna", "opensource"));
}
