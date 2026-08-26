import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** Env var name for the exact-app data-home override. */
export const BROWSER_DATA_DIR_ENV = "BROWSER_DATA_DIR";

/**
 * The effective user home, mirroring the pre-existing browser resolution
 * (`HOME` || `USERPROFILE` || `os.homedir()`). Read at call time because the
 * config/CLI tests switch `$HOME` mid-process and bun's `os.homedir()` does
 * not follow that switch.
 */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/**
 * Pre-XDG default home: ~/.hasna/browser. Resolved at call time (not module
 * load) so switching $HOME mid-process keeps working.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "browser");
}

/**
 * The @hasna/paths-resolved data home for browser (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({ app: "browser", home: process.env["HOME"] || process.env["USERPROFILE"] || undefined });
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`browser.db` exists). A
 * machine that only redirects another kind (e.g. cache to tmpfs) must NOT
 * have its data home moved, and a live store at the legacy home must never
 * become invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "browser.db"));
}

/** The exact-app override root, when set: `BROWSER_DATA_DIR`. */
export function exactBrowserHome(): string | undefined {
  const dir = process.env[BROWSER_DATA_DIR_ENV];
  if (dir && dir.trim()) return dir.trim();
  return undefined;
}

/**
 * Effective browser data home: the exact-app override (`BROWSER_DATA_DIR`)
 * wins unconditionally; otherwise the resolver (XDG) data home once adopted;
 * otherwise the legacy `~/.hasna/browser` default.
 */
export function getBrowserHome(): string {
  const exact = exactBrowserHome();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}
