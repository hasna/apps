import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** Env var name for the exact-app home alias that follows the wave convention. */
export const HASNA_BRIDGE_HOME_ENV = "HASNA_BRIDGE_HOME";

/**
 * The effective user home, mirroring the pre-existing bridge resolution
 * (`HOME` || `os.homedir()`). Read at call time because the config/CLI tests
 * switch `$HOME` mid-process and bun's `os.homedir()` does not follow that
 * switch.
 */
export function effectiveHome(): string {
  return process.env["HOME"] || homedir();
}

/**
 * Pre-XDG default home: `~/.hasna/bridge`. Resolved at call time (not module
 * load) so switching `$HOME` mid-process keeps working.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "bridge");
}

/**
 * The @hasna/paths-resolved data home for bridge (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({
    app: "bridge",
    home: process.env["HOME"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) home should be adopted as the bridge home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`config.json` or
 * `state.json` exists). A machine that only redirects another kind (e.g.
 * cache to tmpfs) must NOT have its data home moved, and a live store at the
 * legacy home must never become invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return (
    existsSync(join(resolved, "config.json")) ||
    existsSync(join(resolved, "state.json"))
  );
}

/**
 * The exact-app override root, when set: the shipped `BRIDGE_HOME` wins;
 * `HASNA_BRIDGE_HOME` is the wave-convention alias.
 */
export function exactBridgeHome(): string | undefined {
  const dir = process.env["BRIDGE_HOME"];
  if (dir && dir.trim()) return dir.trim();
  const home = process.env[HASNA_BRIDGE_HOME_ENV];
  if (home && home.trim()) return home.trim();
  return undefined;
}

/**
 * Effective bridge data home: an exact-app override (`BRIDGE_HOME`, then the
 * `HASNA_BRIDGE_HOME` alias) wins unconditionally; otherwise the resolver
 * (XDG) data home once adopted; otherwise the legacy `~/.hasna/bridge`
 * default.
 */
export function getBridgeHome(): string {
  const exact = exactBridgeHome();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}

/** The config file at the effective bridge home (`BRIDGE_CONFIG` wins). */
export function getConfigPath(): string {
  const override = process.env["BRIDGE_CONFIG"];
  if (override && override.trim()) return resolve(override.trim());
  return join(getBridgeHome(), "config.json");
}

/** The state file at the effective bridge home (`BRIDGE_STATE` wins). */
export function getStatePath(): string {
  const override = process.env["BRIDGE_STATE"];
  if (override && override.trim()) return resolve(override.trim());
  return join(getBridgeHome(), "state.json");
}

/** The daemon directory at the effective bridge home. */
export function getDaemonDir(): string {
  return join(getBridgeHome(), "daemon");
}
