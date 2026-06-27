// Centralized path resolution for open-testers global data directory.
// Migrated from ~/.testers/ to ~/.hasna/testers/ with backward compat.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export function getHomeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

export function migrateLegacyDirectory(sourceDir: string, targetDir: string): void {
  try {
    mkdirSync(targetDir, { recursive: true });
    for (const entry of readdirSync(sourceDir)) {
      const sourcePath = join(sourceDir, entry);
      const targetPath = join(targetDir, entry);
      try {
        const stat = statSync(sourcePath);
        if (stat.isDirectory()) {
          migrateLegacyDirectory(sourcePath, targetPath);
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
 * Get the global testers data directory.
 * New default: ~/.hasna/testers/
 * Legacy migration: copy missing files from ~/.testers/ forward if it exists
 * Env override: HASNA_TESTERS_DIR or TESTERS_DIR
 */
export function getTestersDir(): string {
  if (process.env.HASNA_TESTERS_DIR) return process.env.HASNA_TESTERS_DIR;
  if (process.env.TESTERS_DIR) return process.env.TESTERS_DIR;

  const home = getHomeDir();
  const newDir = join(home, ".hasna", "testers");
  const legacyDir = join(home, ".testers");

  if (existsSync(legacyDir)) {
    migrateLegacyDirectory(legacyDir, newDir);
  }

  if (!existsSync(newDir)) {
    mkdirSync(newDir, { recursive: true });
  }

  return newDir;
}
