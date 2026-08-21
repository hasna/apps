import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Legacy environment variable that overrides the raw store root.
 * Kept for compatibility: the canonical default is `~/.hasna/instructions`,
 * and `HASNA_CONFIGS_HOME` remains a supported override.
 */
export const RAW_STORE_ROOT_ENV = "HASNA_CONFIGS_HOME";

/**
 * Canonical data root for the instructions app.
 *
 * Defaults to `~/.hasna/instructions` (was `~/.hasna/configs`, another app's
 * home). Every shipped local-storage path derives from this root: the SQLite
 * store (`db/database.ts`) and the CLI db-path / backup computations
 * (`cli/index.tsx`). `HASNA_CONFIGS_HOME` overrides the default and is
 * honored by every derived path.
 */
export function getRawStoreRoot(): string {
  return resolve(
    process.env[RAW_STORE_ROOT_ENV] || join(process.env["HOME"] || homedir(), ".hasna", "instructions"),
  );
}
