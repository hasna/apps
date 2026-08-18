// Centralized path resolution for terminal global data directory.
// Migrated from ~/.terminal/ to ~/.hasna/terminal/ with backward compat.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function getHomeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

function copyDirectory(sourceDir: string, targetDir: string): void {
  try {
    mkdirSync(targetDir, { recursive: true });
    for (const entry of readdirSync(sourceDir)) {
      const sourcePath = join(sourceDir, entry);
      const targetPath = join(targetDir, entry);
      try {
        const stat = statSync(sourcePath);
        if (stat.isDirectory()) {
          copyDirectory(sourcePath, targetPath);
        } else if (stat.isFile() && !existsSync(targetPath)) {
          copyFileSync(sourcePath, targetPath);
        }
      } catch {
        // Best-effort legacy migration; unreadable entries should not block startup.
      }
    }
  } catch {
    // Best-effort legacy migration; unreadable directories should not block startup.
  }
}

/**
 * Get the global terminal data directory.
 * New default: ~/.hasna/terminal/
 * Legacy migration: copy missing files from ~/.terminal/ forward if it exists
 * Env override: HASNA_TERMINAL_DIR or TERMINAL_DIR
 */
export function getTerminalDir(): string {
  if (process.env.HASNA_TERMINAL_DIR) return process.env.HASNA_TERMINAL_DIR;
  if (process.env.TERMINAL_DIR) return process.env.TERMINAL_DIR;

  const home = getHomeDir();
  const newDir = join(home, ".hasna", "terminal");
  const legacyDir = join(home, ".terminal");

  if (existsSync(legacyDir)) {
    copyDirectory(legacyDir, newDir);
  }

  if (!existsSync(newDir)) {
    mkdirSync(newDir, { recursive: true });
  }

  return newDir;
}
