/**
 * automations data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/automations` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the automations-specific exact-app override on top.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;

/**
 * The resolver automations data root: kind overrides honored,
 * `~/.hasna/automations` on macOS, `~/.local/share/hasna/automations` on Linux.
 */
export function resolverHome(): string {
  return resolverDataDir({ app: "automations", home: effectiveHome(),  });
}

/**
 * The pre-ruling legacy root (`~/.hasna/automations`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "automations");
}

function exactAppOverride(): string | undefined {
  const override = process.env.HASNA_AUTOMATIONS_DIR || process.env.AUTOMATIONS_DATA_DIR;
  return override && override.trim() ? override.trim() : undefined;
}
export function automationsDataDir(): string {
  const override = exactAppOverride();
  if (override) return override;
  return resolve(resolverHome());
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