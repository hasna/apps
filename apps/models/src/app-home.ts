import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** Env var name for the shipped exact-app home override. */
export const HASNA_MODELS_HOME_ENV = "HASNA_MODELS_HOME";

/**
 * The effective user home, mirroring the pre-existing models resolution.
 * Read at call time because the CLI tests switch `$HOME` mid-process and bun's
 * `os.homedir()` does not follow that switch.
 */
export function effectiveHome(): string {
  return process.env["HOME"] || homedir();
}

/**
 * Pre-XDG default home: `~/.hasna/models`. Resolved at call time (not module
 * load) so switching `$HOME` mid-process keeps working.
 */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "models");
}

/**
 * The @hasna/paths-resolved data home for models (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({ app: "models", home: process.env["HOME"] || undefined });
}

/**
 * Whether the resolver (XDG) home should be adopted as the models data home.
 * The resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`models.db` exists). A
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
  return existsSync(join(resolved, "models.db"));
}

/** The exact-app override root, when set: `HASNA_MODELS_HOME`. */
export function exactModelsHome(): string | undefined {
  const dir = process.env[HASNA_MODELS_HOME_ENV];
  if (dir && dir.trim()) return dir.trim();
  return undefined;
}

/**
 * Effective models data home: the exact-app override (`HASNA_MODELS_HOME`) wins
 * unconditionally; otherwise the resolver (XDG) data home once adopted;
 * otherwise the legacy `~/.hasna/models` default.
 */
export function getModelsHome(): string {
  const exact = exactModelsHome();
  if (exact) return resolve(exact);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(legacyHomeDir());
}
