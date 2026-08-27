import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/**
 * Connectors home resolution.
 *
 * @hasna/connectors stores per-provider `connect-*` OAuth token/config
 * stores and its own sqlite db under a single "connectors home".
 * Historically that home was `~/.hasna/connectors`. This module resolves it
 * through `@hasna/paths` (XDG / macOS home layout) with a gated legacy
 * adoption: the legacy `~/.hasna/connectors` stays the effective home until
 * the store is physically migrated to the XDG data home or the operator sets
 * the data-kind override `HASNA_DATA_HOME`. An existing live store never
 * becomes invisible on upgrade. The exact-app override `HASNA_CONNECTORS_DIR`
 * wins unconditionally, preserving the pre-existing per-app override.
 */

function envOr(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

/** The effective user home, mirroring the pre-existing connectors resolution (`HOME` || `USERPROFILE` || `os.homedir()`). Read at call time. */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/** Pre-XDG default home: `~/.hasna/connectors`. */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "connectors");
}

/**
 * The @hasna/paths-resolved data home for connectors (XDG / macOS home
 * layout). The home override mirrors the pre-existing `$HOME`-first
 * resolution so the resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({
    app: "connectors",
    home: process.env["HOME"] || process.env["USERPROFILE"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) data home should be adopted as the store home.
 * The resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the store
 * has already been physically migrated there (`connectors.db` exists). A machine
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
  return existsSync(join(resolved, "connectors.db"));
}

/** The exact-app override root, when set: `HASNA_CONNECTORS_DIR`. */
export function exactConnectorsHome(): string | undefined {
  const home = envOr("HASNA_CONNECTORS_DIR", "");
  return home ? home : undefined;
}

/**
 * Effective connectors home: the exact-app override (`HASNA_CONNECTORS_DIR`)
 * wins unconditionally; otherwise the resolver (XDG) data home once adopted;
 * otherwise the legacy `~/.hasna/connectors` default.
 */
export function connectorsHome(): string {
  const exact = exactConnectorsHome();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}
