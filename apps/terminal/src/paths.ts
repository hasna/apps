// Centralized path resolution for open-terminal global data directory.
// Migrated from ~/.terminal/ to ~/.hasna/terminal/ with backward compat.

import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/**
 * Get the global terminal data directory.
 * New default: ~/.hasna/terminal/
 * Legacy fallback: ~/.terminal/ (if it exists and new dir doesn't)
 * Env override: HASNA_TERMINAL_DIR or TERMINAL_DIR
 */
export function getTerminalDir(): string {
  if (process.env.HASNA_TERMINAL_DIR) return process.env.HASNA_TERMINAL_DIR;
  if (process.env.TERMINAL_DIR) return process.env.TERMINAL_DIR;

  const home = homedir();
  const newDir = join(home, ".hasna", "terminal");
  const legacyDir = join(home, ".terminal");

  // Use legacy dir if it exists and new one doesn't yet (backward compat)
  if (!existsSync(newDir) && existsSync(legacyDir)) {
    return legacyDir;
  }

  if (!existsSync(newDir)) {
    mkdirSync(newDir, { recursive: true });
  }

  return newDir;
}
