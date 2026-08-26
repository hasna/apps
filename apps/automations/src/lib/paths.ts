import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataDir } from "@hasna/paths";

const OPTIONS = { app: "automations" } as const;

/** Pre-XDG default home: ~/.hasna/automations. */
export const LEGACY_HOME_DIR = join(homedir(), ".hasna", "automations");

/** The @hasna/paths-resolved data home for automations (XDG layout). */
export function resolverHome(): string {
  return dataDir(OPTIONS);
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`automations.db` exists).
 * A machine that only redirects another kind must NOT have its data home
 * moved, and a live store at the legacy home must never become invisible on
 * upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "automations.db"));
}

/** The exact-app override root (`HASNA_AUTOMATIONS_DIR` ?? `AUTOMATIONS_DATA_DIR`), when set. Empty values are treated as unset. */
function exactAppOverride(): string | undefined {
  const override = process.env.HASNA_AUTOMATIONS_DIR || process.env.AUTOMATIONS_DATA_DIR;
  return override && override.trim() ? override.trim() : undefined;
}

/**
 * Effective data home: the exact-app override wins unconditionally; otherwise
 * the resolver (XDG) home once adopted; otherwise the legacy
 * `~/.hasna/automations` default.
 */
export function automationsDataDir(): string {
  const override = exactAppOverride();
  if (override) return override;
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolved : LEGACY_HOME_DIR;
}

export function ensureAutomationsDataDir(): string {
  const dir = automationsDataDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function automationsDbPath(): string {
  return join(automationsDataDir(), "automations.db");
}

export function daemonPidFilePath(): string {
  return join(automationsDataDir(), "daemon.pid");
}

export function daemonLogPath(): string {
  return join(automationsDataDir(), "daemon.log");
}
