import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/**
 * @hasna/context home resolution.
 *
 * @hasna/context stores its sqlite db (`context.db`, WAL sidecars) and doc
 * artifacts under a single "context home". Historically that home was
 * `~/.hasna/context`. This module resolves it through `@hasna/paths` (XDG /
 * macOS home layout) with a gated legacy adoption: the legacy
 * `~/.hasna/context` stays the effective home until the store is physically
 * migrated to the XDG data home or the operator sets the data-kind override
 * `HASNA_DATA_HOME`. An existing live store never becomes invisible on
 * upgrade. The exact-app overrides `HASNA_CONTEXT_DATA_DIR` / `CONTEXT_DATA_DIR`
 * (the pre-existing per-app data-dir overrides) win unconditionally; the
 * store-path overrides `HASNA_CONTEXT_DB_PATH` / `CONTEXT_DB_PATH` are layered
 * on top of the effective home by `resolveDbPath`.
 */

/** The effective user home, mirroring the pre-existing context resolution (`HOME` || `USERPROFILE` || `os.homedir()`). Read at call time. */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/** Pre-XDG default home: `~/.hasna/context`. */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "context");
}

/**
 * The @hasna/paths-resolved data home for context (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({
    app: "context",
    home: process.env["HOME"] || process.env["USERPROFILE"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) data home should be adopted as the store home.
 * The resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the store
 * has already been physically migrated there (`context.db` exists). A machine
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
  return existsSync(join(resolved, "context.db"));
}

/** The exact-app override root, when set: `HASNA_CONTEXT_DATA_DIR`, then `CONTEXT_DATA_DIR`. */
export function exactContextHome(): string | undefined {
  const dir = process.env["HASNA_CONTEXT_DATA_DIR"] ?? process.env["CONTEXT_DATA_DIR"];
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * Effective context home: the exact-app override (`HASNA_CONTEXT_DATA_DIR`,
 * then `CONTEXT_DATA_DIR`) wins unconditionally; otherwise the resolver (XDG)
 * data home once adopted; otherwise the legacy `~/.hasna/context` default.
 */
export function contextHome(): string {
  const exact = exactContextHome();
  if (exact) return exact;
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}
