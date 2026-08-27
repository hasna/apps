import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** Env var name for the exact-app data-dir alias that follows the wave convention. */
export const HASNA_LOOPS_DATA_DIR_ENV = "HASNA_LOOPS_DATA_DIR";

/**
 * The effective user home, mirroring the pre-existing loops resolution
 * (`HOME` || `os.homedir()`). Read at call time because the daemon/CLI tests
 * switch `$HOME` mid-process and bun's `os.homedir()` does not follow that
 * switch.
 */
export function effectiveHome(): string {
  return process.env["HOME"] || homedir();
}

/**
 * Pre-XDG default home: `~/.hasna/loops`. Resolved at call time (not module
 * load) so switching `$HOME` mid-process keeps working.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "loops");
}

/**
 * The @hasna/paths-resolved data home for loops (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({
    app: "loops",
    home: process.env["HOME"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) home should be adopted as the loops data home.
 * The resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`loops.db` exists). A
 * machine that only redirects another kind (e.g. cache to tmpfs) must NOT have
 * its data home moved, and a live store at the legacy home must never become
 * invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "loops.db"));
}

/**
 * The exact-app override root, when set: the shipped `LOOPS_DATA_DIR` wins;
 * `HASNA_LOOPS_DATA_DIR` is the wave-convention alias.
 */
export function exactLoopsDataDir(): string | undefined {
  const dir = process.env["LOOPS_DATA_DIR"];
  if (dir && dir.trim()) return dir.trim();
  const home = process.env[HASNA_LOOPS_DATA_DIR_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/**
 * Effective loops data home: an exact-app override (`LOOPS_DATA_DIR`, then the
 * `HASNA_LOOPS_DATA_DIR` alias) wins unconditionally; otherwise the resolver
 * (XDG) data home once adopted; otherwise the legacy `~/.hasna/loops` default.
 */
export function getLoopsDataDir(): string {
  const exact = exactLoopsDataDir();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}
