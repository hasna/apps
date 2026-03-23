// Centralized path resolution for open-testers global data directory.
// Migrated from ~/.testers/ to ~/.hasna/testers/ with backward compat.

import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/**
 * Get the global testers data directory.
 * New default: ~/.hasna/testers/
 * Legacy fallback: ~/.testers/ (if it exists and new dir doesn't)
 * Env override: HASNA_TESTERS_DIR or TESTERS_DIR
 */
export function getTestersDir(): string {
  if (process.env.HASNA_TESTERS_DIR) return process.env.HASNA_TESTERS_DIR;
  if (process.env.TESTERS_DIR) return process.env.TESTERS_DIR;

  const home = homedir();
  const newDir = join(home, ".hasna", "testers");
  const legacyDir = join(home, ".testers");

  // Use legacy dir if it exists and new one doesn't yet (backward compat)
  if (!existsSync(newDir) && existsSync(legacyDir)) {
    return legacyDir;
  }

  if (!existsSync(newDir)) {
    mkdirSync(newDir, { recursive: true });
  }

  return newDir;
}
