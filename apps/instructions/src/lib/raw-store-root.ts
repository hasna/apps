import { resolve } from "node:path";
import { getConfigsStoreHome } from "./app-home.js";

/**
 * Legacy environment variable that overrides the raw store root.
 * Kept for compatibility: the canonical default is the effective configs store
 * home (legacy `~/.hasna/instructions` until the XDG config home is adopted),
 * and `HASNA_CONFIGS_HOME` remains a supported override.
 */
export const RAW_STORE_ROOT_ENV = "HASNA_CONFIGS_HOME";

/**
 * Canonical data root for the instructions/configs app.
 *
 * Every shipped local-storage path derives from this root: the SQLite store
 * (`db/database.ts`) and the CLI db-path / backup computations
 * (`cli/index.tsx`). The root is resolved through the @hasna/paths resolver
 * (XDG / macOS home layout): the legacy `~/.hasna/instructions` default (with
 * the `HASNA_CONFIGS_HOME` exact-app override) stays the effective root until
 * the store has actually been migrated to the XDG config home or the operator
 * sets the config-kind override `HASNA_CONFIG_HOME`. An existing local store
 * never becomes invisible on upgrade.
 */
export function getRawStoreRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(getConfigsStoreHome(env));
}
